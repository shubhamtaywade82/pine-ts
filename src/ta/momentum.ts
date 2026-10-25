import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
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

/**
 * `ta.stoch(source, peak, valley, length)`. Stochastic oscillator.
 *
 * Semantics corrected against PineScript-exported reference vectors (see
 * docs/ECOSYSTEM.md and tests/reference-pine-vectors.test.ts):
 *
 * - `na` values inside the `peak`/`valley` windows are SKIPPED: the windows
 *   collect the last `length` non-na values (v6 "na values are ignored").
 * - A zero range (highest === lowest) KEEPS THE PREVIOUS RESULT rather than
 *   returning na; before any first result it stays na.
 * - An `na` current source KEEPS THE PREVIOUS RESULT rather than returning
 *   na.
 * - Fewer than `length` non-na peak/valley values yields na.
 */
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
    interface State {
      /** The most recent stoch result; NaN before the first one. */
      previous: number;
    }
    /** Collects the last `length` non-na values of a series, oldest first. */
    const collectNonNa = (series: Series<number>): readonly number[] | undefined => {
      const window: number[] = [];
      let offset = 0;
      while (window.length < length) {
        const value = series.at(offset);
        if (value === undefined) return undefined;
        if (!isNa(value)) window.push(value);
        offset += 1;
      }
      return window;
    };
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        if (current === undefined || isNa(current)) {
          // na source: keep the previous result.
          return state.previous;
        }
        const highs = collectNonNa(peak);
        const lows = collectNonNa(valley);
        if (highs === undefined || lows === undefined) return Number.NaN;
        const highest = Math.max(...highs);
        const lowest = Math.min(...lows);
        const range = highest - lowest;
        if (range === 0) {
          // Zero range: keep the previous result (na before the first one).
          return state.previous;
        }
        return ((current - lowest) / range) * 100;
      },
      commit: (state: State): void => {
        const current = source.at(0);
        if (current === undefined || isNa(current)) return;
        const highs = collectNonNa(peak);
        const lows = collectNonNa(valley);
        if (highs === undefined || lows === undefined) return;
        const highest = Math.max(...highs);
        const lowest = Math.min(...lows);
        const range = highest - lowest;
        if (range === 0) return;
        state.previous = ((current - lowest) / range) * 100;
      },
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
      // Seed from committed history so a node created mid-run (a new
      // `series int` length) matches one that had been running all along.
      init: (): State => {
        const changes: number[] = [];
        let offset = 0;
        while (changes.length < length) {
          offset += 1;
          const current = source.at(offset);
          const previous = source.at(offset + 1);
          if (current === undefined || previous === undefined) break;
          if (!isNa(current) && !isNa(previous)) changes.push(current - previous);
        }
        changes.reverse();
        let sumGain = 0;
        let sumLoss = 0;
        for (const delta of changes) {
          sumGain += Math.max(delta, 0);
          sumLoss += Math.max(-delta, 0);
        }
        return { changes, sumGain, sumLoss };
      },
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
 * `ta.cci(source, length)`. Commodity Channel Index (Lambert).
 *
 * `CCI = (source - SMA(source, length)) / (0.015 * MD)` where `MD` is the
 * mean absolute deviation over the rolling length window.
 *
 * Flat-window semantics corrected against PineScript-exported reference
 * vectors (see docs/ECOSYSTEM.md and tests/reference-pine-vectors.test.ts):
 * when the mean deviation is 0 (within a 1e-10 tolerance), the built-in
 * KEEPS THE PREVIOUS CCI rather than returning na; a flat FIRST window
 * yields 0. Warm-up and na behavior follow the shared rolling-window
 * model (na current value yields na; fewer than `length` non-na values
 * yields na).
 */
