import { requireCurrentSession } from "../core/execution-context.js";
import { nodeKey } from "../core/node-registry.js";
import type { BooleanSeries, FloatSeries } from "../core/series.js";
import { carriedSeries, flagField, floatField } from "./series-fields.js";

export interface FairValueGapOptions {
  /** Minimum gap size as a percent of price. Default 0. */
  readonly minSizePercent?: number;
  /** Maximum bars a gap remains active after creation. Default: infinity. */
  readonly expiry?: number;
  /** When true, a penetration through the far side of the gap marks it mitigated. Default true. */
  readonly autoMitigate?: boolean;
}

export interface FairValueGapZone {
  readonly top: FloatSeries;
  readonly bottom: FloatSeries;
  /** `bar_index` of the middle imbalance candle. */
  readonly bar: FloatSeries;
  readonly valid: BooleanSeries;
  readonly touched: BooleanSeries;
  readonly mitigated: BooleanSeries;
}

export interface FairValueGapResult {
  readonly bullish: FairValueGapZone;
  readonly bearish: FairValueGapZone;
}

interface FvgZone {
  readonly top: number;
  readonly bottom: number;
  readonly bar: number;
}

interface FvgState {
  readonly zone: FvgZone | undefined;
  readonly createdBar: number;
  readonly valid: boolean;
  readonly touched: boolean;
  readonly mitigated: boolean;
}

type Side = "bullish" | "bearish";

const detectBullishGap = (
  lowNow: number,
  highPrior2: number,
  minSizePercent: number,
  index: number,
): FvgZone | undefined => {
  if (Number.isNaN(lowNow) || Number.isNaN(highPrior2) || lowNow <= highPrior2) return undefined;
  const size = lowNow - highPrior2;
  if (minSizePercent > 0 && size < (highPrior2 * minSizePercent) / 100) return undefined;
  return { top: lowNow, bottom: highPrior2, bar: index - 1 };
};

const detectBearishGap = (
  highNow: number,
  lowPrior2: number,
  minSizePercent: number,
  index: number,
): FvgZone | undefined => {
  if (Number.isNaN(highNow) || Number.isNaN(lowPrior2) || highNow >= lowPrior2) return undefined;
  const size = lowPrior2 - highNow;
  if (minSizePercent > 0 && size < (highNow * minSizePercent) / 100) return undefined;
  return { top: lowPrior2, bottom: highNow, bar: index - 1 };
};

const evaluateFvg = (
  previous: FvgState | undefined,
  side: Side,
  options: Required<FairValueGapOptions>,
  sources: ReturnType<typeof requireCurrentSession>["sources"],
): FvgState => {
  const index = sources.bar_index.at(0) ?? 0;
  if (index < 2) return { zone: undefined, createdBar: 0, valid: false, touched: false, mitigated: false };
  const high0 = sources.high.at(0) ?? Number.NaN;
  const low0 = sources.low.at(0) ?? Number.NaN;
  const high2 = sources.high.at(2) ?? Number.NaN;
  const low2 = sources.low.at(2) ?? Number.NaN;

  const isBull = side === "bullish";
  const created = isBull
    ? detectBullishGap(low0, high2, options.minSizePercent, index)
    : detectBearishGap(high0, low2, options.minSizePercent, index);

  const zone = created ?? previous?.zone;
  const createdBar = created !== undefined ? index - 1 : (previous?.createdBar ?? 0);
  if (zone === undefined) {
    return { zone: undefined, createdBar: 0, valid: false, touched: false, mitigated: false };
  }

  // Price entering the zone counts as touched; breaching the opposite boundary mitigates it.
  const touched = low0 <= zone.top && high0 >= zone.bottom;
  const pierced = isBull ? low0 <= zone.bottom : high0 >= zone.top;
  const mitigated = (previous?.mitigated ?? false) || pierced;
  const expired = index - createdBar > options.expiry;
  const valid = !expired && (!options.autoMitigate || !mitigated);

  return { zone, createdBar, valid, touched: valid && touched, mitigated };
};

const createZoneSeries = (
  side: Side,
  options: Required<FairValueGapOptions>,
  name: string,
): FairValueGapZone => {
  const { sources } = requireCurrentSession();
  const { high, low, bar_index: barIndex } = sources;
  const key = `${name}.${side}`;

  const bars = carriedSeries<FvgState>(nodeKey(key, high, low, barIndex), (previous) =>
    evaluateFvg(previous, side, options, sources),
  );

  const field = (label: string, pick: (z: FvgZone) => number): FloatSeries =>
    floatField(bars, `${key}.${label}`, (bar) =>
      bar.zone === undefined ? Number.NaN : pick(bar.zone),
    );

  return {
    top: field("top", (z) => z.top),
    bottom: field("bottom", (z) => z.bottom),
    bar: field("bar", (z) => z.bar),
    valid: flagField(bars, `${key}.valid`, (bar) => bar.valid),
    touched: flagField(bars, `${key}.touched`, (bar) => bar.touched),
    mitigated: flagField(bars, `${key}.mitigated`, (bar) => bar.mitigated),
  };
};

/**
 * 3-candle Fair Value Gaps (imbalances).
 * Bullish FVG: low[0] > high[2]. Bearish FVG: high[0] < low[2].
 */
export const fairValueGaps = (options: FairValueGapOptions = {}): FairValueGapResult => {
  const resolved: Required<FairValueGapOptions> = {
    minSizePercent: options.minSizePercent ?? 0,
    expiry: options.expiry ?? Number.POSITIVE_INFINITY,
    autoMitigate: options.autoMitigate ?? true,
  };
  const name = `smc.fvg:minSize=${resolved.minSizePercent}:exp=${resolved.expiry}:mit=${resolved.autoMitigate}`;
  return {
    bullish: createZoneSeries("bullish", resolved, name),
    bearish: createZoneSeries("bearish", resolved, name),
  };
};
