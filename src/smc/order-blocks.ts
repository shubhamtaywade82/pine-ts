import { requireCurrentSession } from "../core/execution-context.js";
import { nodeKey } from "../core/node-registry.js";
import type { PineSession } from "../core/session.js";
import type { BooleanSeries, FloatSeries } from "../core/series.js";
import { carriedSeries, flagField, floatField } from "./series-fields.js";
import type { StructureResult } from "./structure.js";

export interface OrderBlockOptions {
  /** Minimum body of the breaking candle, as a percent of its close. */
  readonly minBodyPercent: number;
  /** A zone stops being valid once it is more than this many bars past its creation. Default: never. */
  readonly expiry?: number;
  /** How far price may close through the zone's far edge before it is invalid, in percent. Default 0.2. */
  readonly tolerancePercent?: number;
}

export interface OrderBlockZone {
  /** High of the zone candle; na before the first zone. */
  readonly top: FloatSeries;
  readonly bottom: FloatSeries;
  /** `bar_index` of the zone candle. */
  readonly bar: FloatSeries;
  /** Exists, has not expired, and this bar's close is not beyond the far edge (less the tolerance). */
  readonly valid: BooleanSeries;
  /** Valid and this bar's range overlaps the zone. */
  readonly touched: BooleanSeries;
}

export interface OrderBlockResult {
  readonly bullish: OrderBlockZone;
  readonly bearish: OrderBlockZone;
}

interface Zone {
  readonly top: number;
  readonly bottom: number;
  readonly bar: number;
}

interface ZoneBar {
  readonly zone: Zone | undefined;
  readonly createdBar: number;
  readonly valid: boolean;
  readonly touched: boolean;
}

type Side = "bullish" | "bearish";

const requireNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0; got ${value}`);
  }
};

/**
 * Order blocks as in the SMC Confluence Engine: on a structure break (BOS or
 * CHoCH) whose candle body is at least `minBodyPercent`, the previous candle
 * becomes the zone when it is opposite-coloured (bearish before a bullish
 * break). Only the latest zone per side is kept. Validity is re-evaluated
 * every bar, so a close back inside the tolerance makes a zone valid again;
 * that is the script's behavior, not mitigation tracking.
 */
export const orderBlocks = (
  structure: StructureResult,
  options: OrderBlockOptions,
): OrderBlockResult => {
  const { minBodyPercent, expiry = Number.POSITIVE_INFINITY, tolerancePercent = 0.2 } = options;
  requireNonNegative(minBodyPercent, "minBodyPercent");
  requireNonNegative(tolerancePercent, "tolerancePercent");
  if (expiry !== Number.POSITIVE_INFINITY && !(Number.isInteger(expiry) && expiry >= 0)) {
    throw new RangeError(`expiry must be an integer >= 0; got ${expiry}`);
  }

  const name = `smc.orderBlocks:body=${minBodyPercent}:expiry=${expiry}:tolerance=${tolerancePercent}`;
  const zoneSide = (side: Side): OrderBlockZone =>
    sideSeries(
      structure,
      side,
      { minBodyPercent, expiry, tolerance: tolerancePercent / 100 },
      name,
    );
  return { bullish: zoneSide("bullish"), bearish: zoneSide("bearish") };
};

interface ResolvedOptions {
  readonly minBodyPercent: number;
  readonly expiry: number;
  readonly tolerance: number;
}

interface SideInputs {
  readonly isBullish: boolean;
  readonly breaks: readonly BooleanSeries[];
  readonly sources: PineSession["sources"];
}

/** The zone a break creates on this bar, if any: the previous candle when it is opposite-coloured. */
const zoneCreatedNow = (
  { isBullish, breaks, sources }: SideInputs,
  minBodyPercent: number,
  index: number,
): Zone | undefined => {
  if (!breaks.some((series) => series.at(0) === true)) return undefined;
  const { open, high, low, close } = sources;
  const closeNow = close.at(0) ?? Number.NaN;
  const body = (Math.abs(closeNow - (open.at(0) ?? Number.NaN)) / closeNow) * 100;
  const previousOpen = open.at(1) ?? Number.NaN;
  const previousClose = close.at(1) ?? Number.NaN;
  const opposite = isBullish ? previousClose < previousOpen : previousClose > previousOpen;
  // Written positively so a NaN body (na close) never creates a zone.
  const isImpulse = body >= minBodyPercent;
  if (!isImpulse || !opposite) return undefined;
  return { top: high.at(1) ?? Number.NaN, bottom: low.at(1) ?? Number.NaN, bar: index - 1 };
};

/** One bar of one side's zone from the last committed bar; a pure step of the Pine block. */
const stepZone = (
  previous: ZoneBar | undefined,
  inputs: SideInputs,
  options: ResolvedOptions,
): ZoneBar => {
  const { high, low, close, bar_index: barIndex } = inputs.sources;
  const index = barIndex.at(0) ?? 0;
  const created = zoneCreatedNow(inputs, options.minBodyPercent, index);
  const zone = created ?? previous?.zone;
  const createdBar = created === undefined ? (previous?.createdBar ?? 0) : index;
  if (zone === undefined) return { zone, createdBar, valid: false, touched: false };
  const closeNow = close.at(0) ?? Number.NaN;
  const { expiry, tolerance } = options;
  const holds = inputs.isBullish
    ? closeNow >= zone.bottom * (1 - tolerance)
    : closeNow <= zone.top * (1 + tolerance);
  const valid = index - createdBar <= expiry && holds;
  const overlaps =
    (low.at(0) ?? Number.NaN) <= zone.top && (high.at(0) ?? Number.NaN) >= zone.bottom;
  return { zone, createdBar, valid, touched: valid && overlaps };
};

const sideSeries = (
  structure: StructureResult,
  side: Side,
  options: ResolvedOptions,
  name: string,
): OrderBlockZone => {
  const { sources } = requireCurrentSession();
  const isBullish = side === "bullish";
  const breaks = isBullish
    ? [structure.bullishBOS, structure.bullishCHoCH]
    : [structure.bearishBOS, structure.bearishCHoCH];
  const inputs: SideInputs = { isBullish, breaks, sources };
  const key = `${name}.${side}`;
  const { open, high, low, close, bar_index: barIndex } = sources;
  const bars = carriedSeries<ZoneBar>(
    nodeKey(key, ...breaks, open, high, low, close, barIndex),
    (previous) => stepZone(previous, inputs, options),
  );
  const price = (label: string, pick: (zone: Zone) => number): FloatSeries =>
    floatField(bars, `${key}.${label}`, (bar) =>
      bar.zone === undefined ? Number.NaN : pick(bar.zone),
    );
  return {
    top: price("top", (zone) => zone.top),
    bottom: price("bottom", (zone) => zone.bottom),
    bar: price("bar", (zone) => zone.bar),
    valid: flagField(bars, `${key}.valid`, (bar) => bar.valid),
    touched: flagField(bars, `${key}.touched`, (bar) => bar.touched),
  };
};
