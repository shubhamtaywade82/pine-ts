import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { zipSeries } from "../core/series-operators.js";
import { RunningSum } from "./running-sum.js";
import { collectCommittedNonNa, collectNonNaWindow } from "./window.js";

const requirePositiveLength = (length: number): void => {
  if (!Number.isInteger(length) || length <= 0)
    throw new RangeError("length must be a positive integer");
};

const requireCompatibleRuntime = (source: Series<number>, other?: Series<number>) => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  if (other !== undefined && other.runtime !== runtime)
    throw new Error("TA operands must belong to the same PineSession");
  return runtime;
};

/**
 * `ta.sma(source, length)`. Simple moving average over the last `length`
 * non-na values.
 *
 * Uses the compensated (Kahan) running-sum kernel that PineScript uses
 * internally (see {@link RunningSum}), so the result matches Pine's output
 * bit-for-bit on cancellation-heavy windows — including the residues Pine
 * keeps on `[0, 0]` windows that a plain `sum / length` would zero out.
 *
 * Pine v6 windowing:
 * - na values in the source series are ignored — the window collects the last
 *   `length` non-na values (an na current bar keeps the previous result).
 * - Fewer than `length` non-na values (warm-up) yields na.
 *
 * Seeding for mid-run node creation (a `series int` length change) replays
 * the last `length` non-na committed values through the kernel so the new
 * node matches one that had been running all along.
 */
