import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";

/**
 * ta.sar — Parabolic SAR.
 *
 * Literal transcription of the `pine_sar` re-implementation published in the
 * v6 Reference Manual entry for `ta.sar`: bar 0 is na, bar 1 seeds the trend
 * direction from `close > close[1]` with the SAR at the previous bar's
 * opposite extreme, and every later bar applies the acceleration step,
 * reverses when price crosses the SAR, advances the extreme point and
 * acceleration factor on a continuing trend, then clamps the SAR within the
 * last two bars' lows (uptrend) or highs (downtrend). State advances
 * exclusively in `commit`, so realtime ticks re-evaluate against the last
 * committed state and roll back naturally.
 */
interface SarState {
  result: number;
  maxMin: number;
  acceleration: number;
  isBelow: boolean;
}

interface SarBarReads {
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly close1: number;
  readonly low1: number;
  readonly low2: number;
  readonly high1: number;
  readonly high2: number;
}

interface SarStep {
  readonly output: number;
  readonly next: SarState;
}

/** Working values while a single `pine_sar` bar is being resolved. */
interface SarWorking {
  result: number;
  maxMin: number;
  acceleration: number;
  isBelow: boolean;
  isFirstTrendBar: boolean;
}

/** Bar 1 seeds the trend direction and the initial SAR/extreme point. */
const seedFirstTrendBar = (
  working: SarWorking,
  reads: Readonly<SarBarReads>,
  start: number,
): void => {
  if (reads.close > reads.close1) {
    working.isBelow = true;
    working.maxMin = reads.high;
    working.result = reads.low1;
  } else {
    working.isBelow = false;
    working.maxMin = reads.low;
    working.result = reads.high1;
  }
  working.isFirstTrendBar = true;
  working.acceleration = start;
};

/** Reverses the trend when price crosses the SAR, resetting the extreme. */
const applyReversal = (working: SarWorking, reads: Readonly<SarBarReads>, start: number): void => {
  if (working.isBelow) {
    if (working.result > reads.low) {
      working.isFirstTrendBar = true;
      working.isBelow = false;
      working.result = Math.max(reads.high, working.maxMin);
      working.maxMin = reads.low;
      working.acceleration = start;
    }
    return;
  }
  if (working.result < reads.high) {
    working.isFirstTrendBar = true;
    working.isBelow = true;
    working.result = Math.min(reads.low, working.maxMin);
    working.maxMin = reads.high;
    working.acceleration = start;
  }
};

/** Advances the extreme point and acceleration factor on a continuing trend. */
const advanceExtreme = (
  working: SarWorking,
  reads: Readonly<SarBarReads>,
  increment: number,
  maximum: number,
): void => {
  if (working.isBelow) {
    if (reads.high > working.maxMin) {
      working.maxMin = reads.high;
      working.acceleration = Math.min(working.acceleration + increment, maximum);
    }
    return;
  }
  if (reads.low < working.maxMin) {
    working.maxMin = reads.low;
    working.acceleration = Math.min(working.acceleration + increment, maximum);
  }
};

/** Clamps the SAR within the last two bars' lows (uptrend) or highs (downtrend). */
const clampSar = (working: SarWorking, barIndex: number, reads: Readonly<SarBarReads>): void => {
  if (working.isBelow) {
    working.result = Math.min(working.result, reads.low1);
    if (barIndex > 1) working.result = Math.min(working.result, reads.low2);
    return;
  }
  working.result = Math.max(working.result, reads.high1);
  if (barIndex > 1) working.result = Math.max(working.result, reads.high2);
};

/**
 * One bar of the Parabolic SAR algorithm, split into the phases above. Pure
 * so `evaluate` and `commit` compute the identical step; only `commit` stores
 * `next` as the new state. NaN comparisons are false, which reproduces Pine
 * `na` handling without special cases.
 */
