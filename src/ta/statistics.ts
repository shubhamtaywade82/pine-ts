import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { highest, lowest } from "./core.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";

const requireCompatibleRuntime = (source: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

const calculateVariance = (values: readonly number[], biased: boolean): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDeviation = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const denominator = biased ? values.length : values.length - 1;
  return denominator > 0 ? squaredDeviation / denominator : Number.NaN;
};

/**
 * Shared rolling-statistic window: the last `length` non-na values of the
 * source. Pine v6 documents this for the statistics family as "na values in
 * the source series are ignored; the function calculates on the length
 * quantity of non-na values". A na current value yields na, matching the
 * verified `ta.sma` model; fewer than `length` non-na values yield na.
 */
const createRollingStatistic = (
  source: Series<number>,
  length: number,
  key: string,
  evaluateWindow: (values: readonly number[]) => number,
): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey(key, source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        return evaluateWindow(window.map((entry) => entry.value));
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const variance = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, `ta.variance:${biased}`, (values) =>
    calculateVariance(values, biased),
  );
};

export const stdev = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, `ta.stdev:${biased}`, (values) =>
    Math.sqrt(calculateVariance(values, biased)),
  );
};

export const dev = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.dev", (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
  });
};

/**
 * Reads the last `length` paired (source1, source2) values where both sources
 * are non-na, scanning bar by bar from the current bar backwards. Mirrors the
 * Pine v6 "na values in the source series are ignored" rule applied to the
 * pair, so a bar where either source is na does not contribute a sample.
 *
 * Returns undefined when fewer than `length` paired non-na samples exist
 * (warm-up) — surfaced as na by every caller, matching Pine's warm-up model.
 */
const collectPairedNonNaWindow = (
  source1: Series<number>,
  source2: Series<number>,
  length: number,
): readonly { x: number; y: number }[] | undefined => {
  const samples: { x: number; y: number }[] = [];
  let offset = 0;
  while (samples.length < length) {
    const x = source1.at(offset);
    const y = source2.at(offset);
    if (x === undefined || y === undefined) return undefined;
    if (!isNa(x) && !isNa(y)) samples.push({ x, y });
    offset += 1;
  }
  return samples;
};

const pearsonCorrelation = (samples: readonly { x: number; y: number }[]): number => {
  const n = samples.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (const { x, y } of samples) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return Number.NaN;
  return numerator / denominator;
};

/**
 * `ta.correlation(source1, source2, length)`. Pearson correlation coefficient
 * of the last `length` paired non-na samples (TradingView v6 Reference
 * Manual: "na values in the source series are ignored"). A na current value on
 * either source yields na; fewer than `length` paired samples yields na
 * (warm-up). A constant window (zero variance in either series) yields na,
 * matching the Pine remark that a constant series has no defined correlation.
 */
export const correlation = (
  source1: Series<number>,
  source2: Series<number>,
  length: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source1);
  if (source2.runtime !== runtime)
    throw new Error("ta.correlation operands must belong to the same PineSession");
  return runtime.nodes.getOrCreate(nodeKey("ta.correlation", source1, source2, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source1.at(0)) || isNa(source2.at(0))) return Number.NaN;
        const samples = collectPairedNonNaWindow(source1, source2, length);
        if (samples === undefined) return Number.NaN;
        return pearsonCorrelation(samples);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.max(source)`. Running maximum of all non-na values seen so far on the
 * source series (no length window — the entire available history up to the
 * current bar, per the v6 Reference Manual). Distinct from
 * `ta.highest(source, length)`, which scans a fixed-length window. A na
 * current value carries the previous maximum forward; the first non-na bar
 * seeds the running value. A history with no non-na values yet yields na.
 */
export const max = (source: Series<number>): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.max", source), () => {
    interface State {
      value: number;
      seeded: boolean;
    }
    const definition = {
      init: (): State => {
        // Seed from committed history (newest first) so a node created mid-run
        // matches one that had been running all along.
        let value = Number.NaN;
        let seeded = false;
        let offset = 1;
        while (true) {
          const previous = source.at(offset);
          if (previous === undefined) break;
          if (!isNa(previous)) {
            value = !seeded ? previous : Math.max(value, previous);
            seeded = true;
          }
          offset += 1;
        }
        return { value, seeded };
      },
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        if (isNa(current)) return state.value;
        return !state.seeded ? current : Math.max(state.value, current);
      },
      commit: (state: State): void => {
        const current = source.at(0);
        if (isNa(current)) return;
        state.value = !state.seeded ? current : Math.max(state.value, current);
        state.seeded = true;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.min(source)`. Running minimum of all non-na values seen so far. Mirror
 * of {@link max}.
 */
export const min = (source: Series<number>): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.min", source), () => {
    interface State {
      value: number;
      seeded: boolean;
    }
    const definition = {
      init: (): State => {
        let value = Number.NaN;
        let seeded = false;
        let offset = 1;
        while (true) {
          const previous = source.at(offset);
          if (previous === undefined) break;
          if (!isNa(previous)) {
            value = !seeded ? previous : Math.min(value, previous);
            seeded = true;
          }
          offset += 1;
        }
        return { value, seeded };
      },
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        if (isNa(current)) return state.value;
        return !state.seeded ? current : Math.min(state.value, current);
      },
      commit: (state: State): void => {
        const current = source.at(0);
        if (isNa(current)) return;
        state.value = !state.seeded ? current : Math.min(state.value, current);
        state.seeded = true;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.median(source, length)`. Median of the last `length` non-na values. Pine
 * v6 remark: na values in the source series are ignored. A na current value
 * yields na; fewer than `length` non-na values (warm-up) yields na. For an
 * even-length window the median is the average of the two middle sorted
 * values (standard statistical median).
 */
export const median = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.median", (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  });
};

/**
 * `ta.mode(source, length)`. Most frequent value among the last `length`
 * non-na values. Ties (multiple values sharing the maximum count) resolve to
 * the smallest tied value, matching the v6 Reference Manual remark. A na
 * current value yields na; fewer than `length` non-na values (warm-up)
 * yields na.
 */
export const mode = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.mode", (values) => {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    let bestValue = Number.NaN;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount || (count === bestCount && value < bestValue)) {
        bestValue = value;
        bestCount = count;
      }
    }
    return bestValue;
  });
};

/**
 * `ta.range(source, length)`. Spread of the rolling length window:
 * `ta.highest(source, length) - ta.lowest(source, length)`. Composed from
 * the verified {@link highest}/{@link lowest} nodes, so it inherits their na
 * and warm-up behavior: na current value yields na; fewer than `length`
 * non-na values yields na.
 */
export const range = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.range", source, length), () => {
    const highestSeries = highest(source, length);
    const lowestSeries = lowest(source, length);
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const high = highestSeries.at(0);
        const low = lowestSeries.at(0);
        if (isNa(high) || isNa(low)) return Number.NaN;
        return high - low;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
