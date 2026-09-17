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

export const variance = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.variance", source, length, biased), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const values = windowValues(source, length);
        if (values === undefined) return Number.NaN;
        const mean = values.reduce((sum, value) => sum + value, 0) / length;
        const squaredDeviation = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
        const denominator = biased ? length : length - 1;
        return denominator > 0 ? squaredDeviation / denominator : Number.NaN;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const stdev = (source: Series<number>, length: number, biased = true): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.stdev", source, length, biased), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const values = windowValues(source, length);
        if (values === undefined) return Number.NaN;
        const mean = values.reduce((sum, value) => sum + value, 0) / length;
        const squaredDeviation = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
        const denominator = biased ? length : length - 1;
        return denominator > 0 ? Math.sqrt(squaredDeviation / denominator) : Number.NaN;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const dev = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.dev", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const values = windowValues(source, length);
        if (values === undefined) return Number.NaN;
        const mean = values.reduce((sum, value) => sum + value, 0) / length;
        return values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / length;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
