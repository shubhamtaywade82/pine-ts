import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { atr, change, ema, rma, sma } from "./core.js";
import { stdev } from "./statistics.js";
import { requirePositiveLength } from "./validation.js";

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

export interface SupertrendResult {
  readonly supertrend: FloatSeries;
  readonly direction: Series<number>;
}

interface BandState {
  previousFinal: number;
}

/** Upper band resets when it tightens or the previous close broke above it. */
const upperBandResets = (raw: number, previous: number, previousClose: number): boolean =>
  raw < previous || previousClose > previous;

/** Lower band resets when it rises or the previous close broke below it. */
const lowerBandResets = (raw: number, previous: number, previousClose: number): boolean =>
  raw > previous || previousClose < previous;

const resolveFinalBand = (
  raw: number,
  previousFinal: number,
  previousClose: number,
  resets: (raw: number, previous: number, previousClose: number) => boolean,
): number => {
  if (isNa(previousFinal)) return raw;
  return resets(raw, previousFinal, previousClose) ? raw : previousFinal;
};

/**
 * Trailing band with Pine's carry-forward semantics: the band only moves when
 * the raw band pushes it or the previous close crossed it, otherwise the
 * committed value carries. State advances exclusively in `commit`, so realtime
 * ticks re-evaluate against the last committed band and roll back naturally.
 */
const createFinalBand = (
  rawBand: FloatSeries,
  close: FloatSeries,
  name: string,
  resets: (raw: number, previous: number, previousClose: number) => boolean,
): FloatSeries => {
  const runtime = rawBand.runtime;
  if (runtime === undefined) {
    throw new Error("Derived series require PineSession-owned sources");
  }
  const readPreviousClose = (): number => close.at(1) ?? Number.NaN;
  return runtime.nodes.getOrCreate(nodeKey(name, rawBand, close), () => {
    const definition = {
      init: (): BandState => ({ previousFinal: Number.NaN }),
      evaluate: (state: Readonly<BandState>): number => {
        const raw = rawBand.at(0);
        // A na raw band (ATR warm-up) produces a na final band; TradingView
        // plots nothing during warm-up. The first valid raw band is adopted
        // as-is, which matches nz(band[1]) behavior whenever the band is
        // above zero.
        if (isNa(raw)) return Number.NaN;
        return resolveFinalBand(raw, state.previousFinal, readPreviousClose(), resets);
      },
      commit: (state: BandState): void => {
        const raw = rawBand.at(0);
        if (isNa(raw)) return;
        state.previousFinal = resolveFinalBand(
          raw,
          state.previousFinal,
          readPreviousClose(),
          resets,
        );
      },
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

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
  if (!Number.isFinite(factor)) {
    throw new RangeError("factor must be a finite number");
  }
  const runtime = requireCurrentSession();
  const { close, hl2 } = runtime.sources;
  const atrSeries = atr(atrPeriod);

  const rawUpper = deriveFloatSeries(
    [hl2, atrSeries],
    `ta.supertrend.rawUpper:factor=${factor}`,
    () => {
      const src = hl2.at(0);
      const atrValue = atrSeries.at(0);
      return src === undefined || atrValue === undefined ? Number.NaN : src + factor * atrValue;
    },
  );
  const rawLower = deriveFloatSeries(
    [hl2, atrSeries],
    `ta.supertrend.rawLower:factor=${factor}`,
    () => {
      const src = hl2.at(0);
      const atrValue = atrSeries.at(0);
      return src === undefined || atrValue === undefined ? Number.NaN : src - factor * atrValue;
    },
  );

  const finalUpper = createFinalBand(rawUpper, close, "ta.supertrend.finalUpper", upperBandResets);
  const finalLower = createFinalBand(rawLower, close, "ta.supertrend.finalLower", lowerBandResets);

  // supertrend[1] === finalUpperBand[1] holds exactly when the previous
  // direction tracked the upper band, or when both previous bands coincided,
  // so direction can decide from its own history and band histories without a
  // forward reference to the supertrend line.
  const direction = runtime.nodes.getOrCreate(
    nodeKey("ta.supertrend.direction", finalUpper, finalLower, atrSeries, close),
    () => {
      const definition = {
        init: (): null => null,
        evaluate: (): number => {
          if (isNa(atrSeries.at(1))) return 1;
          const upperNow = finalUpper.at(0);
          const lowerNow = finalLower.at(0);
          const closeNow = close.at(0);
          if (isNa(upperNow) || isNa(lowerNow) || isNa(closeNow)) return 1;
          const previousDirection = direction.at(1) ?? 1;
          const previousUpper = finalUpper.at(1);
          const previousLower = finalLower.at(1);
          const wasUpperBand =
            previousDirection === 1 ||
            (previousUpper !== undefined && previousUpper === previousLower);
          if (wasUpperBand) return closeNow > upperNow ? -1 : 1;
          return closeNow < lowerNow ? 1 : -1;
        },
        commit: (): void => undefined,
      };
      return new Series<number>(runtime, new IndicatorNode(definition));
    },
  );

  const supertrendLine = deriveFloatSeries(
    [direction, finalLower, finalUpper],
    "ta.supertrend.line",
    () => {
      const upper = finalUpper.at(0);
      const lower = finalLower.at(0);
      if (isNa(upper) || isNa(lower)) return Number.NaN;
      return direction.at(0) === -1 ? lower : upper;
    },
  );

  return { supertrend: supertrendLine, direction };
};
