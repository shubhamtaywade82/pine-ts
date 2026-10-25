import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import type { PineSession } from "../core/session.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";
import { PineArray } from "../array/pine-array.js";

const requireRuntime = (source: Series<number>): PineSession => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("TA series require a PineSession-owned source series");
  return runtime;
};

const requireBothRuntime = (a: Series<number>, b: Series<number>): PineSession => {
  const runtime = requireRuntime(a);
  if (b.runtime !== runtime) throw new Error("TA operands must belong to the same PineSession");
  return runtime;
};

/**
 * ta.cum — cumulative sum of `source` from the first bar.
 * na values contribute zero to the running total (Pine semantics: na terms are
 * skipped), and the output is na whenever the current bar value is na.
 */
export const cum = (source: Series<number>): FloatSeries => {
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.cum", source), () => {
    interface State {
      sum: number;
    }
    const definition = {
      init: (): State => ({ sum: 0 }),
      evaluate: (state: Readonly<State>): number => {
        const v = source.at(0);
        if (isNa(v)) return Number.NaN;
        return state.sum + v;
      },
      commit: (state: State): void => {
        const v = source.at(0);
        if (!isNa(v)) state.sum += v;
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.cross — true when `source` and `other` cross in either direction.
 * Equivalent to `ta.crossover(source, other) or ta.crossunder(source, other)`.
 */
export const cross = (source: Series<number>, other: Series<number>): BooleanSeries => {
  const runtime = requireBothRuntime(source, other);
  return runtime.nodes.getOrCreate(nodeKey("ta.cross", source, other), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): boolean => {
        const curr = source.at(0);
        const prev = source.at(1);
        const oCurr = other.at(0);
        const oPrev = other.at(1);
        if (isNa(curr) || isNa(prev) || isNa(oCurr) || isNa(oPrev)) return false;
        const crossedOver = prev < oPrev && curr > oCurr;
        const crossedUnder = prev > oPrev && curr < oCurr;
        return crossedOver || crossedUnder;
      },
      commit: (): void => undefined,
    };
    return new BooleanSeries(runtime, new IndicatorNode(definition));
  }) as BooleanSeries;
};

/**
 * ta.percentrank — the percentage of values in the `length` lookback window
 * that are strictly less than the current value. Returns 0–100.
 * Pine v6: na when fewer than `length` non-na bars exist.
 */
export const percentrank = (source: Series<number>, length: number): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("ta.percentrank", source, length), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        const current = window[0]?.value;
        if (current === undefined || isNa(current)) return Number.NaN;
        const below = window.filter((w) => w.value < current).length;
        return (below / length) * 100;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * ta.percentile_nearest_rank — returns the value at the given percentile using
 * the nearest-rank method: position = ceil(p/100 * length), 1-based in the
 * ascending-sorted window.
 * na when fewer than `length` non-na values exist.
 */
export const percentile_nearest_rank = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(
    nodeKey("ta.percentile_nearest_rank", source, length, percentage),
    () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          const window = collectNonNaWindow(source, length);
          if (window === undefined) return Number.NaN;
          const sorted = window.map((w) => w.value).sort((a, b) => a - b);
          // ceil(p/100 * n), clamped to [1, n], then 0-based index
          const rank = Math.min(Math.ceil((percentage / 100) * length), length);
          return sorted[rank - 1] ?? Number.NaN;
        },
        commit: (): void => undefined,
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    },
  ) as FloatSeries;
};

/**
 * ta.percentile_linear_interpolation — returns the value at the given
 * percentile using linear interpolation between the two adjacent ranked values.
 * Position h = (p/100) * (n-1) (0-based fractional index into the sorted array).
 * na when fewer than `length` non-na values exist.
 */
export const percentile_linear_interpolation = (
  source: Series<number>,
  length: number,
  percentage: number,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = requireRuntime(source);
  return runtime.nodes.getOrCreate(
    nodeKey("ta.percentile_linear_interpolation", source, length, percentage),
    () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          const window = collectNonNaWindow(source, length);
          if (window === undefined) return Number.NaN;
          const sorted = window.map((w) => w.value).sort((a, b) => a - b);
          // Fractional 0-based index
          const h = (percentage / 100) * (length - 1);
          const lo = Math.floor(h);
          const hi = Math.ceil(h);
          const vLo = sorted[lo];
          const vHi = sorted[hi];
          if (vLo === undefined || vHi === undefined) return Number.NaN;
          return vLo + (vHi - vLo) * (h - lo);
        },
        commit: (): void => undefined,
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    },
  ) as FloatSeries;
};

/**
 * Pivot point chart styles accepted by `pivot_point_levels`. Mirrors the
 * TradingView v6 Reference Manual `pivot_point_levels` parameter values.
 */
export type PivotPointStyle =
  "TRADITIONAL" | "FIBONACCI" | "WOODIE" | "CLASSIC" | "DE_MARK" | "CAMARILLA";

