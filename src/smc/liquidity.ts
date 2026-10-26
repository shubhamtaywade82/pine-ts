import { requireCurrentSession } from "../core/execution-context.js";
import { nodeKey } from "../core/node-registry.js";
import type { BooleanSeries, FloatSeries } from "../core/series.js";
import { carriedSeries, flagField, floatField } from "./series-fields.js";
import type { StructureResult } from "./structure.js";

export interface LiquidityOptions {
  /** Percentage difference threshold to classify two swing points as equal. Default 0.1 (0.1%). */
  readonly tolerancePercent?: number;
}

export interface LiquidityResult {
  /** Current bar swept above swing high with wick, closing back inside. */
  readonly sweptHigh: BooleanSeries;
  /** Current bar swept below swing low with wick, closing back inside. */
  readonly sweptLow: BooleanSeries;
  /** Price level of the swept swing point; na if no sweep occurred this bar. */
  readonly sweptLevel: FloatSeries;
  /** A new swing high was formed near the prior swing high within tolerance. */
  readonly equalHighs: BooleanSeries;
  /** A new swing low was formed near the prior swing low within tolerance. */
  readonly equalLows: BooleanSeries;
}

interface LiquidityState {
  readonly sweptHigh: boolean;
  readonly sweptLow: boolean;
  readonly sweptLevel: number;
  readonly equalHighs: boolean;
  readonly equalLows: boolean;
  readonly lastSwingHigh: number;
  readonly lastSwingLow: number;
}

const checkEqual = (current: number, prior: number, tolerance: number): boolean => {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return false;
  return Math.abs(current - prior) / prior <= tolerance;
};

const evaluateLiquidity = (
  previous: LiquidityState | undefined,
  structure: StructureResult,
  tolerance: number,
  sources: ReturnType<typeof requireCurrentSession>["sources"],
): LiquidityState => {
  const high0 = sources.high.at(0) ?? Number.NaN;
  const low0 = sources.low.at(0) ?? Number.NaN;
  const close0 = sources.close.at(0) ?? Number.NaN;
  const swingH = structure.swingHigh.at(0) ?? Number.NaN;
  const swingL = structure.swingLow.at(0) ?? Number.NaN;

  // Sweep occurs when wick pierces the level but close rejects back inside.
  const sweptHigh = Number.isFinite(swingH) && high0 > swingH && close0 <= swingH;
  const sweptLow = Number.isFinite(swingL) && low0 < swingL && close0 >= swingL;
  let sweptLevel = Number.NaN;
  if (sweptHigh) sweptLevel = swingH;
  else if (sweptLow) sweptLevel = swingL;

  const prevH = previous?.lastSwingHigh ?? Number.NaN;
  const prevL = previous?.lastSwingLow ?? Number.NaN;
  const newSwingHigh = Number.isFinite(swingH) && swingH !== prevH;
  const newSwingLow = Number.isFinite(swingL) && swingL !== prevL;

  const equalHighs = newSwingHigh && checkEqual(swingH, prevH, tolerance);
  const equalLows = newSwingLow && checkEqual(swingL, prevL, tolerance);

  return {
    sweptHigh,
    sweptLow,
    sweptLevel,
    equalHighs,
    equalLows,
    lastSwingHigh: Number.isFinite(swingH) ? swingH : prevH,
    lastSwingLow: Number.isFinite(swingL) ? swingL : prevL,
  };
};

/**
 * Liquidity sweeps and equal high/low clusters based on market structure swings.
 */
export const liquidity = (
  structure: StructureResult,
  options: LiquidityOptions = {},
): LiquidityResult => {
  const tolerance = (options.tolerancePercent ?? 0.1) / 100;
  const { sources } = requireCurrentSession();
  const { high, low, close } = sources;
  const key = `smc.liquidity:tol=${tolerance}`;

  const bars = carriedSeries<LiquidityState>(
    nodeKey(key, structure.swingHigh, structure.swingLow, high, low, close),
    (previous) => evaluateLiquidity(previous, structure, tolerance, sources),
  );

  return {
    sweptHigh: flagField(bars, `${key}.sweptHigh`, (b) => b.sweptHigh),
    sweptLow: flagField(bars, `${key}.sweptLow`, (b) => b.sweptLow),
    sweptLevel: floatField(bars, `${key}.sweptLevel`, (b) => b.sweptLevel),
    equalHighs: flagField(bars, `${key}.equalHighs`, (b) => b.equalHighs),
    equalLows: flagField(bars, `${key}.equalLows`, (b) => b.equalLows),
  };
};
