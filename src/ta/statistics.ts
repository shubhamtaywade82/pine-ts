import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
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
