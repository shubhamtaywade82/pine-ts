import { type Series } from "../core/series.js";
import { alma } from "./alma.js";

export interface AlmaLineConfig {
  readonly id: string;
  readonly name: string;
  readonly length: number;
  readonly offset?: number;
  readonly sigma?: number;
  readonly floor?: boolean;
}

export type AlmaDirection = "bullish" | "bearish" | "neutral";
export type AlmaAlignmentState = "bullish" | "bearish" | "mixed" | "transition";
export type AlmaSpreadState = "expanding" | "contracting" | "compressed";

export interface AlmaCrossoverEvent {
  readonly fastId: string;
  readonly slowId: string;
  readonly direction: "bullish" | "bearish";
}

export interface AlmaLineSnapshot {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly slope: number;
  readonly direction: AlmaDirection;
}

export interface AlmaPullbackEvent {
  readonly lineId: string;
  readonly direction: AlmaDirection;
  readonly distanceAtr: number;
}

export interface MultiAlmaAnalysis {
  readonly lines: readonly AlmaLineSnapshot[];
  readonly alignment: {
    readonly state: AlmaAlignmentState;
    readonly score: number;
  };
  readonly spread: {
    readonly fastMacroSpread: number;
    readonly atrNormalized: number;
    readonly state: AlmaSpreadState;
  };
  readonly crossovers: readonly AlmaCrossoverEvent[];
  readonly pullbacks: readonly AlmaPullbackEvent[];
  readonly regime: "trending_bull" | "trending_bear" | "ranging" | "transition";
}

export const DEFAULT_ALMA_CONFIGS: readonly AlmaLineConfig[] = [
  { id: "fast", name: "Fast", length: 9, offset: 0.85, sigma: 6 },
  { id: "signal", name: "Signal", length: 21, offset: 0.85, sigma: 6 },
  { id: "trend", name: "Trend", length: 50, offset: 0.85, sigma: 6 },
  { id: "macro", name: "Macro", length: 150, offset: 0.85, sigma: 6 },
];

export const evaluateAlignment = (
  values: readonly number[],
): { state: AlmaAlignmentState; score: number } => {
  if (values.length < 2) return { state: "mixed", score: 0 };
  let bullishPairs = 0;
  let bearishPairs = 0;
  const totalPairs = values.length - 1;

  for (let i = 0; i < totalPairs; i += 1) {
    if (values[i]! > values[i + 1]!) bullishPairs += 1;
    else if (values[i]! < values[i + 1]!) bearishPairs += 1;
  }

  const score = Math.round(((bullishPairs - bearishPairs) / totalPairs) * 100);
  if (bullishPairs === totalPairs) return { state: "bullish", score: 100 };
  if (bearishPairs === totalPairs) return { state: "bearish", score: -100 };
  if (Math.abs(score) >= 50) return { state: "transition", score };
  return { state: "mixed", score };
};

export const findPairwiseCrossovers = (
  curr: readonly number[],
  prev: readonly number[],
  configs: readonly AlmaLineConfig[],
): AlmaCrossoverEvent[] => {
  const events: AlmaCrossoverEvent[] = [];
  for (let i = 0; i < configs.length - 1; i += 1) {
    for (let j = i + 1; j < configs.length; j += 1) {
      const cFast = curr[i];
      const cSlow = curr[j];
      const pFast = prev[i];
      const pSlow = prev[j];
      if (
        cFast === undefined ||
        cSlow === undefined ||
        pFast === undefined ||
        pSlow === undefined
      ) {
        continue;
      }
      if (cFast > cSlow && pFast <= pSlow) {
        events.push({ fastId: configs[i]!.id, slowId: configs[j]!.id, direction: "bullish" });
      } else if (cFast < cSlow && pFast >= pSlow) {
        events.push({ fastId: configs[i]!.id, slowId: configs[j]!.id, direction: "bearish" });
      }
    }
  }
  return events;
};

export const calculateNormalizedSlope = (curr: number, prev: number, atr: number): number => {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return 0;
  if (!Number.isFinite(atr) || atr <= 0) return curr - prev;
  return (curr - prev) / atr;
};

