import { PineArray } from "../array/pine-array.js";
import { requireCurrentSession } from "../core/execution-context.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { Series } from "../core/series.js";

/** The six `ta.pivot_point_levels` calculation types. */
export type PivotType = "Traditional" | "Fibonacci" | "Woodie" | "Classic" | "DM" | "Camarilla";

const LEVEL_COUNT = 11;

const naLevels = (): number[] => Array.from({ length: LEVEL_COUNT }, () => Number.NaN);

/**
 * The level formulas below are TradingView's own "Pivot Points Standard"
 * definitions (support article 43000521824), expressed over one anchor
 * period's high/low/close/open. Level order is the v6 reference's
 * `[P, R1, S1, R2, S2, R3, S3, R4, S4, R5, S5]`; levels a type does not
 * define stay `na` (the reference's DM example: only P, R1, S1).
 *
 * `previousOpen` and `currentOpen` serve different types: Woodie's pivot
 * uses the *current* period's open (the bar where the new period starts),
 * while DM's doji check compares the *completed* period's open and close.
 */
const computeRawLevels = (
  type: PivotType,
  high: number,
  low: number,
  close: number,
  previousOpen: number,
  currentOpen: number,
): number[] => {
  const na = Number.NaN;
  switch (type) {
    case "Traditional": {
      const p = (high + low + close) / 3;
      return [
        p,
        p * 2 - low,
        p * 2 - high,
        p + (high - low),
        p - (high - low),
        p * 2 + (high - 2 * low),
        p * 2 - (2 * high - low),
        p * 3 + (high - 3 * low),
        p * 3 - (3 * high - low),
        p * 4 + (high - 4 * low),
        p * 4 - (4 * high - low),
      ];
    }
    case "Fibonacci": {
      const p = (high + low + close) / 3;
      return [
        p,
        p + 0.382 * (high - low),
        p - 0.382 * (high - low),
        p + 0.618 * (high - low),
        p - 0.618 * (high - low),
        p + (high - low),
        p - (high - low),
        na,
        na,
        na,
        na,
      ];
    }
    case "Woodie": {
      const p = (high + low + 2 * currentOpen) / 4;
      const r3 = high + 2 * (p - low);
      const s3 = low - 2 * (high - p);
      return [
        p,
        2 * p - low,
        2 * p - high,
        p + (high - low),
        p - (high - low),
        r3,
        s3,
        r3 + (high - low),
        s3 - (high - low),
        na,
        na,
      ];
    }
    case "Classic": {
      const p = (high + low + close) / 3;
      return [
        p,
        2 * p - low,
        2 * p - high,
        p + (high - low),
        p - (high - low),
        p + 2 * (high - low),
        p - 2 * (high - low),
        p + 3 * (high - low),
        p - 3 * (high - low),
        na,
        na,
      ];
    }
    case "DM": {
      let x = 2 * low + high + close;
      if (isOpenCloseNeutral(previousOpen, close)) x = high + low + 2 * close;
      else if (close > previousOpen) x = 2 * high + low + close;
      return [x / 4, x / 2 - low, x / 2 - high, na, na, na, na, na, na, na, na];
    }
    case "Camarilla": {
      const p = (high + low + close) / 3;
      const range = 1.1 * (high - low);
      const r5 = (high / low) * close;
      return [
        p,
        close + range / 12,
        close - range / 12,
        close + range / 6,
        close - range / 6,
        close + range / 4,
        close - range / 4,
        close + range / 2,
        close - range / 2,
        r5,
        close - (r5 - close),
      ];
    }
  }
};

/** DM's doji check: the completed period opened and closed at the same price. */
const isOpenCloseNeutral = (open: number, close: number): boolean => open === close;

interface PivotState {
  periodHigh: number;
  periodLow: number;
  periodClose: number;
  periodOpen: number;
  hasData: boolean;
  lastLevels: number[] | undefined;
}

