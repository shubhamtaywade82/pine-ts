import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { zipSeries } from "../core/series-operators.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { change, ema } from "./core.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";

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
    interface State {
      seedCount: number;
      gainSum: number;
      lossSum: number;
      averageGain: number;
      averageLoss: number;
      previousSource: number;
      seededSource: boolean;
    }
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
        if (isNa(current) || !state.seededSource) return Number.NaN;
        const delta = current - state.previousSource;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        // Wilder seeding completes on the bar that supplies the length-th
        // change, so the seeding bar itself must already report an RSI value.
        let averageGain: number;
        let averageLoss: number;
        if (state.seedCount < length - 1) return Number.NaN;
        if (state.seedCount === length - 1) {
          averageGain = (state.gainSum + gain) / length;
          averageLoss = (state.lossSum + loss) / length;
        } else {
          averageGain = (state.averageGain * (length - 1) + gain) / length;
          averageLoss = (state.averageLoss * (length - 1) + loss) / length;
        }
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
    interface State {
      changes: number[];
      sumGain: number;
      sumLoss: number;
    }
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

/**
 * ta.cci — Commodity Channel Index.
 *
 * Per the v6 reference: "the difference between the typical price of a
 * commodity and its simple moving average, divided by the mean absolute
 * deviation of the typical price. The index is scaled by an inverse factor of
 * 0.015". The remark "na values in the source series are ignored" selects the
 * skip-na statistics window. A zero mean deviation divides to na in Pine.
 */
export const cci = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cci", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        const current = source.at(0);
        if (isNa(current)) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        let sum = 0;
        for (const { value } of window) sum += value;
        const mean = sum / length;
        let deviationSum = 0;
        for (const { value } of window) deviationSum += Math.abs(value - mean);
        const meanDeviation = deviationSum / length;
        if (meanDeviation === 0) return Number.NaN;
        return (current - mean) / (0.015 * meanDeviation);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.cog — Center of Gravity oscillator.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `sum = math.sum(source, length)`, `num = Σ price * (i + 1)` over bar
 * offsets `i = 0 to length - 1`, result `-num / sum`. The remark "na values
 * in the source series are ignored" selects the skip-na window; weights apply
 * positionally to the collected non-na values (1 for the most recent,
 * `length` for the oldest). A zero sum divides to na in Pine.
 */
export const cog = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cog", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        let weightedSum = 0;
        let sum = 0;
        for (let index = 0; index < window.length; index += 1) {
          const value = window[index]!.value;
          weightedSum += value * (index + 1);
          sum += value;
        }
        if (sum === 0) return Number.NaN;
        return -weightedSum / sum;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * Creates (or reuses) a cached float-valued derived series. Operand series and
 * `name` form the cache key, so any numeric parameter captured by `evaluate`
 * must be embedded in `name` to keep distinct parameters from colliding.
 */
const deriveFloatSeries = (
  operands: readonly Series<number>[],
  name: string,
  evaluate: () => number,
): FloatSeries => {
  const runtime = operands[0]?.runtime;
  if (runtime === undefined) {
    throw new Error("Derived series require PineSession-owned sources");
  }
  if (operands.some((series) => series.runtime !== runtime)) {
    throw new Error("Derived series operands must belong to the same PineSession");
  }
  return runtime.nodes.getOrCreate(nodeKey(name, ...operands), () => {
    const definition = {
      init: (): null => null,
      evaluate,
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.tsi — True Strength Index.
 *
 * Double-smoothed momentum per the v6 reference ("It uses moving averages of
 * the underlying momentum"): nested EMAs of `ta.change(source)` and of its
 * absolute value, `ema(ema(momentum, long_length), short_length)` divided by
 * `ema(ema(|momentum|, long_length), short_length)`. The v6 reference pins the
 * range as [-1, 1], so no 100 scale factor is applied. The remark "na values
 * in the source series are ignored" is carried by the EMA seeding (each EMA
 * seeds on its first non-na input); the first bar's na momentum yields na. A
 * zero double-smoothed absolute momentum divides to na in Pine.
 */
export const tsi = (
  source: Series<number>,
  shortLength: number,
  longLength: number,
): FloatSeries => {
  requirePositiveLength(shortLength);
  requirePositiveLength(longLength);
  requireCompatibleRuntime(source);
  const momentum = change(source);
  const absoluteMomentum = zipSeries(momentum, momentum, "ta.tsi.abs", (value) =>
    value === undefined ? Number.NaN : Math.abs(value),
  );
  const numerator = ema(ema(momentum, longLength), shortLength);
  const denominator = ema(ema(absoluteMomentum, longLength), shortLength);
  return deriveFloatSeries([numerator, denominator], "ta.tsi", () => {
    const numeratorValue = numerator.at(0);
    const denominatorValue = denominator.at(0);
    if (isNa(numeratorValue) || isNa(denominatorValue) || denominatorValue === 0) {
      return Number.NaN;
    }
    return numeratorValue / denominatorValue;
  });
};
