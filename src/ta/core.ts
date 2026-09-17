import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { requireCurrentSession } from "../core/execution-context.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";

const requirePositiveLength = (length: number): void => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
};

const requireCompatibleRuntime = (source: Series<number>, other?: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  if (other !== undefined && other.runtime !== runtime) {
    throw new Error("TA operands must belong to the same PineSession");
  }
  return runtime;
};

export const sma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.sma", source, length), () => {
    type State = { buffer: number[]; sum: number };
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ buffer: [], sum: 0 }),
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (isNa(value) || state.buffer.length < length - 1) return Number.NaN;
        const oldest = state.buffer.length === length ? state.buffer[0] : undefined;
        return (state.sum - (oldest ?? 0) + value) / length;
      },
      commit: (state: State): void => {
        const value = source.at(0);
        if (isNa(value)) return;
        state.buffer.push(value);
        state.sum += value;
        if (state.buffer.length > length) state.sum -= state.buffer.shift() ?? 0;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const ema = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.ema", source, length), () => {
    type State = { seeded: boolean; previous: number };
    const alpha = 2 / (length + 1);
    const definition = {
      init: (): State => ({ seeded: false, previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (isNa(value)) return Number.NaN;
        return state.seeded ? alpha * value + (1 - alpha) * state.previous : value;
      },
      commit: (state: State): void => {
        const value = source.at(0);
        if (!isNa(value)) {
          state.previous = state.seeded ? alpha * value + (1 - alpha) * state.previous : value;
          state.seeded = true;
        }
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const rma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rma", source, length), () => {
    type State = { seedValues: number[]; seedSum: number; previous: number };
    const alpha = 1 / length;
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ seedValues: [], seedSum: 0, previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (isNa(value)) return Number.NaN;
        if (state.seedValues.length < length) {
          if (state.seedValues.length + 1 < length) return Number.NaN;
          return (state.seedSum + value) / length;
        }
        return alpha * value + (1 - alpha) * state.previous;
      },
      commit: (state: State): void => {
        const value = source.at(0);
        if (isNa(value)) return;
        if (state.seedValues.length < length) {
          state.seedValues.push(value);
          state.seedSum += value;
          if (state.seedValues.length === length) state.previous = state.seedSum / length;
          return;
        }
        state.previous = alpha * value + (1 - alpha) * state.previous;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const tr = (handleNa = true): FloatSeries => {
  const runtime = requireCurrentSession();
  const { high, low, close } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.tr", high, low, close, handleNa), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const highValue = high.at(0);
        const lowValue = low.at(0);
        const previousClose = close.at(1);
        if (isNa(highValue) || isNa(lowValue)) return Number.NaN;
        if (isNa(previousClose)) return handleNa ? highValue - lowValue : Number.NaN;
        return Math.max(
          highValue - lowValue,
          Math.abs(highValue - previousClose),
          Math.abs(lowValue - previousClose),
        );
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const atr = (length: number): FloatSeries => {
  requirePositiveLength(length);
  return rma(tr(true), length);
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

export const crossover = (source: Series<number>, other: Series<number>): Series<boolean> => {
  const runtime = requireCompatibleRuntime(source, other);
  return runtime.nodes.getOrCreate(nodeKey("ta.crossover", source, other), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): boolean => {
        const source0 = source.at(0);
        const source1 = source.at(1);
        const other0 = other.at(0);
        const other1 = other.at(1);
        if (isNa(source0) || isNa(source1) || isNa(other0) || isNa(other1)) return false;
        return source0 > other0 && source1 <= other1;
      },
      commit: (): void => undefined,
    };
    return new Series<boolean>(runtime, new IndicatorNode(definition));
  });
};

export const crossunder = (source: Series<number>, other: Series<number>): Series<boolean> => {
  const runtime = requireCompatibleRuntime(source, other);
  return runtime.nodes.getOrCreate(nodeKey("ta.crossunder", source, other), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): boolean => {
        const source0 = source.at(0);
        const source1 = source.at(1);
        const other0 = other.at(0);
        const other1 = other.at(1);
        if (isNa(source0) || isNa(source1) || isNa(other0) || isNa(other1)) return false;
        return source0 < other0 && source1 >= other1;
      },
      commit: (): void => undefined,
    };
    return new Series<boolean>(runtime, new IndicatorNode(definition));
  });
};