export const sma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.sma", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): RunningSum => {
        const rs = new RunningSum();
        const history = collectCommittedNonNa(source, length);
        for (const value of history) {
          rs.step(value, length);
          rs.commit();
        }
        return rs;
      },
      evaluate: (rs: Readonly<RunningSum>): number => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) {
          // Pine treats na and +/-Infinity as "no value" in window functions;
          // the bar keeps the previous result, matching OakScriptJS's isNa.
          return rs.stepNa(length);
        }
        const sum = rs.step(value, length);
        return Number.isNaN(sum) ? Number.NaN : sum / length;
      },
      commit: (rs: RunningSum): void => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) {
          // stepNa still applies the (possibly new) length to kept state.
          rs.stepNa(length);
        } else {
          rs.step(value, length);
        }
        rs.commit();
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * Kahan-compensated accumulation matching the Pine running-sum model,
 * as measured bit-for-bit by OakScriptJS (#136, #142; MIT). Pine does not
 * re-sum a window: it keeps a compensated running sum. When the pending
 * compensation would be absorbed by the new value (lost), the sum is
 * recomputed NEWEST-FIRST and the compensation resets. Reproducing this
 * chain in the EMA seed is what makes `ta.tsi` agree with PineScript
 * reference vectors to the last bit (tests/reference-pine-vectors.test.ts).
 */
const compensationLost = (x: number, c: number): boolean => {
  if (c === 0 || x === 0) return false;
  const size = Math.abs(c);
  return Math.abs(x + size - x) < size;
};

/**
 * Replays the Kahan accumulation chain over `values` (arrival order,
 * oldest first) and returns the compensated sum. `lastValue` is the bar's
 * own value; when its step would lose the compensation, the sum is
 * recomputed newest-first (current value first), as in Pine.
 */
const kahanSum = (buffer: readonly number[], lastValue: number): number => {
  let s = 0;
  let c = 0;
  for (const value of buffer) {
    if (compensationLost(value, c)) {
      let fresh = value;
      // New value first, then the stored values newest → oldest.
      const prior = buffer.slice(0, buffer.indexOf(value));
      for (let k = prior.length - 1; k >= 0; k -= 1) fresh += prior[k]!;
      s = fresh;
      c = 0;
    } else {
      const y = value - c;
      const t = s + y;
      c = t - s - y;
      s = t;
    }
  }
  // The current bar's value is the last arrival.
  if (compensationLost(lastValue, c)) {
    let fresh = lastValue;
    for (let k = buffer.length - 1; k >= 0; k -= 1) fresh += buffer[k]!;
    return fresh;
  }
  const y = lastValue - c;
  const t = s + y;
  return t;
};

/**
 * `ta.ema(source, length)`. Exponential moving average.
 *
 * Seeding and warm-up follow the Pine built-in model, confirmed against
 * PineScript-exported reference vectors (see docs/ECOSYSTEM.md): the EMA
 * returns `na` until the bar that supplies the `length`-th valid source
 * value, and seeds with `ta.sma` of those first `length` valid values
 * (not with the first value). From the next bar on it applies
 * `alpha * value + (1 - alpha) * previous` with `alpha = 2 / (length + 1)`.
 *
 * The seed uses the Kahan-compensated accumulation order of Pine's running
 * sum (see {@link kahanSum}), so downstream compositions such as `ta.tsi`
 * match PineScript output bit-for-bit.
 *
 * `na` (and ±Infinity) source values are skipped during warm-up and produce
 * `na` afterwards; the smoothing state (`previous`) is preserved across
 * such bars, so the next valid bar continues from the last EMA value.
 */
export const ema = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.ema", source, length), () => {
    interface State {
      /** The first `length` valid source values, oldest first. */
      seedBuffer: number[];
      previous: number;
    }
    const alpha = 2 / (length + 1);
    const seedSma = (state: Readonly<State>, value: number): number =>
      kahanSum(state.seedBuffer, value) / length;
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ seedBuffer: [], previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) return Number.NaN;
        if (state.seedBuffer.length < length - 1) return Number.NaN;
        if (state.seedBuffer.length === length - 1) {
          // Seed bar: SMA of the first `length` valid values (Kahan order).
          return seedSma(state, value);
        }
        // Pine evaluates (value - previous) * alpha + previous; the algebraic
        // form alpha*value + (1-alpha)*previous differs in the last bits.
        return (value - state.previous) * alpha + state.previous;
      },
      commit: (state: State): void => {
        const value = source.at(0);
        // na bars never enter the seed buffer and never move `previous`.
        if (value === undefined || !Number.isFinite(value)) return;
        if (state.seedBuffer.length < length) {
          if (state.seedBuffer.length === length - 1) {
            state.previous = seedSma(state, value);
          }
          state.seedBuffer.push(value);
          return;
        }
        // Pine evaluates (value - previous) * alpha + previous; the algebraic
        // form alpha*value + (1-alpha)*previous differs in the last bits.
        state.previous = (value - state.previous) * alpha + state.previous;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * `ta.rma(source, length)`. Wilder's smoothing (Running Moving Average).
 *
 * Same warm-up model as {@link ema}, confirmed against the Pine built-in:
 * `na` until the bar supplying the `length`-th valid value, seeded with
 * `ta.sma` of the first `length` valid values (Kahan running-sum order).
 * The recurrence is Pine's exact form `(value + (length - 1) * previous) /
 * length` — the algebraic form `alpha * value + (1 - alpha) * previous`
 * differs in the last bits (documented by OakScriptJS, #136).
 *
 * `na` source values are skipped during warm-up and produce `na` afterwards;
 * `previous` is preserved across na bars.
 */
export const rma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.rma", source, length), () => {
    interface State {
      /** The first `length` valid source values, oldest first. */
      seedBuffer: number[];
      previous: number;
    }
    const seedSma = (state: Readonly<State>, value: number): number =>
      kahanSum(state.seedBuffer, value) / length;
    const definition = {
      warmupBars: length - 1,
      init: (): State => ({ seedBuffer: [], previous: Number.NaN }),
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) return Number.NaN;
        if (state.seedBuffer.length < length - 1) return Number.NaN;
        if (state.seedBuffer.length === length - 1) {
          return seedSma(state, value);
        }
        return (value + (length - 1) * state.previous) / length;
      },
      commit: (state: State): void => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) return;
        if (state.seedBuffer.length < length) {
          if (state.seedBuffer.length === length - 1) {
            state.previous = seedSma(state, value);
          }
          state.seedBuffer.push(value);
          return;
        }
        state.previous = (value + (length - 1) * state.previous) / length;
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

/**
 * One step of the PineScript `ta.wma` weighted sum: `a + b`, or `0` when
 * `|a + b| <= 1e-10 * max(1, |a| + |b|)`. Measured bit-for-bit by
 * OakScriptJS (#136; MIT): a partial sum that cancels to a tiny residue
 * (relative to the operands, or below 1e-10) is 0 — not the residue.
 *
 * Attribution: arithmetic transcribed from OakScriptJS's `wmaAdd`
 * (`src/ta/index.ts`, MIT, v0.12.3); see `docs/ECOSYSTEM.md` rule 4.
 */
const wmaAdd = (a: number, b: number): number => {
  const sum = a + b;
  return Math.abs(sum) <= 1e-10 * Math.max(1, Math.abs(a) + Math.abs(b)) ? 0 : sum;
};

/**
 * `ta.wma(source, length)`. Weighted moving average with linearly
 * decreasing weights (newest = `length`, oldest in window = `1`).
 *
 * PineScript v6 semantics (verified bit-for-bit against PineScript-exported
 * reference vectors in `tests/reference-pine-vectors-wma.test.ts`):
 *
 * - The sum is computed OLDEST-FIRST (weight 1, 2, ..., `length`) using the
 *   {@link wmaAdd} cancellation rule, so a partial sum that cancels to a
 *   tiny residue is `0`, not the residue.
 * - `na` and `±Infinity` source values are SKIPPED for warm-up counting,
 *   but an `na` value INSIDE the window is replaced by the most recent
 *   non-na value (carry-forward fill).
 * - A bar whose OWN source is `na` returns `na` (even if the window has
 *   enough non-na history). Warm-up returns `na` until `length` non-na
 *   values have been received.
 *
 * Attribution: arithmetic transcribed from OakScriptJS's `wma`
 * (`src/ta/index.ts`, MIT, v0.12.3); see `docs/ECOSYSTEM.md` rule 4.
 */
export const wma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.wma", source, length), () => {
    interface State {
      /**
       * The last `length` source values (including na-filled), OLDEST-FIRST.
       * The current bar's value is NOT yet in `filled` at evaluate time;
       * `evaluate` builds a virtual window by appending `source.at(0)`.
       */
      filled: number[];
      /** The most recent non-na source value (carry-forward fill source). */
      last: number;
      /** Count of non-na values committed so far (excludes current bar). */
      count: number;
    }
    /**
     * Builds the window for the current bar: the last `length - 1` entries
     * of `filled` plus the current value (or `last` if the current value
     * is na — though evaluate returns na in that case, this is the
     * hypothetical window used by callers that want to inspect).
     */
    const windowWith = (state: Readonly<State>, current: number): readonly number[] => {
      const start = Math.max(0, state.filled.length - (length - 1));
      return [...state.filled.slice(start), current];
    };
    /** Sums the window oldest-first using `wmaAdd`, matching Pine's order. */
    const sumWindow = (window: readonly number[]): number => {
      let sum = 0;
      for (let i = 0; i < window.length; i += 1) {
        const weight = i + 1; // 1 for oldest, length for newest
        sum = wmaAdd(sum, window[i]! * weight);
      }
      return sum / ((length * (length + 1)) / 2);
    };
    const definition = {
      warmupBars: length - 1,
      init: (): State => {
        // Replay committed history (newest first → oldest), filling na
        // values with the previous non-na. Seeds a node created mid-run
        // to match one that had been running all along.
        const filled: number[] = [];
        let last = Number.NaN;
        let count = 0;
        let offset = 1;
        while (filled.length < length) {
          const v = source.at(offset);
          if (v === undefined) break;
          if (!Number.isFinite(v)) {
            // na or Infinity bar — fill with last non-na (if any).
            if (!Number.isNaN(last)) {
              filled.unshift(last);
            }
            offset += 1;
            continue;
          }
          last = v;
          count += 1;
          filled.unshift(v);
          offset += 1;
        }
        return { filled, last, count };
      },
      evaluate: (state: Readonly<State>): number => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) return Number.NaN;
        // The current bar will increment count on commit; check the
        // post-commit count here so warm-up matches Pine (which counts
        // the current bar before deciding whether to compute).
        if (state.count + 1 < length) return Number.NaN;
        // Read the oldest bar in the window to trigger the maxBarsBack
        // bounds check (matches the OLD wma's per-bar loop semantics).
        // The result is unused — the actual window comes from `state.filled`
        // (carry-forward fill for na bars) + the current bar's value.
        // Use a typeof guard so eslint doesn't flag void-use; the read itself
        // is what triggers the RangeError when offset > maxBarsBack.
        const _oldest = source.at(length - 1);
        if (_oldest === undefined) return Number.NaN;
        return sumWindow(windowWith(state, value));
      },
      commit: (state: State): void => {
        const value = source.at(0);
        if (value === undefined || !Number.isFinite(value)) {
          // na bar: don't increment count, but fill with the previous non-na
          // value so the next bar's window can still see `length` values.
          if (!Number.isNaN(state.last)) {
            state.filled.push(state.last);
            if (state.filled.length > length) state.filled.shift();
          }
          return;
        }
        state.last = value;
        state.count += 1;
        state.filled.push(value);
        if (state.filled.length > length) state.filled.shift();
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

export const vwma = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  const { volume } = runtime.sources;
  return runtime.nodes.getOrCreate(nodeKey("ta.vwma", source, volume, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        let numerator = 0;
        let denominator = 0;
        for (let offset = 0; offset < length; offset += 1) {
          const value = source.at(offset);
          const volumeValue = volume.at(offset);
          if (isNa(value) || isNa(volumeValue)) return Number.NaN;
          numerator += value * volumeValue;
          denominator += volumeValue;
        }
        return denominator === 0 ? Number.NaN : numerator / denominator;
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
    if (fastValue === undefined || slowValue === undefined) return Number.NaN;
    return 2 * fastValue - slowValue;
  });
  return wma(leading, sqrtLength);
};

/**
 * ta.highest — highest value over the last `length` non-na values.
 *
 * Pine v6 remark: "na values in the source series are ignored", so na bars
 * inside the window are skipped and the scan extends back to collect `length`
 * non-na values. A na current value yields na, matching the verified `ta.sma`
 * model; fewer than `length` non-na values (warm-up) yield na as well.
 */
export const highest = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.highest", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        let result = -Infinity;
        for (const { value } of window) result = Math.max(result, value);
        return result;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.lowest — lowest value over the last `length` non-na values.
 *
 * Same na and warm-up model as {@link highest}.
 */
export const lowest = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireCompatibleRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.lowest", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        let result = Infinity;
        for (const { value } of window) result = Math.min(result, value);
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

export const crossover = (source: Series<number>, other: Series<number>): BooleanSeries => {
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
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};

export const crossunder = (source: Series<number>, other: Series<number>): BooleanSeries => {
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
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};
