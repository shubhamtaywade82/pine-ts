import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";
import {
  collectNonNaPairWindow,
  collectNonNaWindow,
  collectStrictWindow,
  type WindowPair,
} from "./window.js";

const requireCompatibleRuntime = (source: Series<number>, other?: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  if (other !== undefined && other.runtime !== runtime) {
    throw new Error("TA operands must belong to the same PineSession");
  }
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
 * Strict-window rolling statistic for built-ins whose v6 remark reads "na
 * values in the source series are included in calculations and will produce
 * an na result" (`ta.percentile_linear_interpolation`, `ta.percentrank`): any
 * na inside the last `length` bars — or a na current value, or an incomplete
 * warm-up window — yields na.
 */
const createStrictStatistic = (
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
        const window = collectStrictWindow(source, length);
        return window === undefined ? Number.NaN : evaluateWindow(window);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.median — median of the last `length` non-na values.
 *
 * v6 remark: "na values in the source series are ignored; the function
 * calculates on the length quantity of non-na values". An even-sized window
 * averages its two middle values, so the result may be fractional.
 */
export const median = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.median", (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  });
};

/**
 * ta.mode — most frequently occurring value of the last `length` non-na
 * values.
 *
 * v6 reference: "If there are several values with the same frequency, it
 * returns the smallest value" and "If none exists, returns the smallest value
 * instead" — with every value occurring once, the smallest already wins the
 * tie, so one rule covers both statements.
 */
export const mode = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.mode", (values) => {
    const frequencies = new Map<number, number>();
    for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    let best: number | undefined;
    let bestCount = 0;
    for (const [value, count] of frequencies) {
      if (
        count > bestCount ||
        (count === bestCount && value < (best ?? Number.POSITIVE_INFINITY))
      ) {
        best = value;
        bestCount = count;
      }
    }
    return best!;
  });
};

/**
 * ta.range — difference between the max and min values over the last
 * `length` non-na values.
 *
 * Same skip-na window model as the statistics family.
 */
export const range = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.range", (values) => {
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    for (const value of values) {
      highest = Math.max(highest, value);
      lowest = Math.min(lowest, value);
    }
    return highest - lowest;
  });
};

/**
 * ta.percentile_nearest_rank — P-th percentile using the Nearest Rank method.
 *
 * The v6 reference pins three properties: the result "will always be a member
 * of the input data set", "the 100th percentile is defined to be the largest
 * value in the input data set", and "na values in the source series are
 * ignored". The nearest-rank rank is `ceil(percentage / 100 * length)`,
 * clamped into the window, matching those properties.
 */
export const percentileNearestRank = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(
    source,
    length,
    `ta.percentile_nearest_rank:${percentage}`,
    (values) => {
      const sorted = [...values].sort((left, right) => left - right);
      const rank = Math.ceil((percentage / 100) * sorted.length);
      const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
      return sorted[index]!;
    },
  );
};

/**
 * ta.percentile_linear_interpolation — P-th percentile using linear
 * interpolation between the two nearest ranks.
 *
 * v6 remarks: "a percentile calculated using this method will NOT always be a
 * member of the input data set" and "na values in the source series are
 * included in calculations and will produce an na result" — so the window is
 * strict. The interpolated position is `(percentage / 100) * (length - 1)` on
 * the sorted window, the standard inclusive two nearest-ranks basis.
 */
export const percentileLinearInterpolation = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  return createStrictStatistic(
    source,
    length,
    `ta.percentile_linear_interpolation:${percentage}`,
    (values) => {
      const sorted = [...values].sort((left, right) => left - right);
      const position = (percentage / 100) * (sorted.length - 1);
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      if (lower === upper) return sorted[lower]!;
      const weight = position - lower;
      return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
    },
  );
};

/**
 * ta.percentrank — percent of values in the window less than or equal to the
 * current value.
 *
 * v6 remark: "na values in the source series are included in calculations and
 * will produce an na result", so the window is strict. The count includes the
 * current bar itself (the standard weak percent-rank convention, where a new
 * window extreme reads 100); the v6 reference documents no re-implementation,
 * so this choice is pinned here until oracle vectors land.
 */
export const percentrank = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createStrictStatistic(source, length, "ta.percentrank", (values) => {
    const current = values[0]!;
    let count = 0;
    for (const value of values) {
      if (value <= current) count += 1;
    }
    return (count / values.length) * 100;
  });
};

const pearsonCorrelation = (pairs: readonly WindowPair[]): number => {
  const meanLeft = pairs.reduce((sum, pair) => sum + pair.left, 0) / pairs.length;
  const meanRight = pairs.reduce((sum, pair) => sum + pair.right, 0) / pairs.length;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (const pair of pairs) {
    const leftDeviation = pair.left - meanLeft;
    const rightDeviation = pair.right - meanRight;
    covariance += leftDeviation * rightDeviation;
    varianceLeft += leftDeviation ** 2;
    varianceRight += rightDeviation ** 2;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? Number.NaN : covariance / denominator;
};

/**
 * ta.correlation — correlation coefficient of two series over a window.
 *
 * Per the v6 reference: "Describes the degree to which two series tend to
 * deviate from their ta.sma() values", with the remark "na values in the
 * source series are ignored; the function calculates on the length quantity
 * of non-na values". pine-ts collects the last `length` bars where BOTH
 * sources are non-na (pairs stay bar-aligned) and computes the Pearson
 * coefficient; a na current value on either side yields na, and a zero
 * variance on either side divides to na in Pine.
 */
export const correlation = (
  source1: Series<number>,
  source2: Series<number>,
  length: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source1, source2);
  return runtime.nodes.getOrCreate(nodeKey("ta.correlation", source1, source2, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source1.at(0)) || isNa(source2.at(0))) return Number.NaN;
        const window = collectNonNaPairWindow(source1, source2, length);
        return window === undefined ? Number.NaN : pearsonCorrelation(window);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.rci — Rank Correlation Index.
 *
 * Spearman's rank correlation between the source and the bar index over the
 * window, scaled to [-100, 100] per the v6 reference: "100 indicates the
 * source consistently increased over the period, and -100 indicates it
 * consistently decreased". Ranks use the pairwise comparison convention
 * (ties contribute 0.5), and the time rank orders the most recent bar
 * highest so a monotonically increasing source reads +100.
 *
 * The v6 reference documents no na remark for `ta.rci`; pine-ts uses a strict
 * window (any na in the last `length` bars yields na) because pairing source
 * ranks with bar-index ranks is only meaningful on contiguous bars.
 */
export const rci = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rci", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const window = collectStrictWindow(source, length);
        if (window === undefined || window.length < 2) return Number.NaN;
        const count = window.length;
        let sumSquaredDifferences = 0;
        for (let i = 0; i < count; i += 1) {
          // window[0] is the current bar; the time rank orders it highest.
          const timeRank = count - i - 1 + 0.5;
          let sourceRank = 0;
          for (let j = 0; j < count; j += 1) {
            const other = window[j]!;
            const value = window[i]!;
            sourceRank += other < value ? 1 : 0;
            sourceRank += other === value ? 0.5 : 0;
          }
          const difference = sourceRank - timeRank;
          sumSquaredDifferences += difference ** 2;
        }
        return (1 - (6 * sumSquaredDifferences) / (count * (count ** 2 - 1))) * 100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
