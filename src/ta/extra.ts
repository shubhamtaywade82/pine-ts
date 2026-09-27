import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";

const requireRuntime = (source: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

const requireBothRuntime = (a: Series<number>, b: Series<number>) => {
  const runtime = requireRuntime(a);
  if (b.runtime !== runtime) throw new Error("TA operands must belong to the same PineSession");
  return runtime;
};

/**
 * ta.cum — cumulative sum of `source` from the first bar.
 * na values contribute zero to the running total (Pine semantics: na terms are
 * skipped), and the output is na whenever the current bar value is na.
 */
export const cum = (source: Series<number>): FloatSeries => {
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cum", source), () => {
    interface State {
      sum: number;
    }
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number => {
        const v = source.at(0);
        if (isNa(v)) return Number.NaN;
        return state.sum + v;
      },
      commit: (state: State): void => {
        const v = source.at(0);
        if (!isNa(v)) state.sum += v;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.cross — true when `source` and `other` cross in either direction.
 * Equivalent to `ta.crossover(source, other) or ta.crossunder(source, other)`.
 */
export const cross = (source: Series<number>, other: Series<number>): BooleanSeries => {
  const runtime = requireBothRuntime(source, other);
  return runtime.nodes.getOrCreate(nodeKey("ta.cross", source, other), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): boolean => {
        const curr = source.at(0);
        const prev = source.at(1);
        const oCurr = other.at(0);
        const oPrev = other.at(1);
        if (isNa(curr) || isNa(prev) || isNa(oCurr) || isNa(oPrev)) return false;
        const crossedOver = prev < oPrev && curr > oCurr;
        const crossedUnder = prev > oPrev && curr < oCurr;
        return crossedOver || crossedUnder;
      },
      commit: (): void => undefined,
    };
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};

/**
 * ta.percentrank — the percentage of values in the `length` lookback window
 * that are strictly less than the current value. Returns 0–100.
 * Pine v6: na when fewer than `length` non-na bars exist.
 */
export const percentrank = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.percentrank", source, length), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        const current = window[0]?.value;
        if (current === undefined || isNa(current)) return Number.NaN;
        const below = window.filter((w) => w.value < current).length;
        return (below / length) * 100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.percentile_nearest_rank — returns the value at the given percentile using
 * the nearest-rank method: position = ceil(p/100 * length), 1-based in the
 * ascending-sorted window.
 * na when fewer than `length` non-na values exist.
 */
export const percentile_nearest_rank = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(
    nodeKey("ta.percentile_nearest_rank", source, length, percentage),
    () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          const window = collectNonNaWindow(source, length);
          if (window === undefined) return Number.NaN;
          const sorted = window.map((w) => w.value).sort((a, b) => a - b);
          // ceil(p/100 * n), clamped to [1, n], then 0-based index
          const rank = Math.min(Math.ceil((percentage / 100) * length), length);
          return sorted[rank - 1] ?? Number.NaN;
        },
        commit: (): void => undefined,
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    },
  ) as FloatSeries;
};

/**
 * ta.percentile_linear_interpolation — returns the value at the given
 * percentile using linear interpolation between the two adjacent ranked values.
 * Position h = (p/100) * (n-1) (0-based fractional index into the sorted array).
 * na when fewer than `length` non-na values exist.
 */
export const percentile_linear_interpolation = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(
    nodeKey("ta.percentile_linear_interpolation", source, length, percentage),
    () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          const window = collectNonNaWindow(source, length);
          if (window === undefined) return Number.NaN;
          const sorted = window.map((w) => w.value).sort((a, b) => a - b);
          // Fractional 0-based index
          const h = (percentage / 100) * (length - 1);
          const lo = Math.floor(h);
          const hi = Math.ceil(h);
          const vLo = sorted[lo];
          const vHi = sorted[hi];
          if (vLo === undefined || vHi === undefined) return Number.NaN;
          return vLo + (vHi - vLo) * (h - lo);
        },
        commit: (): void => undefined,
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    },
  ) as FloatSeries;
};
