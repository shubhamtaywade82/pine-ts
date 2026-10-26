/*
 * Differential-test oracles for `smc.*`: literal, array-based transcriptions
 * of the "LAYER D" blocks of indicators/smc/smc_confluence_engine.pine. They
 * share no code with the runtime implementation.
 */
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

export class Provider implements MarketDataProvider {
  public constructor(private readonly stream: readonly Bar[] = []) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => [];

  public streamBars = (): AsyncIterable<Bar> => {
    const stream = this.stream;
    return {
      async *[Symbol.asyncIterator]() {
        yield* stream;
      },
    };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

export interface StructureRow {
  readonly swingHigh: number;
  readonly swingHighBar: number;
  readonly swingLow: number;
  readonly swingLowBar: number;
  readonly bias: number;
  readonly bullishBOS: boolean;
  readonly bearishBOS: boolean;
  readonly bullishCHoCH: boolean;
  readonly bearishCHoCH: boolean;
}

// Bars before the first one are na and, like any na neighbor, do not block
// a pivot (the ta.pivothigh/pivotlow contract in src/ta/events.ts).
const isPivot = (values: readonly number[], i: number, n: number, high: boolean): boolean => {
  const candidate = i - n;
  if (candidate < 0) return false;
  const pivot = values[candidate] as number;
  for (let j = Math.max(0, candidate - n); j <= candidate + n; j += 1) {
    if (j === candidate) continue;
    const other = values[j] as number;
    if (high ? pivot <= other : pivot >= other) return false;
  }
  return true;
};

/*
 *   ph = ta.pivothigh(high, smc_swing, smc_swing)
 *   if not na(ph)
 *       last_ph := ph; last_ph_bar := bar_index - smc_swing; ph_age := 0
 *   ph_valid = not na(last_ph) and ph_age <= ob_expire
 *   bos_bull   = ph_valid and close > last_ph and close[1] <= last_ph
 *   choch_bull = bos_bull and structure_bias == -1
 *   if bos_bull or choch_bull
 *       structure_bias := 1
 *   (mirrored for lows; the bear update runs second)
 *
 * The script's `bos_bull` includes CHoCH bars; its labels draw "BOS" only
 * when `not choch_bull`. The oracle reports that split.
 */
export const structureReference = (
  bars: readonly Bar[],
  swing: number,
  expiry?: number,
): StructureRow[] => {
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  let lastPh = Number.NaN;
  let lastPhBar = Number.NaN;
  let phAge = 0;
  let lastPl = Number.NaN;
  let lastPlBar = Number.NaN;
  let plAge = 0;
  let bias = 0;
  return bars.map((bar, i) => {
    phAge += 1;
    plAge += 1;
    if (isPivot(highs, i, swing, true)) {
      lastPh = highs[i - swing] as number;
      lastPhBar = i - swing;
      phAge = 0;
    }
    if (isPivot(lows, i, swing, false)) {
      lastPl = lows[i - swing] as number;
      lastPlBar = i - swing;
      plAge = 0;
    }
    const previousClose = bars[i - 1]?.close ?? Number.NaN;
    const phValid = !Number.isNaN(lastPh) && phAge <= (expiry ?? Infinity);
    const plValid = !Number.isNaN(lastPl) && plAge <= (expiry ?? Infinity);
    const bosBull = phValid && bar.close > lastPh && previousClose <= lastPh;
    const bosBear = plValid && bar.close < lastPl && previousClose >= lastPl;
    const chochBull = bosBull && bias === -1;
    const chochBear = bosBear && bias === 1;
    if (bosBull) bias = 1;
    if (bosBear) bias = -1;
    return {
      swingHigh: lastPh,
      swingHighBar: lastPhBar,
      swingLow: lastPl,
      swingLowBar: lastPlBar,
      bias,
      bullishBOS: bosBull && !chochBull,
      bearishBOS: bosBear && !chochBear,
      bullishCHoCH: chochBull,
      bearishCHoCH: chochBear,
    };
  });
};

export interface OrderBlockRow {
  readonly bullishTop: number;
  readonly bullishBottom: number;
  readonly bullishBar: number;
  readonly bullishValid: boolean;
  readonly inBullish: boolean;
  readonly bearishTop: number;
  readonly bearishBottom: number;
  readonly bearishBar: number;
  readonly bearishValid: boolean;
  readonly inBearish: boolean;
}

export interface OrderBlockReferenceOptions {
  readonly minBodyPercent: number;
  readonly expiry?: number;
  readonly tolerancePercent?: number;
}

/*
 *   impulse_body_pct = math.abs(close - open) / close * 100
 *   if (bos_bull or choch_bull) and impulse_body_pct >= ob_body_pct and close[1] < open[1]
 *       bull_ob_hi := high[1]; bull_ob_lo := low[1]; bull_ob_bar := bar_index - 1; bull_ob_age := 0
 *   bull_ob_valid = not na(bull_ob_hi) and bull_ob_age <= ob_expire and close >= bull_ob_lo * 0.998
 *   in_bull_ob = bull_ob_valid and low <= bull_ob_hi and high >= bull_ob_lo
 *   (mirrored for bears: close[1] > open[1], close <= bear_ob_hi * 1.002)
 */
export const orderBlockReference = (
  bars: readonly Bar[],
  structure: readonly StructureRow[],
  { minBodyPercent, expiry = Infinity, tolerancePercent = 0.2 }: OrderBlockReferenceOptions,
): OrderBlockRow[] => {
  const tolerance = tolerancePercent / 100;
  let bull = { hi: Number.NaN, lo: Number.NaN, bar: Number.NaN };
  let bear = { hi: Number.NaN, lo: Number.NaN, bar: Number.NaN };
  let bullAge = 0;
  let bearAge = 0;
  return bars.map((bar, i) => {
    bullAge += 1;
    bearAge += 1;
    const row = structure[i] as StructureRow;
    const previous = bars[i - 1];
    const body = (Math.abs(bar.close - bar.open) / bar.close) * 100;
    const impulse = body >= minBodyPercent && previous !== undefined;
    if ((row.bullishBOS || row.bullishCHoCH) && impulse && previous.close < previous.open) {
      bull = { hi: previous.high, lo: previous.low, bar: i - 1 };
      bullAge = 0;
    }
    if ((row.bearishBOS || row.bearishCHoCH) && impulse && previous.close > previous.open) {
      bear = { hi: previous.high, lo: previous.low, bar: i - 1 };
      bearAge = 0;
    }
    const bullValid =
      !Number.isNaN(bull.hi) && bullAge <= expiry && bar.close >= bull.lo * (1 - tolerance);
    const bearValid =
      !Number.isNaN(bear.hi) && bearAge <= expiry && bar.close <= bear.hi * (1 + tolerance);
    return {
      bullishTop: bull.hi,
      bullishBottom: bull.lo,
      bullishBar: bull.bar,
      bullishValid: bullValid,
      inBullish: bullValid && bar.low <= bull.hi && bar.high >= bull.lo,
      bearishTop: bear.hi,
      bearishBottom: bear.lo,
      bearishBar: bear.bar,
      bearishValid: bearValid,
      inBearish: bearValid && bar.high >= bear.lo && bar.low <= bear.hi,
    };
  });
};

/** Deterministic trending/ranging random walk: enough swings for BOS and CHoCH both ways. */
export const walkBars = (count: number): Bar[] => {
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const bars: Bar[] = [];
  let close = 100;
  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 40) * 0.6;
    const open = close;
    close = open + drift + (next() - 0.5) * 3;
    const high = Math.max(open, close) + next() * 1.5;
    const low = Math.min(open, close) - next() * 1.5;
    bars.push({ time: i + 1, open, high, low, close, volume: 1, isClosed: true });
  }
  return bars;
};

/** Each bar as two revising open ticks (one at the high, one at the low) and its close. */
export const asRealtimeTicks = (bars: readonly Bar[]): Bar[] =>
  bars.flatMap((bar) => [
    { ...bar, close: bar.high, low: bar.open, isClosed: false },
    { ...bar, close: bar.low, isClosed: false },
    { ...bar, isClosed: true },
  ]);
