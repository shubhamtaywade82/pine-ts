import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";

const requireCompatibleRuntime = (source: Series<number>, other?: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  if (other !== undefined && other.runtime !== runtime) {
    throw new Error("TA operands must belong to the same PineSession");
  }
  return runtime;
};

export const mom = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.mom", source, length), () => {
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

export const roc = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.roc", source, length), () => {
    const definition = {
      warmupBars: length,
      init: (): null => null,
      evaluate: (): number => {
        const current = source.at(0);
        const previous = source.at(length);
        if (isNa(current) || isNa(previous) || previous === 0) return Number.NaN;
        return ((current - previous) / previous) * 100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const rsi = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rsi", source, length), () => {
    type State = {
      seedCount: number;
      gainSum: number;
      lossSum: number;
      averageGain: number;
      averageLoss: number;
      previousSource: number;
      seededSource: boolean;
    };
    const definition = {
      warmupBars: length,
      init: (): State => ({
        seedCount: 0,
        gainSum: 0,
        lossSum: 0,
        averageGain: Number.NaN,
        averageLoss: Number.NaN,
        previousSource: Number.NaN,
        seededSource: false,
      }),
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        if (isNa(current)) return Number.NaN;
        if (!state.seededSource) return Number.NaN;
        const delta = current - state.previousSource;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        if (state.seedCount < length) return Number.NaN;
        const averageGain = (state.averageGain * (length - 1) + gain) / length;
        const averageLoss = (state.averageLoss * (length - 1) + loss) / length;
        if (averageLoss === 0) return 100;
        if (averageGain === 0) return 0;
        return 100 - 100 / (1 + averageGain / averageLoss);
      },
      commit: (state: State): void => {
        const current = source.at(0);
        if (isNa(current)) return;
        if (!state.seededSource) {
          state.previousSource = current;
          state.seededSource = true;
          return;
        }
        const delta = current - state.previousSource;
        state.previousSource = current;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        if (state.seedCount < length) {
          state.seedCount += 1;
          state.gainSum += gain;
          state.lossSum += loss;
          if (state.seedCount === length) {
            state.averageGain = state.gainSum / length;
            state.averageLoss = state.lossSum / length;
          }
          return;
        }
        state.averageGain = (state.averageGain * (length - 1) + gain) / length;
        state.averageLoss = (state.averageLoss * (length - 1) + loss) / length;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const stoch = (
  source: Series<number>,
  peak: Series<number>,
  valley: Series<number>,
  length: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source, peak);
  requireCompatibleRuntime(source, valley);
  return runtime.nodes.getOrCreate(nodeKey("ta.stoch", source, peak, valley, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const current = source.at(0);
        if (isNa(current)) return Number.NaN;
        let highest = -Infinity;
        let lowest = Infinity;
        for (let offset = 0; offset < length; offset += 1) {
          const high = peak.at(offset);
          const low = valley.at(offset);
          if (isNa(high) || isNa(low)) return Number.NaN;
          highest = Math.max(highest, high);
          lowest = Math.min(lowest, low);
        }
        const range = highest - lowest;
        return range === 0 ? Number.NaN : ((current - lowest) / range) * 100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const wpr = (length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCurrentSession();
  const { high, low, close } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.wpr", high, low, close, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const current = close.at(0);
        if (isNa(current)) return Number.NaN;
        let highest = -Infinity;
        let lowest = Infinity;
        for (let offset = 0; offset < length; offset += 1) {
          const highValue = high.at(offset);
          const lowValue = low.at(offset);
          if (isNa(highValue) || isNa(lowValue)) return Number.NaN;
          highest = Math.max(highest, highValue);
          lowest = Math.min(lowest, lowValue);
        }
        const range = highest - lowest;
        return range === 0 ? Number.NaN : ((highest - current) / range) * -100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const cmo = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cmo", source, length), () => {
    type State = { changes: number[]; sumGain: number; sumLoss: number };
    const definition = {
      warmupBars: length,
      init: (): State => ({ changes: [], sumGain: 0, sumLoss: 0 }),
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        const previous = source.at(1);
        if (isNa(current) || isNa(previous) || state.changes.length < length - 1) return Number.NaN;
        const delta = current - previous;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        const total = state.sumGain + gain + state.sumLoss + loss;
        return total === 0 ? 0 : ((state.sumGain + gain - state.sumLoss - loss) / total) * 100;
      },
      commit: (state: State): void => {
        const current = source.at(0);
        const previous = source.at(1);
        if (isNa(current) || isNa(previous)) return;
        const delta = current - previous;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        state.changes.push(delta);
        state.sumGain += gain;
        state.sumLoss += loss;
        if (state.changes.length > length) {
          const removed = state.changes.shift() ?? 0;
          state.sumGain -= Math.max(removed, 0);
          state.sumLoss -= Math.max(-removed, 0);
        }
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
