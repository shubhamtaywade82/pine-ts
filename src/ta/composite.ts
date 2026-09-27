import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { FloatSeries, Series } from "../core/series.js";
import { atr, change, ema, rma, sma } from "./core.js";
import { stdev } from "./statistics.js";
import { deriveFloatSeries } from "./derive.js";
import { supertrendOver, type SupertrendResult } from "./supertrend-core.js";
import { requirePositiveLength } from "./validation.js";

export interface MacdResult {
  readonly macdLine: FloatSeries;
  readonly signalLine: FloatSeries;
  readonly histLine: FloatSeries;
}

/** ta.macd — MACD line, signal line and histogram composed from EMA nodes. */
export const macd = (
  source: Series<number>,
  fastLength: number,
  slowLength: number,
  signalLength: number,
): MacdResult => {
  requirePositiveLength(fastLength);
  requirePositiveLength(slowLength);
  requirePositiveLength(signalLength);
  const fast = ema(source, fastLength);
  const slow = ema(source, slowLength);
  const macdLine = deriveFloatSeries([fast, slow], "ta.macd.line", () => {
    const fastValue = fast.at(0);
    const slowValue = slow.at(0);
    return fastValue === undefined || slowValue === undefined ? Number.NaN : fastValue - slowValue;
  });
  const signalLine = ema(macdLine, signalLength);
  const histLine = deriveFloatSeries([macdLine, signalLine], "ta.macd.histogram", () => {
    const line = macdLine.at(0);
    const signal = signalLine.at(0);
    return line === undefined || signal === undefined ? Number.NaN : line - signal;
  });
  return { macdLine, signalLine, histLine };
};

export interface BollingerBandsResult {
  readonly middle: FloatSeries;
  readonly upper: FloatSeries;
  readonly lower: FloatSeries;
}

/** ta.bb — Bollinger Bands: SMA basis with `mult` standard-deviation bands. */
export const bb = (source: Series<number>, length: number, mult: number): BollingerBandsResult => {
  requirePositiveLength(length);
  if (!Number.isFinite(mult)) {
    throw new RangeError("mult must be a finite number");
  }
  const basis = sma(source, length);
  const deviation = stdev(source, length);
  // mult is captured by the evaluators, so it must be part of the cache keys.
  const upper = deriveFloatSeries([basis, deviation], `ta.bb.upper:mult=${mult}`, () => {
    const basisValue = basis.at(0);
    const deviationValue = deviation.at(0);
    return basisValue === undefined || deviationValue === undefined
      ? Number.NaN
      : basisValue + mult * deviationValue;
  });
  const lower = deriveFloatSeries([basis, deviation], `ta.bb.lower:mult=${mult}`, () => {
    const basisValue = basis.at(0);
    const deviationValue = deviation.at(0);
    return basisValue === undefined || deviationValue === undefined
      ? Number.NaN
      : basisValue - mult * deviationValue;
  });
  return { middle: basis, upper, lower };
};

export interface DmiResult {
  readonly plusDI: FloatSeries;
  readonly minusDI: FloatSeries;
  readonly adx: FloatSeries;
}

/**
 * ta.dmi — Wilder-smoothed directional movement: +DI, -DI and ADX.
 *
 * Follows the v6 reference formulas: directional movement comes from
 * `ta.change(high)` and `-ta.change(low)`, both smoothed with `ta.rma` over
 * `di_length` and divided by the smoothed true range; ADX smooths the
 * normalized DI separation over `adx_smoothing`.
 */
export const dmi = (diLength: number, adxSmoothing: number): DmiResult => {
  requirePositiveLength(diLength);
  requirePositiveLength(adxSmoothing);
  const runtime = requireCurrentSession();
  const { high, low } = runtime.sources;
  const upChange = change(high);
  const downChange = change(low);

  const plusDM = deriveFloatSeries([upChange, downChange], "ta.dmi.plusDM", () => {
    const up = upChange.at(0);
    const lowDelta = downChange.at(0);
    if (isNa(up) || isNa(lowDelta)) return Number.NaN;
    const down = -lowDelta;
    return up > down && up > 0 ? up : 0;
  });
  const minusDM = deriveFloatSeries([upChange, downChange], "ta.dmi.minusDM", () => {
    const up = upChange.at(0);
    const lowDelta = downChange.at(0);
    if (isNa(up) || isNa(lowDelta)) return Number.NaN;
    const down = -lowDelta;
    return down > up && down > 0 ? down : 0;
  });

  const trueRange = atr(diLength);
  const plusSmoothed = rma(plusDM, diLength);
  const minusSmoothed = rma(minusDM, diLength);
  const plusDI = deriveFloatSeries([plusSmoothed, trueRange], "ta.dmi.plusDI", () => {
    const smoothed = plusSmoothed.at(0);
    const range = trueRange.at(0);
    if (isNa(smoothed) || isNa(range) || range === 0) return Number.NaN;
    return (100 * smoothed) / range;
  });
  const minusDI = deriveFloatSeries([minusSmoothed, trueRange], "ta.dmi.minusDI", () => {
    const smoothed = minusSmoothed.at(0);
    const range = trueRange.at(0);
    if (isNa(smoothed) || isNa(range) || range === 0) return Number.NaN;
    return (100 * smoothed) / range;
  });

  const adxRatio = deriveFloatSeries([plusDI, minusDI], "ta.dmi.adxRatio", () => {
    const plus = plusDI.at(0);
    const minus = minusDI.at(0);
    if (isNa(plus) || isNa(minus)) return Number.NaN;
    const sum = plus + minus;
    return Math.abs(plus - minus) / (sum === 0 ? 1 : sum);
  });
  const adxSmoothed = rma(adxRatio, adxSmoothing);
  // Pine multiplies after smoothing: 100 * ta.rma(ratio, adx_smoothing).
  const adx = deriveFloatSeries([adxSmoothed], "ta.dmi.adx", () => {
    const value = adxSmoothed.at(0);
    return 100 * (value ?? Number.NaN);
  });
  return { plusDI, minusDI, adx };
};

export type { SupertrendResult } from "./supertrend-core.js";

/**
 * ta.supertrend — trailing stop from ATR bands around hl2.
 *
 * Implements the v6 reference algorithm: bands carry forward until price
 * breaks them, `direction` is 1 while the previous ATR is na and afterwards
 * -1/-1/1 depending on which band the supertrend line tracked. Direction -1
 * marks an uptrend (line below price), 1 a downtrend (line above price).
 */
export const supertrend = (factor: number, atrPeriod: number): SupertrendResult => {
  requirePositiveLength(atrPeriod);
  const runtime = requireCurrentSession();
  return supertrendOver(runtime, factor, atr(atrPeriod), "ta.supertrend", "na");
};
