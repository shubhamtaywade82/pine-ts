import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import type { BooleanSeries, FloatSeries, Series } from "../core/series.js";
import { pivothigh, pivotlow } from "../ta/events.js";
import { carriedSeries, flagField, floatField, valueField } from "./series-fields.js";

export interface StructureOptions {
  /** Left and right bars of the `ta.pivothigh`/`ta.pivotlow` swings. */
  readonly swingLength: number;
  /** A swing stops being breakable once it is more than this many bars past its confirmation. Default: never. */
  readonly swingExpiry?: number;
}

/** 1 bullish, -1 bearish, 0 before the first break. */
export type StructureBias = 1 | -1 | 0;

export interface StructureResult {
  /** Last confirmed swing high price; na before the first one. */
  readonly swingHigh: FloatSeries;
  /** `bar_index` of that swing's pivot bar (not its confirmation bar). */
  readonly swingHighBar: FloatSeries;
  readonly swingLow: FloatSeries;
  readonly swingLowBar: FloatSeries;
  readonly bias: Series<StructureBias>;
  /** Close crossed above the swing high in the direction of the bias (or with no bias yet). */
  readonly bullishBOS: BooleanSeries;
  readonly bearishBOS: BooleanSeries;
  /** Close crossed above the swing high while the bias was bearish. */
  readonly bullishCHoCH: BooleanSeries;
  readonly bearishCHoCH: BooleanSeries;
}

interface Swing {
  readonly price: number;
  readonly pivotBar: number;
  readonly confirmedBar: number;
}

interface StructureBar {
  readonly high: Swing | undefined;
  readonly low: Swing | undefined;
  readonly bias: StructureBias;
  readonly bullishBreak: boolean;
  readonly bearishBreak: boolean;
  /** Bias before this bar's breaks: a break against it is a CHoCH. */
  readonly previousBias: StructureBias;
}

const requireLength = (value: number, name: string, minimum: number): void => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}; got ${value}`);
  }
};

const isLive = (swing: Swing | undefined, barIndex: number, expiry: number): swing is Swing =>
  swing !== undefined && barIndex - swing.confirmedBar <= expiry;

const swingAt = (pivot: FloatSeries, index: number, length: number): Swing | undefined => {
  const price = pivot.at(0);
  if (isNa(price)) return undefined;
  return { price, pivotBar: index - length, confirmedBar: index };
};

interface StructureInputs {
  readonly pivotHigh: FloatSeries;
  readonly pivotLow: FloatSeries;
  readonly close: FloatSeries;
  readonly barIndex: Series<number>;
}

/** One bar of structure from the last committed bar; a pure step of the Pine block. */
const stepStructure = (
  previous: StructureBar | undefined,
  { swingLength, swingExpiry }: Required<StructureOptions>,
  { pivotHigh, pivotLow, close, barIndex }: StructureInputs,
): StructureBar => {
  const index = barIndex.at(0) ?? 0;
  const high = swingAt(pivotHigh, index, swingLength) ?? previous?.high;
  const low = swingAt(pivotLow, index, swingLength) ?? previous?.low;
  const closeNow = close.at(0) ?? Number.NaN;
  const closePrevious = close.at(1) ?? Number.NaN;
  const bullishBreak =
    isLive(high, index, swingExpiry) && closeNow > high.price && closePrevious <= high.price;
  const bearishBreak =
    isLive(low, index, swingExpiry) && closeNow < low.price && closePrevious >= low.price;
  const previousBias = previous?.bias ?? 0;
  // The script applies the bullish update first, so a bar breaking both ways ends bearish.
  let bias = previousBias;
  if (bullishBreak) bias = 1;
  if (bearishBreak) bias = -1;
  return { high, low, bias, bullishBreak, bearishBreak, previousBias };
};

/** Public series over the per-bar structure records. */
const structureFields = (bars: Series<StructureBar>, name: string): StructureResult => {
  const flag = (label: string, pick: (bar: StructureBar) => boolean): BooleanSeries =>
    flagField(bars, `${name}.${label}`, pick);

  return {
    swingHigh: floatField(bars, `${name}.swingHigh`, (bar) => bar.high?.price ?? Number.NaN),
    swingHighBar: floatField(
      bars,
      `${name}.swingHighBar`,
      (bar) => bar.high?.pivotBar ?? Number.NaN,
    ),
    swingLow: floatField(bars, `${name}.swingLow`, (bar) => bar.low?.price ?? Number.NaN),
    swingLowBar: floatField(bars, `${name}.swingLowBar`, (bar) => bar.low?.pivotBar ?? Number.NaN),
    bias: valueField<StructureBar, StructureBias>(bars, `${name}.bias`, (bar) => bar.bias, 0),
    bullishBOS: flag("bullishBOS", (bar) => bar.bullishBreak && bar.previousBias !== -1),
    bearishBOS: flag("bearishBOS", (bar) => bar.bearishBreak && bar.previousBias !== 1),
    bullishCHoCH: flag("bullishCHoCH", (bar) => bar.bullishBreak && bar.previousBias === -1),
    bearishCHoCH: flag("bearishCHoCH", (bar) => bar.bearishBreak && bar.previousBias === 1),
  };
};

/**
 * Close-based market structure over confirmed pivots, as in the SMC
 * Confluence Engine: a swing exists only after its `swingLength` right-side
 * bars have closed (no lookahead), and a break is a close crossing the last
 * swing level (`close > level and close[1] <= level`), so a wick through the
 * level is not a break.
 */
export const structure = (options: StructureOptions): StructureResult => {
  const { swingLength, swingExpiry = Number.POSITIVE_INFINITY } = options;
  requireLength(swingLength, "swingLength", 1);
  if (swingExpiry !== Number.POSITIVE_INFINITY) requireLength(swingExpiry, "swingExpiry", 0);

  const { close, bar_index: barIndex } = requireCurrentSession().sources;
  const inputs: StructureInputs = {
    pivotHigh: pivothigh(swingLength, swingLength),
    pivotLow: pivotlow(swingLength, swingLength),
    close,
    barIndex,
  };
  const name = `smc.structure:length=${swingLength}:expiry=${swingExpiry}`;
  const key = nodeKey(name, inputs.pivotHigh, inputs.pivotLow, close, barIndex);
  const bars = carriedSeries<StructureBar>(key, (previous) =>
    stepStructure(previous, { swingLength, swingExpiry }, inputs),
  );
  return structureFields(bars, name);
};
