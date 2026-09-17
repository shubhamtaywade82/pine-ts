import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";

const requireCompatibleRuntime = (source: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

const windowValues = (source: Series<number>, length: number): number[] | undefined => {
  const values: number[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const value = source.at(offset);
    if (isNa(value)) return undefined;
    values.push(value);
  }
  return values;
};

const calculateVariance = (values: readonly number[], biased: boolean): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDeviation = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const denominator = biased ? values.length : values.length - 1;
  return denominator > 0 ? squaredDeviation / denominator : Number.NaN;
};

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
        const values = windowValues(source, length);
        return values === undefined ? Number.NaN : evaluateWindow(values);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const variance = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, `ta.variance:${biased}`, (values) => calculateVariance(values, biased));
};

export const stdev = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, `ta.stdev:${biased}`, (values) => Math.sqrt(calculateVariance(values, biased)));
};

export const dev = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  return createRollingStatistic(source, length, "ta.dev", (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
  });
};
