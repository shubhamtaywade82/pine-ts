import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { zipSeries } from "../core/series-operators.js";
import { requirePositiveLength } from "./validation.js";

const requireCompatibleRuntime = <T>(source: Series<T>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

export const sma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.sma", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let sum = 0;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          if (isNa(value)) return Number.NaN;
          sum += value;
        }
        return sum / length;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const ema = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.ema", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): { value: number | undefined } => ({ value: undefined }),
      evaluate: (state: { value: number | undefined }): number => {
        const current = source.at(0);
        if (isNa(current)) return Number.NaN;
        if (runtime.barIndex < length - 1) return Number.NaN;
        if (state.value === undefined) {
          let sum = 0;
          for (let offset = 0; offset < length; offset += 1) {
            const value = source.at(offset);
            if (isNa(value)) return Number.NaN;
            sum += value;
          }
          state.value = sum / length;
          return state.value;
        }
        state.value = (2 / (length + 1)) * current + (1 - 2 / (length + 1)) * state.value;
        return state.value;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const rma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rma", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): { value: number | undefined } => ({ value: undefined }),
      evaluate: (state: { value: number | undefined }): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        const current = source.at(0);
        if (isNa(current)) return Number.NaN;
        if (state.value === undefined) {
          let sum = 0;
          for (let offset = 0; offset < length; offset += 1) {
            const value = source.at(offset);
            if (isNa(value)) return Number.NaN;
            sum += value;
          }
          state.value = sum / length;
        } else {
          state.value = (state.value * (length - 1) + current) / length;
        }
        return state.value;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const tr = (source: Series<number>): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.tr", source), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const bar = runtime.currentBar;
        if (bar === undefined) return Number.NaN;
        if (runtime.barIndex === 0) return bar.high - bar.low;
        const previousClose = source.at(1);
        if (isNa(previousClose)) return Number.NaN;
        return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const atr = (source: Series<number>, length: number): FloatSeries => rma(tr(source), length);

export const wma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.wma", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let weightedSum = 0;
        let weightSum = 0;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          if (isNa(value)) return Number.NaN;
          const weight = length - offset;
          weightedSum += value * weight;
          weightSum += weight;
        }
        return weightedSum / weightSum;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const vwma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.vwma", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let weightedSum = 0;
        let volumeSum = 0;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          const volume = runtime.sources.volume.at(offset);
          if (isNa(value) || isNa(volume)) return Number.NaN;
          weightedSum += value * volume;
          volumeSum += volume;
        }
        return volumeSum === 0 ? Number.NaN : weightedSum / volumeSum;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const swma = (source: Series<number>): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.swma", source), () => {
    const definition = {
      warmupBars: 3,
      init: (): null => null,
      evaluate: (): number => {
        const current = source.at(0);
        const one = source.at(1);
        const two = source.at(2);
        const three = source.at(3);
        if (isNa(current) || isNa(one) || isNa(two) || isNa(three)) return Number.NaN;
        return (current + 2 * one + 2 * two + three) / 6;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const hma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const halfLength = Math.max(1, Math.floor(length / 2));
  const sqrtLength = Math.max(1, Math.floor(Math.sqrt(length)));
  const fast = wma(source, halfLength);
  const slow = wma(source, length);
  const leading = zipSeries(fast, slow, "ta.hma.leading", (fastValue, slowValue) => {
    if (isNa(fastValue) || isNa(slowValue)) return Number.NaN;
    return 2 * fastValue - slowValue;
  });
  return wma(leading, sqrtLength);
};

export const highest = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.highest", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let result = -Infinity;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          if (isNa(value)) return Number.NaN;
          result = Math.max(result, value);
        }
        return result;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const lowest = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.lowest", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let result = Infinity;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          if (isNa(value)) return Number.NaN;
          result = Math.min(result, value);
        }
        return result;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const change = (source: Series<number>, length = 1): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.change", source, length), () => {
    const definition = {
      warmupBars: length,
      init: (): null => null,
      evaluate: (): number => {
        const current = source.at(0);
        const previous = source.at(length);
        return isNa(current) || isNa(previous) ? Number.NaN : current - previous;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const crossover = (source: Series<number>, level: number): import("../core/series.js").BooleanSeries => {
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.crossover", source, level), () => {
    const definition = {
      warmupBars: 1,
      init: (): null => null,
      evaluate: (): boolean => {
        const current = source.at(0);
        const previous = source.at(1);
        return !isNa(current) && !isNa(previous) && current > level && previous <= level;
      },
      commit: (): void => undefined,
    };
    return new (require("../core/series.js") as never)();
  }) as import("../core/series.js").BooleanSeries;
};