export const cci = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cci", source, length), () => {
    interface State {
      /** The most recent CCI result; NaN before the first one. */
      previous: number;
    }
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const current = source.at(0);
        if (current === undefined || isNa(current)) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        const values = window.map((entry) => entry.value);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const md = values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
        // Flat window (MD ~ 0): keep the previous CCI; 0 for a first window.
        if (md <= 1e-10) return Number.isNaN(state.previous) ? 0 : state.previous;
        return (current - mean) / (0.015 * md);
      },
      commit: (state: State): void => {
        const current = source.at(0);
        if (current === undefined || isNa(current)) return;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return;
        const values = window.map((entry) => entry.value);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const md = values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
        if (md <= 1e-10) return;
        state.previous = (current - mean) / (0.015 * md);
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.tsi(source, short_length, long_length)`. True Strength Index.
 *
 * Corrected against the Pine built-in semantics, confirmed by
 * PineScript-exported reference vectors (see docs/ECOSYSTEM.md and
 * tests/reference-pine-vectors.test.ts):
 *
 * ```
 * PC = ta.change(source)              // 1-bar change, NOT source - source[long_length]
 * doubleSmoothedPC = ta.ema(ta.ema(PC, long_length), short_length)
 * doubleSmoothedAbsPC = ta.ema(ta.ema(math.abs(PC), long_length), short_length)
 * TSI = doubleSmoothedPC / doubleSmoothedAbsPC   // ratio in [-1, 1], NOT x100
 * ```
 *
 * The built-in returns a ratio, not a percentage-scaled value: the v6
 * reference remark states the result lies in [-1, +1] when defined, so
 * thresholds copied from x100 TSI charts must be rescaled by the caller.
 * A zero double-smoothed absolute change (constant source) yields na,
 * matching Pine's division-by-zero semantics. Composed from `ta.ema` and
 * `ta.change` so warm-up and na behavior are inherited from the verified
 * EMA model (SMA seed, na until the length-th valid value).
 */
export const tsi = (
  source: Series<number>,
  shortLength: number,
  longLength: number,
): FloatSeries => {
  requirePositiveLength(shortLength);
  requirePositiveLength(longLength);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.tsi", source, shortLength, longLength), () => {
    // 1-bar price change: ta.change(source) = source - source[1].
    const priceChange = change(source, 1);
    // math.abs applied per bar to the change series.
    const absChange = runtime.nodes.getOrCreate(nodeKey("ta.tsi.absChange", priceChange), () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          const v = priceChange.at(0);
          return v === undefined || isNa(v) ? Number.NaN : Math.abs(v);
        },
        commit: (): void => undefined,
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    }) as FloatSeries;
    const longSmoothed = ema(priceChange, longLength);
    const shortSmoothed = ema(longSmoothed, shortLength);
    const longAbsSmoothed = ema(absChange, longLength);
    const shortAbsSmoothed = ema(longAbsSmoothed, shortLength);
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const numerator = shortSmoothed.at(0);
        const denominator = shortAbsSmoothed.at(0);
        if (numerator === undefined || isNa(numerator)) return Number.NaN;
        if (denominator === undefined || isNa(denominator)) return Number.NaN;
        if (denominator === 0) return Number.NaN;
        // Ratio in [-1, 1] — the built-in does NOT scale by 100.
        return numerator / denominator;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.rci(source, length)`. Rank Correlation Index — Spearman rank
 * correlation between price and bar index over the rolling `length` window,
 * scaled to ±100. Tied prices receive average ranks (the v6 Reference Manual
 * behaviour), so the Pearson-on-ranks formula handles ties correctly:
 *
 * ```
 * r = Σ((t - t̄)(p - p̄)) / √(Σ(t - t̄)² × Σ(p - p̄)²)
 * RCI = 100 * r
 * ```
 *
 * where `t` is the time rank (1..length, fixed by position) and `p` is the
 * price rank within the window (tied prices share the average of the ranks
 * they would have occupied). A na current value yields na; fewer than
 * `length` non-na values (warm-up) yields na. A constant window (zero price
 * variance) yields na, matching the Pine remark that "all prices equal"
 * returns na.
 */
export const rci = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rci", source, length), () => {
    /** Assigns average ranks to ties, 1 = smallest value. */
    const averageRanks = (values: readonly number[]): number[] => {
      const indexed = values.map((value, index) => ({ value, index }));
      indexed.sort((a, b) => a.value - b.value);
      const ranks: number[] = values.map(() => 0);
      let i = 0;
      while (i < indexed.length) {
        let j = i + 1;
        while (j < indexed.length && indexed[j]!.value === indexed[i]!.value) j += 1;
        const avgRank = (i + 1 + j) / 2; // ranks are 1-based, average of i+1..j
        for (let k = i; k < j; k += 1) ranks[indexed[k]!.index] = avgRank;
        i = j;
      }
      return ranks;
    };
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        const prices = window.map((entry) => entry.value);
        const priceRanks = averageRanks(prices);
        // Time ranks are 1..length in window order (newest = length, oldest = 1).
        // That is, window[0] (newest, latest time) gets rank length, window[length-1]
        // (oldest) gets rank 1.
        const timeRanks: number[] = Array.from({ length }, (_, i) => length - i);
        const meanTime = (length + 1) / 2;
        const meanPrice = priceRanks.reduce((sum, r) => sum + r, 0) / length;
        let num = 0;
        let sumTime2 = 0;
        let sumPrice2 = 0;
        for (let i = 0; i < length; i += 1) {
          const dt = timeRanks[i]! - meanTime;
          const dp = priceRanks[i]! - meanPrice;
          num += dt * dp;
          sumTime2 += dt * dt;
          sumPrice2 += dp * dp;
        }
        const denom = Math.sqrt(sumTime2 * sumPrice2);
        if (denom === 0) return Number.NaN;
        return (100 * num) / denom;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