export const evaluateSpreadState = (
  spread: number,
  prevSpread: number,
  atr: number,
): AlmaSpreadState => {
  const atrNorm = Number.isFinite(atr) && atr > 0 ? spread / atr : spread;
  if (atrNorm < 0.35) return "compressed";
  return spread >= prevSpread ? "expanding" : "contracting";
};

export const detectAlmaPullback = (
  bar: { open: number; high: number; low: number; close: number },
  lineValue: number,
  atr: number,
  lineId: string,
): AlmaPullbackEvent | undefined => {
  if (!Number.isFinite(lineValue) || !Number.isFinite(atr) || atr <= 0) return undefined;
  const tolerance = 0.2 * atr;
  const isBullishTouch = bar.low <= lineValue + tolerance && bar.close > lineValue;
  if (isBullishTouch && bar.close >= bar.open) {
    return { lineId, direction: "bullish", distanceAtr: (bar.close - lineValue) / atr };
  }
  const isBearishTouch = bar.high >= lineValue - tolerance && bar.close < lineValue;
  if (isBearishTouch && bar.close <= bar.open) {
    return { lineId, direction: "bearish", distanceAtr: (lineValue - bar.close) / atr };
  }
  return undefined;
};

const resolveSlopeDirection = (slope: number): AlmaDirection => {
  if (slope > 0.05) return "bullish";
  if (slope < -0.05) return "bearish";
  return "neutral";
};

const resolveRegime = (
  alignment: AlmaAlignmentState,
  spreadState: AlmaSpreadState,
): "trending_bull" | "trending_bear" | "ranging" | "transition" => {
  if (alignment === "bullish" && spreadState !== "compressed") return "trending_bull";
  if (alignment === "bearish" && spreadState !== "compressed") return "trending_bear";
  if (spreadState === "compressed" || alignment === "mixed") return "ranging";
  return "transition";
};

/**
 * Evaluates multi-ALMA status, alignment, crossovers, slopes, and pullbacks.
 */
export const analyzeMultiAlma = (
  source: Series<number>,
  bar: { open: number; high: number; low: number; close: number },
  atr: number,
  configs: readonly AlmaLineConfig[] = DEFAULT_ALMA_CONFIGS,
): MultiAlmaAnalysis => {
  const seriesList = configs.map((cfg) =>
    alma(source, cfg.length, cfg.offset ?? 0.85, cfg.sigma ?? 6, cfg.floor ?? false),
  );

  const currValues = seriesList.map((s) => s.at(0) ?? Number.NaN);
  const prevValues = seriesList.map((s) => s.at(1) ?? Number.NaN);

  const lines: AlmaLineSnapshot[] = configs.map((cfg, i) => {
    const val = currValues[i]!;
    const slope = calculateNormalizedSlope(val, prevValues[i]!, atr);
    const direction: AlmaDirection = resolveSlopeDirection(slope);
    return { id: cfg.id, name: cfg.name, value: val, slope, direction };
  });

  const alignment = evaluateAlignment(currValues);
  const crossovers = findPairwiseCrossovers(currValues, prevValues, configs);

  const fastVal = currValues[0] ?? 0;
  const macroVal = currValues[currValues.length - 1] ?? 0;
  const spread = Math.abs(fastVal - macroVal);
  const prevSpread = Math.abs((prevValues[0] ?? 0) - (prevValues[prevValues.length - 1] ?? 0));
  const atrNorm = Number.isFinite(atr) && atr > 0 ? spread / atr : spread;
  const spreadState = evaluateSpreadState(spread, prevSpread, atr);

  const pullbacks: AlmaPullbackEvent[] = [];
  for (let i = 0; i < configs.length; i += 1) {
    const pb = detectAlmaPullback(bar, currValues[i]!, atr, configs[i]!.id);
    if (pb !== undefined) pullbacks.push(pb);
  }

  const regime = resolveRegime(alignment.state, spreadState);

  return {
    lines,
    alignment,
    spread: { fastMacroSpread: spread, atrNormalized: atrNorm, state: spreadState },
    crossovers,
    pullbacks,
    regime,
  };
};