/**
 * `ta.pivot_point_levels(type, anchor?)`. Returns a `PineArray<number>` of
 * 11 pivot levels — `[PP, R1, S1, R2, S2, R3, S3, R4, S4, R5, S5]` — computed
 * from the previous anchor period's high/low/close. The anchor condition
 * (default: timeframe.change("1D")) marks bar boundaries where the levels
 * reset.
 *
 * Implemented chart styles:
 * - `TRADITIONAL` (default): the standard Floor Trader Pivots formula.
 * - `FIBONACCI`: PP and resistance/support levels derived from Fibonacci
 *   ratios of the previous period range.
 * - `WOODIE`: places more weight on the close: `PP = (2*C + H + L) / 4`.
 * - `CLASSIC`: same as TRADITIONAL minus the R4/S4/R5/S5 levels (those
 *   slots return 0).
 * - `DE_MARK`: `PP = (H + L + 2*C) / 4` (DeMark's pivot formula).
 * - `CAMARILLA`: uses the Camarilla equation with multipliers of the
 *   previous range.
 *
 * The implementation is `draft` — formulas transcribed from the documented
 * v6 Reference Manual behaviour; pinning against TradingView-exported
 * reference vectors is the next milestone.
 */
export const pivot_point_levels = (
  type: PivotPointStyle = "TRADITIONAL",
  anchor?: BooleanSeries,
): PineArray<number> => {
  // Pivot points do not derive from a single source series — they consume
  // the OHLCV sources of the active session directly. The function is
  // session-scoped (it uses the runtime's sources) and recomputes on
  // every bar where the anchor condition is true; otherwise it returns
  // the previously-committed levels.
  //
  // We model this as a `Series<PineArray<number>>` whose evaluate/commit
  // lifecycle tracks the running H/L/C of the current anchor period and
  // recomputes the levels on each anchor bar. The function returns the
  // current bar's levels (i.e. `series.at(0)`).
  const runtime = requireCurrentSession();
  const { high, low, close } = runtime.sources;
  const levelsSeries = runtime.nodes.getOrCreate(
    nodeKey("ta.pivot_point_levels", type, anchor ?? high),
    () => {
      interface State {
        levels: PineArray<number>;
        /** Tracks the bar index of the last anchor so we know if we need to recompute. */
        lastAnchorBar: number;
        /** Running high/low/close for the current anchor period. */
        periodHigh: number;
        periodLow: number;
        periodClose: number;
        periodOpen: number;
      }
      const reset = anchor ?? dailyAnchorForPivots(runtime);
      const computeLevels = (h: number, l: number, c: number, o: number): PineArray<number> => {
        const levels = computePivotLevels(type, h, l, c, o);
        return new PineArray<number>(levels);
      };
      const definition = {
        init: (): State => ({
          levels: new PineArray<number>(new Array(11).fill(0)),
          lastAnchorBar: -1,
          periodHigh: Number.NaN,
          periodLow: Number.NaN,
          periodClose: Number.NaN,
          periodOpen: Number.NaN,
        }),
        evaluate: (state: Readonly<State>): PineArray<number> => {
          const h = high.at(0);
          const l = low.at(0);
          const c = close.at(0);
          if (
            h === undefined ||
            l === undefined ||
            c === undefined ||
            isNa(h) ||
            isNa(l) ||
            isNa(c)
          ) {
            return state.levels;
          }
          if (reset.at(0)) {
            // Anchor bar: compute new levels from the PREVIOUS period's
            // H/L/C. On the very first anchor, the previous period is
            // undefined; levels stay at 0.
            if (state.lastAnchorBar < 0) {
              return new PineArray<number>(new Array(11).fill(0));
            }
            return computeLevels(
              state.periodHigh,
              state.periodLow,
              state.periodClose,
              state.periodOpen,
            );
          }
          return state.levels;
        },
        commit: (state: State): void => {
          const h = high.at(0);
          const l = low.at(0);
          const c = close.at(0);
          if (
            h === undefined ||
            l === undefined ||
            c === undefined ||
            isNa(h) ||
            isNa(l) ||
            isNa(c)
          ) {
            return;
          }
          if (reset.at(0)) {
            // Anchor bar: reset the running period H/L/C; the previous
            // period's values are already consumed by `evaluate` for the
            // levels computation.
            state.periodHigh = h;
            state.periodLow = l;
            state.periodClose = c;
            state.periodOpen = c;
            state.lastAnchorBar = runtime.barIndex;
            state.levels = computeLevels(h, l, c, c);
            return;
          }
          // Non-anchor bar: extend the running period H/L/C.
          state.periodHigh = isNa(state.periodHigh) ? h : Math.max(state.periodHigh, h);
          state.periodLow = isNa(state.periodLow) ? l : Math.min(state.periodLow, l);
          state.periodClose = c;
        },
      };
      return new Series<PineArray<number>>(runtime, new IndicatorNode(definition));
    },
  );
  // Return the current bar's levels (or a zero-filled PineArray if the
  // series has no value yet — e.g. on the very first bar before any
  // anchor has fired).
  return levelsSeries.at(0) ?? new PineArray<number>(new Array(11).fill(0));
};