const stepSar = (
  previous: Readonly<SarState>,
  barIndex: number,
  reads: Readonly<SarBarReads>,
  start: number,
  increment: number,
  maximum: number,
): SarStep => {
  const working: SarWorking = { ...previous, isFirstTrendBar: false };

  if (barIndex === 1) seedFirstTrendBar(working, reads, start);

  working.result = working.result + working.acceleration * (working.maxMin - working.result);

  applyReversal(working, reads, start);
  if (!working.isFirstTrendBar) advanceExtreme(working, reads, increment, maximum);
  clampSar(working, barIndex, reads);

  return {
    output: working.result,
    next: {
      result: working.result,
      maxMin: working.maxMin,
      acceleration: working.acceleration,
      isBelow: working.isBelow,
    },
  };
};

const requireFiniteParameter = (name: string, value: number): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
};

export const sar = (start: number, increment: number, maximum: number): FloatSeries => {
  requireFiniteParameter("start", start);
  requireFiniteParameter("increment", increment);
  requireFiniteParameter("maximum", maximum);
  const runtime = requireCurrentSession();
  const { high, low, close } = runtime.sources;
  return runtime.nodes.getOrCreate(
    nodeKey("ta.sar", high, low, close, start, increment, maximum),
    () => {
      const readBar = (): SarBarReads => ({
        high: high.at(0) ?? Number.NaN,
        low: low.at(0) ?? Number.NaN,
        close: close.at(0) ?? Number.NaN,
        close1: close.at(1) ?? Number.NaN,
        low1: low.at(1) ?? Number.NaN,
        low2: low.at(2) ?? Number.NaN,
        high1: high.at(1) ?? Number.NaN,
        high2: high.at(2) ?? Number.NaN,
      });
      const definition = {
        warmupBars: 1,
        init: (): SarState => ({
          result: Number.NaN,
          maxMin: Number.NaN,
          acceleration: Number.NaN,
          isBelow: false,
        }),
        evaluate: (state: Readonly<SarState>): number => {
          if (runtime.barIndex === 0) return Number.NaN;
          return stepSar(state, runtime.barIndex, readBar(), start, increment, maximum).output;
        },
        commit: (state: SarState): void => {
          if (runtime.barIndex === 0) return;
          const { next } = stepSar(state, runtime.barIndex, readBar(), start, increment, maximum);
          state.result = next.result;
          state.maxMin = next.maxMin;
          state.acceleration = next.acceleration;
          state.isBelow = next.isBelow;
        },
      };
      return new FloatSeries(runtime, new IndicatorNode(definition));
    },
  ) as FloatSeries;
};

/**
 * ta.linreg — linear regression curve.
 *
 * `linreg = intercept + slope * (length - 1 - offset)` where intercept and
 * slope come from a least-squares fit over the last `length` bars with x = 0
 * at the oldest bar of the window. `offset` 0 returns the line value at the
 * current bar, `length - 1` the value at the window start. Per the v6
 * reference, na values in the source are included in the calculation and
 * produce an na result.
 */
export const linreg = (source: Series<number>, length: number, offset: number): FloatSeries => {
  requirePositiveLength(length);
  if (!Number.isInteger(offset)) {
    throw new RangeError("offset must be an integer");
  }
  const runtime = source.runtime;
  if (runtime === undefined) {
    throw new Error("TA series require a PineSession-owned source series");
  }
  return runtime.nodes.getOrCreate(nodeKey("ta.linreg", source, length, offset), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (runtime.barIndex < length - 1) return Number.NaN;
        let sumY = 0;
        let sumXY = 0;
        let sumX = 0;
        let sumXX = 0;
        for (let back = 0; back < length; back += 1) {
          const value = source.at(back);
          if (isNa(value)) return Number.NaN;
          // x counts bars from the window start, so the current bar is
          // x = length - 1 and the oldest bar is x = 0.
          const x = length - 1 - back;
          sumY += value;
          sumXY += x * value;
          sumX += x;
          sumXX += x * x;
        }
        const denominator = length * sumXX - sumX * sumX;
        const slope = (length * sumXY - sumX * sumY) / denominator;
        const intercept = (sumY - slope * sumX) / length;
        return intercept + slope * (length - 1 - offset);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
