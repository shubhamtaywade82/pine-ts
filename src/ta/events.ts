import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";

const requireCompatibleRuntime = (source: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

const requireNonNegativeOccurrence = (occurrence: number): void => {
  if (!Number.isInteger(occurrence) || occurrence < 0) {
    throw new RangeError("occurrence must be a non-negative integer");
  }
};

/**
 * ta.barssince — number of bars since `condition` was last true.
 *
 * Per the v6 reference: 0 when the condition holds on the current bar, the
 * bar distance to the last true bar otherwise, and na when the condition has
 * never been true. State advances only in `commit`.
 */
export const barssince = (condition: Series<boolean>): FloatSeries => {
  const runtime = condition.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime.nodes.getOrCreate(nodeKey("ta.barssince", condition), () => {
    interface State {
      count: number | undefined;
    }
    const resolve = (state: Readonly<State>): number => {
      if (condition.at(0)) return 0;
      return state.count === undefined ? Number.NaN : state.count + 1;
    };
    const definition = {
      init: (): State => ({ count: undefined }),
      evaluate: (state: Readonly<State>): number => resolve(state),
      commit: (state: State): void => {
        const value = resolve(state);
        state.count = Number.isNaN(value) ? undefined : value;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

const createDirectionalRun = (
  name: string,
  rising: boolean,
  source: Series<number>,
  length: number,
): BooleanSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey(name, source, length), () => {
    const definition = {
      warmupBars: length,
      init: (): null => null,
      evaluate: (): boolean => {
        const current = source.at(0);
        // na operands read as false in Pine v6 boolean semantics.
        if (isNa(current)) return false;
        // Collect the last `length` non-na prior values; the run needs all of
        // them ("na values are ignored; the function calculates on the length
        // quantity of non-na values").
        const prior: number[] = [];
        let offset = 1;
        while (prior.length < length) {
          const value = source.at(offset);
          if (value === undefined) return false;
          if (!isNa(value)) prior.push(value);
          offset += 1;
        }
        let previous = current;
        for (const value of prior) {
          const keepsRising = rising ? previous > value : previous < value;
          if (!keepsRising) return false;
          previous = value;
        }
        return true;
      },
      commit: (): void => undefined,
    };
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};

/**
 * ta.rising — true when the source strictly increased over the last `length`
 * non-na values (current bar included).
 */
export const rising = (source: Series<number>, length: number): BooleanSeries => {
  requirePositiveLength(length);
  return createDirectionalRun("ta.rising", true, source, length);
};

/**
 * ta.falling — true when the source strictly decreased over the last `length`
 * non-na values (current bar included).
 */
export const falling = (source: Series<number>, length: number): BooleanSeries => {
  requirePositiveLength(length);
  return createDirectionalRun("ta.falling", false, source, length);
};

/**
 * ta.valuewhen — value of `source` on the nth most recent bar where
 * `condition` was true.
 *
 * Per the v6 reference, `occurrence` is a non-negative simple int with 0 the
 * most recent occurrence; a condition on the current bar counts as occurrence
 * 0. Returns na until enough occurrences exist. The capture buffer is capped
 * at `occurrence + 1` entries, the deepest lookback this call can request.
 */
export const valuewhen = <T>(
  condition: Series<boolean>,
  source: Series<T>,
  occurrence: number,
): Series<T | undefined> => {
  requireNonNegativeOccurrence(occurrence);
  const runtime = condition.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  if (source.runtime !== runtime) {
    throw new Error("TA operands must belong to the same PineSession");
  }
  return runtime.nodes.getOrCreate(nodeKey("ta.valuewhen", condition, source, occurrence), () => {
    interface State {
      captured: T[];
    }
    const definition = {
      init: (): State => ({ captured: [] }),
      evaluate: (state: Readonly<State>): T | undefined => {
        if (condition.at(0)) {
          return occurrence === 0 ? source.at(0) : state.captured[occurrence - 1];
        }
        return state.captured[occurrence];
      },
      commit: (state: State): void => {
        if (!condition.at(0)) return;
        const value = source.at(0);
        if (value === undefined) return;
        state.captured.unshift(value);
        if (state.captured.length > occurrence + 1) state.captured.length = occurrence + 1;
      },
    };
    return new Series<T | undefined>(runtime, new IndicatorNode(definition));
  });
};

const createExtremeOffset = (
  name: string,
  highest: boolean,
  source: Series<number>,
  length: number,
): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey(name, source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        // A na current value yields na, matching ta.highest/ta.lowest.
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined || window.length === 0) return Number.NaN;
        // Scanning from the current bar and replacing only on a strict
        // improvement resolves ties toward the most recent bar. Normalizing
        // -0 keeps the reported offset a plain 0 like Pine's int result.
        let bestOffset = window[0]?.offset ?? 0;
        let bestValue = window[0]?.value ?? Number.NaN;
        for (const { value, offset } of window) {
          const improves = highest ? value > bestValue : value < bestValue;
          if (improves) {
            bestValue = value;
            bestOffset = offset;
          }
        }
        return bestOffset === 0 ? 0 : -bestOffset;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.highestbars — offset (a negative bar count) to the highest value over
 * the last `length` non-na values. Ties resolve to the most recent bar.
 */
export const highestbars = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createExtremeOffset("ta.highestbars", true, source, length);
};

/**
 * ta.lowestbars — offset (a negative bar count) to the lowest value over the
 * last `length` non-na values. Ties resolve to the most recent bar.
 */
export const lowestbars = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createExtremeOffset("ta.lowestbars", false, source, length);
};

const createPivot = (
  name: string,
  high: boolean,
  source: Series<number>,
  leftbars: number,
  rightbars: number,
): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey(name, source, leftbars, rightbars), () => {
    const definition = {
      warmupBars: leftbars + rightbars,
      init: (): null => null,
      evaluate: (): number => {
        const candidate = source.at(rightbars);
        if (isNa(candidate)) return Number.NaN;
        for (let offset = 0; offset <= leftbars + rightbars; offset += 1) {
          if (offset === rightbars) continue;
          const neighbor = source.at(offset);
          // na neighbors are ignored (Pine v6 "na values are ignored");
          // an equal neighbor breaks strict dominance, so no pivot forms.
          if (isNa(neighbor)) continue;
          const dominated = high ? neighbor >= candidate : neighbor <= candidate;
          if (dominated) return Number.NaN;
        }
        return candidate;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.pivothigh — price of the pivot high point, or na when there is none.
 *
 * The pivot candidate sits `rightbars` back and must be strictly greater than
 * every non-na neighbor in the `leftbars + rightbars` window; the value is
 * only reported once the right side has fully elapsed (no lookahead).
 */
export function pivothigh(leftbars: number, rightbars: number): FloatSeries;
export function pivothigh(source: Series<number>, leftbars: number, rightbars: number): FloatSeries;
export function pivothigh(
  sourceOrLeftbars: Series<number> | number,
  rightbarsOrLeftbars: number,
  maybeRightbars?: number,
): FloatSeries {
  if (typeof sourceOrLeftbars === "number") {
    const leftbars = sourceOrLeftbars;
    const rightbars = rightbarsOrLeftbars;
    requirePositiveLength(leftbars);
    requirePositiveLength(rightbars);
    return createPivot(
      "ta.pivothigh",
      true,
      requireCurrentSession().sources.high,
      leftbars,
      rightbars,
    );
  }
  const source = sourceOrLeftbars;
  const leftbars = rightbarsOrLeftbars;
  const rightbars = maybeRightbars;
  if (rightbars === undefined) throw new TypeError("pivothigh requires a rightbars argument");
  requirePositiveLength(leftbars);
  requirePositiveLength(rightbars);
  return createPivot("ta.pivothigh", true, source, leftbars, rightbars);
}

/**
 * ta.pivotlow — price of the pivot low point, or na when there is none.
 *
 * Mirror of {@link pivothigh}: the candidate must be strictly lower than every
 * non-na neighbor in the window.
 */
export function pivotlow(leftbars: number, rightbars: number): FloatSeries;
export function pivotlow(source: Series<number>, leftbars: number, rightbars: number): FloatSeries;
export function pivotlow(
  sourceOrLeftbars: Series<number> | number,
  rightbarsOrLeftbars: number,
  maybeRightbars?: number,
): FloatSeries {
  if (typeof sourceOrLeftbars === "number") {
    const leftbars = sourceOrLeftbars;
    const rightbars = rightbarsOrLeftbars;
    requirePositiveLength(leftbars);
    requirePositiveLength(rightbars);
    return createPivot(
      "ta.pivotlow",
      false,
      requireCurrentSession().sources.low,
      leftbars,
      rightbars,
    );
  }
  const source = sourceOrLeftbars;
  const leftbars = rightbarsOrLeftbars;
  const rightbars = maybeRightbars;
  if (rightbars === undefined) throw new TypeError("pivotlow requires a rightbars argument");
  requirePositiveLength(leftbars);
  requirePositiveLength(rightbars);
  return createPivot("ta.pivotlow", false, source, leftbars, rightbars);
}