/**
 * Builds the default `pivot_point_levels` anchor: true on the first bar of
 * each new trading day in the symbol timezone, mirroring the reference
 * default of `timeframe.change("1D")`.
 */
const dailyAnchorForPivots = (runtime: PineSession): BooleanSeries => {
  const { time } = runtime.sources;
  const timezone = runtime.getSymbolInfo().timezone ?? "UTC";
  return runtime.nodes.getOrCreate(
    nodeKey("ta.pivot_point_levels.anchorDaily", time, timezone),
    () => {
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
    },
  ) as BooleanSeries;
};

/**
 * Computes the 11 pivot levels for the given chart style from the previous
 * anchor period's high/low/close (and open, for DeMark).
 *
 * Returns `[PP, R1, S1, R2, S2, R3, S3, R4, S4, R5, S5]`.
 */
const computePivotLevels = (
  type: PivotPointStyle,
  high: number,
  low: number,
  close: number,
  open: number,
): number[] => {
  const range = high - low;
  switch (type) {
    case "TRADITIONAL": {
      const pp = (high + low + close) / 3;
      const r1 = 2 * pp - low;
      const s1 = 2 * pp - high;
      const r2 = pp + range;
      const s2 = pp - range;
      const r3 = high + 2 * (pp - low);
      const s3 = low - 2 * (high - pp);
      const r4 = r3 + range;
      const s4 = s3 - range;
      const r5 = r4 + range;
      const s5 = s4 - range;
      return [pp, r1, s1, r2, s2, r3, s3, r4, s4, r5, s5];
    }
    case "FIBONACCI": {
      const pp = (high + low + close) / 3;
      const r1 = pp + 0.382 * range;
      const s1 = pp - 0.382 * range;
      const r2 = pp + 0.618 * range;
      const s2 = pp - 0.618 * range;
      const r3 = pp + 1.0 * range;
      const s3 = pp - 1.0 * range;
      const r4 = pp + 1.382 * range;
      const s4 = pp - 1.382 * range;
      const r5 = pp + 1.618 * range;
      const s5 = pp - 1.618 * range;
      return [pp, r1, s1, r2, s2, r3, s3, r4, s4, r5, s5];
    }
    case "WOODIE": {
      const pp = (2 * close + high + low) / 4;
      const r1 = 2 * pp - low;
      const s1 = 2 * pp - high;
      const r2 = pp + range;
      const s2 = pp - range;
      const r3 = high + 2 * (pp - low);
      const s3 = low - 2 * (high - pp);
      const r4 = r3 + range;
      const s4 = s3 - range;
      const r5 = r4 + range;
      const s5 = s4 - range;
      return [pp, r1, s1, r2, s2, r3, s3, r4, s4, r5, s5];
    }
    case "CLASSIC": {
      const pp = (high + low + close) / 3;
      const r1 = 2 * pp - low;
      const s1 = 2 * pp - high;
      const r2 = pp + range;
      const s2 = pp - range;
      const r3 = high + 2 * (pp - low);
      const s3 = low - 2 * (high - pp);
      // Classic does not define R4/S4/R5/S5.
      return [pp, r1, s1, r2, s2, r3, s3, 0, 0, 0, 0];
    }
    case "DE_MARK": {
      // DeMark's pivot formula uses the open: if close < open, the
      // formula differs slightly. The most common form is:
      //   if close < open: PP = (high + low + 2*close) / 4
      //   else:             PP = (2*high + low + close) / 4
      // (Some sources use a single formula; we follow the standard.)
      const pp = close < open ? (high + low + 2 * close) / 4 : (2 * high + low + close) / 4;
      const r1 = 2 * pp - low;
      const s1 = 2 * pp - high;
      return [pp, r1, s1, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    case "CAMARILLA": {
      const pp = (high + low + close) / 3;
      const r1 = close + (range * 1.1) / 12;
      const s1 = close - (range * 1.1) / 12;
      const r2 = close + (range * 1.1) / 6;
      const s2 = close - (range * 1.1) / 6;
      const r3 = close + (range * 1.1) / 4;
      const s3 = close - (range * 1.1) / 4;
      const r4 = close + (range * 1.1) / 2;
      const s4 = close - (range * 1.1) / 2;
      const r5 = close + range * 1.1;
      const s5 = close - range * 1.1;
      return [pp, r1, s1, r2, s2, r3, s3, r4, s4, r5, s5];
    }
    default: {
      const zeros: number[] = [];
      for (let i = 0; i < 11; i += 1) zeros.push(0);
      return zeros;
    }
  }
};
