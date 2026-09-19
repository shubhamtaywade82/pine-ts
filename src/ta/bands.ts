import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { zipSeries } from "../core/series-operators.js";
import { ema, sma, tr } from "./core.js";
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

/**
 * ta.bbw — Bollinger Bands Width.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `(((basis + dev) - (basis - dev)) / basis) * 100` with
 * `basis = ta.sma(source, length)` and `dev = mult * ta.stdev(source, length)`.
 * The reference multiplies by 100, so the result is a percentage.
 */
export const bbw = (source: Series<number>, length: number, mult: number): FloatSeries => {
  requirePositiveLength(length);
  if (!Number.isFinite(mult)) {
    throw new RangeError("mult must be a finite number");
  }
  const basis = sma(source, length);
  const deviation = stdev(source, length);
  // mult is captured by the evaluator, so it must be part of the cache key.
  return deriveFloatSeries([basis, deviation], `ta.bbw:mult=${mult}`, () => {
    const basisValue = basis.at(0);
    const deviationValue = deviation.at(0);
    if (isNa(basisValue) || isNa(deviationValue)) return Number.NaN;
    // ((basis + dev) - (basis - dev)) / basis * 100 simplifies to 2 * dev / basis * 100.
    if (basisValue === 0) return Number.NaN;
    return ((2 * deviationValue * mult) / basisValue) * 100;
  });
};

export interface KeltnerChannelsResult {
  readonly middle: FloatSeries;
  readonly upper: FloatSeries;
  readonly lower: FloatSeries;
}

/**
 * Shared Keltner range series: `ta.tr` when `useTrueRange` is true, otherwise
 * the plain `high - low` bar range (both per the v6 reference entry).
 */
const keltnerRange = (useTrueRange: boolean): Series<number> => {
  if (useTrueRange) return tr(true);
  const runtime = requireCurrentSession();
  const { high, low } = runtime.sources;
  return zipSeries(high, low, "ta.kc.range", (highValue, lowValue) =>
    highValue === undefined || lowValue === undefined ? Number.NaN : highValue - lowValue,
  );
};

const keltnerChannels = (
  source: Series<number>,
  length: number,
  mult: number,
  useTrueRange: boolean,
): KeltnerChannelsResult => {
  const basis = ema(source, length);
  const rangeEma = ema(keltnerRange(useTrueRange), length);
  const upper = deriveFloatSeries([basis, rangeEma], `ta.kc.upper:mult=${mult}`, () => {
    const basisValue = basis.at(0);
    const rangeValue = rangeEma.at(0);
    return isNa(basisValue) || isNa(rangeValue) ? Number.NaN : basisValue + rangeValue * mult;
  });
  const lower = deriveFloatSeries([basis, rangeEma], `ta.kc.lower:mult=${mult}`, () => {
    const basisValue = basis.at(0);
    const rangeValue = rangeEma.at(0);
    return isNa(basisValue) || isNa(rangeValue) ? Number.NaN : basisValue - rangeValue * mult;
  });
  return { middle: basis, upper, lower };
};

/**
 * ta.kc — Keltner Channels.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `basis = ta.ema(source, length)`,
 * `span = useTrueRange ? ta.tr : (high - low)`,
 * `rangeEma = ta.ema(span, length)`,
 * returning `[basis, basis + rangeEma * mult, basis - rangeEma * mult]`.
 */
export const kc = (
  source: Series<number>,
  length: number,
  mult: number,
  useTrueRange = true,
): KeltnerChannelsResult => {
  requirePositiveLength(length);
  if (!Number.isFinite(mult)) {
    throw new RangeError("mult must be a finite number");
  }
  return keltnerChannels(source, length, mult, useTrueRange);
};

/**
 * ta.kcw — Keltner Channels Width.
 *
 * Literal transcription of the v6 Reference Manual re-implementation:
 * `((basis + rangeEma * mult) - (basis - rangeEma * mult)) / basis`. Unlike
 * `ta.bbw` the reference does not multiply by 100 here.
 */
export const kcw = (
  source: Series<number>,
  length: number,
  mult: number,
  useTrueRange = true,
): FloatSeries => {
  requirePositiveLength(length);
  if (!Number.isFinite(mult)) {
    throw new RangeError("mult must be a finite number");
  }
  const channels = keltnerChannels(source, length, mult, useTrueRange);
  return deriveFloatSeries([channels.middle, channels.upper, channels.lower], "ta.kcw", () => {
    const basisValue = channels.middle.at(0);
    const upperValue = channels.upper.at(0);
    const lowerValue = channels.lower.at(0);
    if (isNa(basisValue) || isNa(upperValue) || isNa(lowerValue)) return Number.NaN;
    if (basisValue === 0) return Number.NaN;
    return (upperValue - lowerValue) / basisValue;
  });
};