/**
 * ta.pivot_point_levels — the anchor-driven pivot point engine.
 *
 * The `anchor` condition marks the first bar of a new period. On an anchor
 * bar the returned levels come from the period that just closed (or stay
 * `na` before the first completed period); `developing = true` instead
 * recalculates on the running period — the bars since the last anchor, or
 * bar zero when no anchor has fired yet. Woodie cannot develop (its pivot
 * depends on the period's open, which is never a developing quantity), and
 * the v6 reference makes that pairing a runtime error.
 *
 * Returns a `PineArray<number>` of the eleven `[P, R1, S1, ..., R5, S5]`
 * levels for the current bar. Like every stateful `ta.*` built-in the
 * accumulation lives in a session-owned node: `evaluate` never mutates it
 * and `commit` advances it, so realtime revisions roll back cleanly.
 */
export const pivotPointLevels = (
  type: PivotType,
  anchor: Series<boolean>,
  developing = false,
): PineArray<number> => {
  if (type === "Woodie" && developing) {
    throw new Error(
      "The developing parameter cannot be true when type is 'Woodie': the Woodie pivot depends on the period's open, which is never developing",
    );
  }
  const session = requireCurrentSession();
  if (anchor.runtime !== session) {
    throw new Error("ta.pivot_point_levels operands must belong to the current PineSession");
  }

  const series = session.nodes.getOrCreate(
    nodeKey("ta.pivot_point_levels", type, anchor, developing),
    () => {
      const readSources = () => {
        const sources = session.sources;
        return {
          high: sources.high.value,
          low: sources.low.value,
          close: sources.close.value,
          open: sources.open.value,
        };
      };
      const definition = {
        init: (): PivotState => ({
          periodHigh: Number.NaN,
          periodLow: Number.NaN,
          periodClose: Number.NaN,
          periodOpen: Number.NaN,
          hasData: false,
          lastLevels: undefined,
        }),
        evaluate: (state: Readonly<PivotState>): PineArray<number> => {
          const { high, low, close, open } = readSources();
          const anchored = anchor.at(0) ?? false;
          if (developing) {
            // A developing pivot tracks the running period. On the anchor
            // bar (and before any anchor has fired) the window is the
            // current bar alone; afterwards it is the bars since the anchor
            // merged with the current bar.
            if (anchored || !state.hasData) {
              return PineArray.createRoot<number>(
                computeRawLevels(type, high, low, close, open, open),
              );
            }
            return PineArray.createRoot<number>(
              computeRawLevels(
                type,
                Math.max(state.periodHigh, high),
                Math.min(state.periodLow, low),
                close,
                state.periodOpen,
                open,
              ),
            );
          }
          if (anchored) {
            if (!state.hasData) return PineArray.createRoot<number>(naLevels());
            return PineArray.createRoot<number>(
              computeRawLevels(
                type,
                state.periodHigh,
                state.periodLow,
                state.periodClose,
                state.periodOpen,
                open,
              ),
            );
          }
          return state.lastLevels === undefined
            ? PineArray.createRoot<number>(naLevels())
            : PineArray.createRoot<number>(state.lastLevels);
        },
        commit: (state: PivotState): void => {
          const { high, low, close, open } = readSources();
          const anchored = anchor.at(0) ?? false;
          if (anchored) {
            state.lastLevels = state.hasData
              ? computeRawLevels(
                  type,
                  state.periodHigh,
                  state.periodLow,
                  state.periodClose,
                  state.periodOpen,
                  open,
                )
              : undefined;
            state.periodHigh = high;
            state.periodLow = low;
            state.periodClose = close;
            state.periodOpen = open;
            state.hasData = true;
            return;
          }
          if (!state.hasData) {
            state.periodHigh = high;
            state.periodLow = low;
            state.periodClose = close;
            state.periodOpen = open;
            state.hasData = true;
            return;
          }
          state.periodHigh = Math.max(state.periodHigh, high);
          state.periodLow = Math.min(state.periodLow, low);
          state.periodClose = close;
        },
      };
      return new Series<PineArray<number>>(
        session,
        new IndicatorNode<PivotState, PineArray<number>>(definition),
      );
    },
  );
  return series.at(0)!;
};
