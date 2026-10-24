import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";

const requireCompatibleRuntime = (source: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

/** ta.cum contribution: na terms are skipped rather than poisoning the sum. */
const cumulativeContribution = (term: number | undefined): number =>
  term === undefined || isNa(term) ? 0 : term;

/**
 * ta.obv — On Balance Volume.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `ta.cum(math.sign(ta.change(close)) * volume)`. A na change (first bar or a
 * na close) contributes nothing, matching Pine's cum() skipping na terms.
 */
export const obv = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.obv", close, volume), () => {
    interface State {
      sum: number;
    }
    const contribution = (): number | undefined => {
      const current = close.at(0);
      const previous = close.at(1);
      const volumeValue = volume.at(0);
      if (isNa(current) || isNa(previous) || isNa(volumeValue)) return undefined;
      return Math.sign(current - previous) * volumeValue;
    };
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number =>
        state.sum + cumulativeContribution(contribution()),
      commit: (state: State): void => {
        state.sum += cumulativeContribution(contribution());
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.pvt — Price Volume Trend.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `ta.cum((ta.change(close) / close[1]) * volume)`. Division by a zero
 * previous close is na in Pine, so the bar contributes nothing.
 */
export const pvt = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.pvt", close, volume), () => {
    interface State {
      sum: number;
    }
    const contribution = (): number | undefined => {
      const current = close.at(0);
      const previous = close.at(1);
      const volumeValue = volume.at(0);
      if (isNa(current) || isNa(previous) || isNa(volumeValue)) return undefined;
      if (previous === 0) return undefined;
      return ((current - previous) / previous) * volumeValue;
    };
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number =>
        state.sum + cumulativeContribution(contribution()),
      commit: (state: State): void => {
        state.sum += cumulativeContribution(contribution());
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

interface VolumeIndexState {
  value: number;
}

/**
 * Shared Positive/Negative Volume Index state machine, transcribed from the
 * v6 Reference Manual re-implementations:
 *
 * - seeds at 1.0;
 * - a zero or na close on either side of the comparison carries the previous
 *   value (the `nz(close) == 0` guard in the reference);
 * - updates only when the volume comparison holds (`>` for PVI, `<` for NVI);
 *   a na volume[1] reads as 0 through `nz`, and a na current volume makes the
 *   comparison false in Pine v6 boolean semantics;
 * - `nz(prev, 0) == 0` promotes a zero previous value back to the 1.0 seed.
 */
const createVolumeIndex = (name: string, volumeIncreases: boolean): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey(name, close, volume), () => {
    const resolve = (state: Readonly<VolumeIndexState>): number => {
      const current = close.at(0);
      const previous = close.at(1);
      if (isNa(current) || isNa(previous) || current === 0 || previous === 0) {
        return state.value;
      }
      const volumeValue = volume.at(0);
      if (isNa(volumeValue)) return state.value;
      const previousVolume = volume.at(1) ?? 0;
      const updates = volumeIncreases ? volumeValue > previousVolume : volumeValue < previousVolume;
      if (!updates) return state.value;
      return state.value + ((current - previous) / previous) * state.value;
    };
    const definition = {
      init: (): VolumeIndexState => ({ value: 1 }),
      evaluate: (state: Readonly<VolumeIndexState>): number => {
        const previous = state.value === 0 ? 1 : state.value;
        return resolve({ value: previous });
      },
      commit: (state: VolumeIndexState): void => {
        if (state.value === 0) state.value = 1;
        state.value = resolve(state);
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/** ta.pvi — Positive Volume Index: updates only when volume rises. */
export const pvi = (): FloatSeries => createVolumeIndex("ta.pvi", true);

/** ta.nvi — Negative Volume Index: updates only when volume falls. */
export const nvi = (): FloatSeries => createVolumeIndex("ta.nvi", false);

/**
 * ta.mfi — Money Flow Index.
 *
 * Literal transcription of the v6 Reference Manual re-implementation, which
 * uses plain `math.sum` windows (not Wilder smoothing):
 *
 * - `upper = math.sum(volume * (ta.change(src) <= 0 ? 0 : src), length)`
 * - `lower = math.sum(volume * (ta.change(src) >= 0 ? 0 : src), length)`
 * - `mfi = 100 - 100 / (1 + upper / lower)`
 *
 * Pine v6 boolean semantics make comparisons against na false, so a na change
 * (the first bar) adds `volume * src` to BOTH sums. `math.sum` skips na terms
 * and computes on the last `length` non-na values. `upper / lower` is na when
 * `lower` is zero (no negative flow in the window), so the MFI is na then.
 */
export const mfi = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  const { volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.mfi", source, volume, length), () => {
    interface State {
      upper: number[];
      lower: number[];
    }
    /** na flows (na volume or na src) never enter the windows. */
    const flows = (offset = 0): { readonly upper: number; readonly lower: number } | undefined => {
      const src = source.at(offset);
      const volumeValue = volume.at(offset);
      if (isNa(volumeValue) || isNa(src)) return undefined;
      const previous = source.at(offset + 1);
      const change = previous === undefined || isNa(previous) ? undefined : src - previous;
      // na change comparisons are false in Pine v6, so both branches pick src.
      const upper = change !== undefined && change <= 0 ? 0 : volumeValue * src;
      const lower = change !== undefined && change >= 0 ? 0 : volumeValue * src;
      return { upper, lower };
    };
    const windowSum = (values: readonly number[]): number | undefined => {
      if (values.length < length) return undefined;
      let sum = 0;
      for (let index = 0; index < length; index += 1) sum += values[index] ?? 0;
      return sum;
    };
    const definition = {
      warmupBars: length,
      // Seed from committed history (newest first) so a node created mid-run
      // (a new `series int` length) matches one that had been running all along.
      init: (): State => {
        const state: State = { upper: [], lower: [] };
        let offset = 0;
        while (state.upper.length < length) {
          offset += 1;
          if (source.at(offset) === undefined) break;
          const flow = flows(offset);
          if (flow === undefined) continue;
          state.upper.push(flow.upper);
          state.lower.push(flow.lower);
        }
        return state;
      },
      evaluate: (state: Readonly<State>): number => {
        const flow = flows();
        const upperWindow = flow === undefined ? state.upper : [flow.upper, ...state.upper];
        const lowerWindow = flow === undefined ? state.lower : [flow.lower, ...state.lower];
        const upper = windowSum(upperWindow);
        const lower = windowSum(lowerWindow);
        if (upper === undefined || lower === undefined || lower === 0) return Number.NaN;
        return 100 - 100 / (1 + upper / lower);
      },
      commit: (state: State): void => {
        const flow = flows();
        if (flow === undefined) return;
        state.upper.unshift(flow.upper);
        state.lower.unshift(flow.lower);
        if (state.upper.length > length) {
          state.upper.length = length;
          state.lower.length = length;
        }
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

interface VwapState {
  started: boolean;
  sumPriceVolume: number;
  sumVolume: number;
}

/**
 * Builds the default `ta.vwap` anchor: true on the first bar of each new
 * trading day in the symbol timezone, mirroring the reference default of
 * `timeframe.change("1D")`. Stateless — it derives purely from `time`
 * history, so realtime ticks roll back naturally.
 */
const dailyAnchor = (): BooleanSeries => {
  const runtime = requireCurrentSession();
  const { time } = runtime.sources;
  const timezone = runtime.getSymbolInfo().timezone ?? "UTC";
  return runtime.nodes.getOrCreate(nodeKey("ta.vwap.anchorDaily", time, timezone), () => {
    // One formatter per node (and thus per runtime + timezone combination).
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dayKey = (timestamp: number): string => formatter.format(new Date(timestamp * 1000));
    const definition = {
      init: (): null => null,
      evaluate: (): boolean => {
        const current = time.at(0);
        const previous = time.at(1);
        if (current === undefined) return false;
        if (previous === undefined) return true;
        return dayKey(current) !== dayKey(previous);
      },
      commit: (): void => undefined,
    };
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};

/**
 * ta.vwap — Volume Weighted Average Price.
 *
 * Implements the v6 single-value overload
 * `ta.vwap(source, anchor) → series float`. The anchor condition resets the
 * accumulated sums; the default anchor is a daily boundary change in the
 * symbol timezone. Per the reference: "Calculations only begin the first time
 * the anchor condition becomes true. Until then, the function returns na."
 * The anchor bar itself belongs to the new accumulation window.
 *
 * Bars with a na source or na volume contribute nothing (they cannot poison
 * the cumulative sums); when nothing has accumulated yet the result is na.
 * The `stdev_mult` tuple overload is planned and intentionally not shipped.
 */
export const vwap = (source: Series<number>, anchor?: Series<boolean>): FloatSeries => {
  const runtime = requireCompatibleRuntime(source);
  const { volume } = runtime.sources;
  const reset = anchor ?? dailyAnchor();
  return runtime.nodes.getOrCreate(nodeKey("ta.vwap", source, volume, reset), () => {
    const readAccumulators = (
      state: Readonly<VwapState>,
    ): { sumPriceVolume: number; sumVolume: number } => {
      const src = source.at(0);
      const volumeValue = volume.at(0);
      if (isNa(src) || isNa(volumeValue)) return state;
      const contribution = src * volumeValue;
      if (reset.at(0)) {
        return { sumPriceVolume: contribution, sumVolume: volumeValue };
      }
      return {
        sumPriceVolume: state.sumPriceVolume + contribution,
        sumVolume: state.sumVolume + volumeValue,
      };
    };
    const definition = {
      init: (): VwapState => ({ started: false, sumPriceVolume: 0, sumVolume: 0 }),
      evaluate: (state: Readonly<VwapState>): number => {
        if (!state.started && !reset.at(0)) return Number.NaN;
        const { sumPriceVolume, sumVolume } = readAccumulators(state);
        if (sumVolume === 0) return Number.NaN;
        return sumPriceVolume / sumVolume;
      },
      commit: (state: VwapState): void => {
        if (!state.started && !reset.at(0)) return;
        state.started = true;
        const { sumPriceVolume, sumVolume } = readAccumulators(state);
        state.sumPriceVolume = sumPriceVolume;
        state.sumVolume = sumVolume;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.accdist — Accumulation/Distribution Index.
 *
 * The v6 reference entry documents the variable but ships no re-implementation,
 * so this follows the standard Chaikin accumulation/distribution line that the
 * TradingView chart indicator uses:
 * `ta.cum(((close - low) - (high - close)) / (high - low) * volume)`.
 * A zero bar range makes the term na in Pine (division by zero), so the bar
 * contributes nothing.
 */
export const accdist = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, low, high, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.accdist", close, low, high, volume), () => {
    interface State {
      sum: number;
    }
    const contribution = (): number | undefined => {
      const closeValue = close.at(0);
      const lowValue = low.at(0);
      const highValue = high.at(0);
      const volumeValue = volume.at(0);
      if (
        isNa(closeValue) ||
        isNa(lowValue) ||
        isNa(highValue) ||
        isNa(volumeValue) ||
        highValue === lowValue
      ) {
        return undefined;
      }
      return (
        ((closeValue - lowValue - (highValue - closeValue)) / (highValue - lowValue)) * volumeValue
      );
    };
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number =>
        state.sum + cumulativeContribution(contribution()),
      commit: (state: State): void => {
        state.sum += cumulativeContribution(contribution());
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.iii` — Intraday Intensity Index (David Bostian, featured in Bollinger's
 * "Bollinger on Bollinger Bands"). Per-bar intensity
 * `((2 * close - high - low) / (high - low)) * volume` accumulated cumulatively
 * (`ta.cum` of the per-bar term), matching the documented Bostian formula.
 * A zero bar range makes the per-bar term na (division by zero), so the bar
 * contributes nothing to the cumulative sum — consistent with the
 * `ta.cum` and `ta.accdist` conventions used elsewhere.
 *
 * The v6 reference entry documents `ta.iii` as a variable that takes no
 * arguments and reads the current bar's OHLCV. The first bar's contribution
 * has no `close[1]` to compare against, so on the first bar the term is na
 * and the cumulative sum stays at zero (mirroring `ta.obv`'s first-bar
 * behaviour).
 */
export const iii = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, low, high, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.iii", close, low, high, volume), () => {
    interface State {
      sum: number;
    }
    const contribution = (): number | undefined => {
      const closeValue = close.at(0);
      const lowValue = low.at(0);
      const highValue = high.at(0);
      const volumeValue = volume.at(0);
      if (
        isNa(closeValue) ||
        isNa(lowValue) ||
        isNa(highValue) ||
        isNa(volumeValue) ||
        highValue === lowValue
      ) {
        return undefined;
      }
      return (((2 * closeValue - highValue - lowValue) / (highValue - lowValue)) * volumeValue);
    };
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number =>
        state.sum + cumulativeContribution(contribution()),
      commit: (state: State): void => {
        state.sum += cumulativeContribution(contribution());
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.wad` — Williams Accumulation/Distribution. Cumulative line that does
 * NOT use volume. Per the v6 Reference Manual re-implementation documented
 * at pineify.app/.../wad:
 *
 * - trueHigh = max(high, prevClose)
 * - trueLow = min(low, prevClose)
 * - if close > prevClose: contribution = close - trueLow (positive)
 * - if close < prevClose: contribution = close - trueHigh (negative)
 * - if close == prevClose: contribution = 0
 * - WAD = prevWAD + contribution
 *
 * The first bar has no previous close, so it seeds the cumulative line at
 * zero (matching `ta.obv`'s first-bar convention). A na close, high, or low
 * on either side of the comparison makes the contribution undefined, so the
 * bar contributes nothing to the cumulative sum.
 */
export const wad = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, low, high } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.wad", close, low, high), () => {
    interface State {
      sum: number;
      previousClose: number;
      seeded: boolean;
    }
    const contribution = (state: Readonly<State>): number | undefined => {
      const closeValue = close.at(0);
      const lowValue = low.at(0);
      const highValue = high.at(0);
      if (isNa(closeValue) || isNa(lowValue) || isNa(highValue)) return undefined;
      if (!state.seeded) return 0;
      if (isNa(state.previousClose)) return undefined;
      const trueHigh = Math.max(highValue, state.previousClose);
      const trueLow = Math.min(lowValue, state.previousClose);
      if (closeValue > state.previousClose) return closeValue - trueLow;
      if (closeValue < state.previousClose) return closeValue - trueHigh;
      return 0;
    };
    /** Apply the WAD contribution rule for a single committed bar. */
    const applyBarContribution = (
      sum: number,
      closeValue: number,
      previousClose: number,
      highValue: number,
      lowValue: number,
    ): number => {
      const trueHigh = Math.max(highValue, previousClose);
      const trueLow = Math.min(lowValue, previousClose);
      if (closeValue > previousClose) return sum + (closeValue - trueLow);
      if (closeValue < previousClose) return sum + (closeValue - trueHigh);
      return sum;
    };
    const definition = {
      init: (): State => {
        // Seed from committed history so a node created mid-run matches one
        // that had been running all along.
        let sum = 0;
        let previousClose = Number.NaN;
        let seeded = false;
        let offset = 1;
        while (true) {
          const c = close.at(offset);
          if (c === undefined) break;
          if (!isNa(c)) {
            const h = high.at(offset);
            const l = low.at(offset);
            if (seeded && !isNa(h) && !isNa(l)) {
              sum = applyBarContribution(sum, c, previousClose, h, l);
            }
            previousClose = c;
            seeded = true;
          }
          offset += 1;
        }
        return { sum, previousClose, seeded };
      },
      evaluate: (state: Readonly<State>): number =>
        state.sum + cumulativeContribution(contribution(state)),
      commit: (state: State): void => {
        const contributionValue = contribution(state);
        if (contributionValue !== undefined) state.sum += contributionValue;
        const current = close.at(0);
        if (!isNa(current)) {
          state.previousClose = current;
          state.seeded = true;
        }
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.wvad` — Williams Variable Accumulation/Distribution. Per the v6
 * Reference Manual re-implementation:
 * `(close - open) / (high - low) * volume` (per-bar, non-cumulative; the
 * v6 reference's documented equivalent re-implementation returns the per-bar
 * value without a cumulative sum).
 *
 * A zero bar range (high == low) makes the term na (division by zero),
 * matching the convention used by `ta.accdist` and `ta.iii`. A na value in
 * any of open, high, low, close, or volume yields na for the bar.
 *
 * Note: classic Larry Williams WVAD is cumulative; v6's `ta.wvad` returns
 * the per-bar term per the documented re-implementation. Mark as draft
 * pending a pinned TradingView reference vector.
 */
export const wvad = (): FloatSeries => {
  const runtime = requireCurrentSession();
  const { close, open, low, high, volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.wvad", close, open, low, high, volume), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const closeValue = close.at(0);
        const openValue = open.at(0);
        const lowValue = low.at(0);
        const highValue = high.at(0);
        const volumeValue = volume.at(0);
        if (
          isNa(closeValue) ||
          isNa(openValue) ||
          isNa(lowValue) ||
          isNa(highValue) ||
          isNa(volumeValue) ||
          highValue === lowValue
        ) {
          return Number.NaN;
        }
        return ((closeValue - openValue) / (highValue - lowValue)) * volumeValue;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
