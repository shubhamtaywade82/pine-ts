/**
 * PineScript-exported reference vectors.
 *
 * The expected values in this file are ACTUAL TradingView Pine Script v6
 * outputs at full precision, transcribed from the MIT-licensed
 * OakScriptJS test suite (github.com/deepentropy/oakscriptJS,
 * tests/ta/{tsi,stoch,cci,linreg}.test.ts, (c) Odyssée, MIT). Per
 * docs/TA-COVERAGE.md these vectors are what "verified" status requires —
 * they are the reason ta.tsi, ta.stoch, ta.cci and ta.linreg were
 * re-corrected in this wave (see docs/ECOSYSTEM.md for the full audit).
 *
 * Attribution: OakScriptJS authors exported these values from TradingView
 * charts (Data Window) for the same inputs; pine-ts reuses the vectors
 * under the MIT license's permission. The inputs are daily BTCUSD bars.
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineContext, SymbolInfo } from "../src/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  minTick: 0.01,
  timezone: "UTC",
};

class StaticProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const closesToBars = (closes: readonly number[]): Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    isClosed: true,
  }));

/** Runs a script over synthetic close-only bars and captures a series. */
const runSeries = async (
  closes: readonly number[],
  evaluate: (ctx: PineContext) => number | undefined,
): Promise<Array<number | undefined>> => {
  const bars = closesToBars(closes);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  const out: Array<number | undefined> = [];
  await runtime.run((ctx) => {
    const value = evaluate(ctx);
    out.push(value === undefined || Number.isNaN(value) ? undefined : value);
  }, bars);
  return out;
};

const toNa = (values: ReadonlyArray<number | null>): Array<number | undefined> =>
  values.map((v) => (v === null ? undefined : v));

// Daily BTCUSD closes, first 32 bars (OakScriptJS tsi.test.ts).
const BTC_CLOSE_32 = [
  10.9, 11.69, 11.7, 11.7, 11.7, 10.5, 10, 8, 8.22, 8.88, 8.89, 8, 8.5, 7.4, 5.97, 5.53, 5.13, 4.85, 4.87, 4.92,
  4.9, 5.66, 5.66, 5.72, 5.72, 5.68, 6.05, 4.8, 4.92, 4.82, 4.82, 4.87,
];

describe("PineScript-exported reference vectors", () => {
  describe("ta.tsi (source: OakScriptJS tests/ta/tsi.test.ts, Pine outputs)", () => {
    it("returns the ratio in [-1, 1] with SMA-seeded EMA warm-up", async () => {
      const values = await runSeries(BTC_CLOSE_32, (ctx) => ta.tsi(ctx.close, 5, 24).at(0));
      // First 28 bars are na.
      expect(values.slice(0, 28).every((v) => v === undefined)).toBe(true);
      // Bars 28-31 match the PineScript outputs at full precision.
      expect(values.slice(28)).toEqual([
        -0.4469059325889009, -0.4538505248850615, -0.4583507557017383, -0.4566890248068452,
      ]);
    });

    it("returns na on a constant source (zero denominator)", async () => {
      const constant = Array.from({ length: 40 }, () => 5);
      const values = await runSeries(constant, (ctx) => ta.tsi(ctx.close, 5, 24).at(0));
      expect(values.every((v) => v === undefined)).toBe(true);
    });
  });

  describe("ta.stoch (source: OakScriptJS tests/ta/stoch.test.ts, Pine outputs)", () => {
    // Daily BTCUSD, first 12 bars.
    const CLOSE = [10.9, 11.69, 11.7, 11.7, 11.7, 10.5, 10, 8, 8.22, 8.88, 8.89, 8];
    const HIGH = [10.9, 11.85, 11.7, 11.7, 11.7, 11.5, 10, 8, 8.31, 8.88, 8.89, 8];
    const LOW = [10.9, 11.15, 11.7, 11.7, 11.7, 10.5, 10, 8, 5.25, 8, 8.89, 8];

    const runOhlc = async (
      closes: readonly number[],
      highs: readonly number[],
      lows: readonly number[],
      evaluate: (ctx: PineContext) => number | undefined,
    ): Promise<Array<number | undefined>> => {
      const bars: Bar[] = closes.map((close, index) => ({
        time: index + 1,
        open: close,
        high: highs[index] ?? close,
        low: lows[index] ?? close,
        close,
        volume: 1,
        isClosed: true,
      }));
      const runtime = new PineRuntime({
        provider: new StaticProvider(bars),
        symbol: "TEST",
        timeframe: "1",
      });
      const out: Array<number | undefined> = [];
      await runtime.run((ctx) => {
        const value = evaluate(ctx);
        out.push(value === undefined || Number.isNaN(value) ? undefined : value);
      }, bars);
      return out;
    };

    it("keeps the previous result on a zero range (flat source)", async () => {
      const flat = [5, 5, 5, 5, 5, 11, 12, 13, 7, 7, 7, 7];
      const values = await runOhlc(flat, flat, flat, (ctx) =>
        ta.stoch(ctx.close, ctx.high, ctx.low, 3).at(0),
      );
      expect(values).toEqual(toNa([null, null, null, null, null, 100, 100, 100, 0, 0, 0, 0]));
    });

    it("keeps the previous result when the source is na", async () => {
      const closes = CLOSE.map((c, i) => (i % 7 === 3 ? Number.NaN : c));
      const values = await runOhlc(closes, HIGH, LOW, (ctx) =>
        ta.stoch(ctx.close, ctx.high, ctx.low, 3).at(0),
      );
      expect(values).toEqual(
        toNa([
          null, null, 84.21052631578942, 84.21052631578942, 84.21052631578942, 0, 0, 0,
          62.5263157894737, 100, 100, 0,
        ]),
      );
    });

    it("skips na values in the peak window (last 3 non-na highs)", async () => {
      const highs = HIGH.map((h, i) => (i % 11 === 5 ? Number.NaN : h));
      const values = await runOhlc(CLOSE, highs, LOW, (ctx) =>
        ta.stoch(ctx.close, ctx.high, ctx.low, 3).at(0),
      );
      expect(values).toEqual(
        toNa([
          null, null, 84.21052631578942, 78.5714285714285, 78.5714285714285, 0, 0, 0,
          62.5263157894737, 100, 100, 0,
        ]),
      );
    });
  });

  describe("ta.cci (source: OakScriptJS tests/ta/cci.test.ts, Pine outputs)", () => {
    it("keeps the previous CCI on flat windows; 0 for a first flat window", async () => {
      const values = await runSeries([1, 2, 3, 3, 3, 4], (ctx) => ta.cci(ctx.close, 2).at(0));
      const defined = values.filter((v): v is number => v !== undefined);
      // cci[0] is na (warm-up); a flat first window would give 0.
      expect(values[0]).toBeUndefined();
      // Flat windows at bars 3 and 4 carry the bar-2 value.
      expect(defined.length).toBeGreaterThanOrEqual(4);
      const [, bar2, bar3, bar4] = defined;
      expect(bar3).toBeCloseTo(bar2!, 12);
      expect(bar4).toBeCloseTo(bar2!, 12);
    });

    it("gives 0 when the first window is flat", async () => {
      const values = await runSeries([3.3, 3.3, 3.5], (ctx) => ta.cci(ctx.close, 2).at(0));
      expect(values[0]).toBeUndefined();
      expect(values[1]).toBe(0);
    });

    it("matches PineScript on the BTCUSD flat-window series ta.cci(fl, 3)", async () => {
      const fl = [3, 3, 3, 3, 3, 3, 10, 8, 8.22, 8.88, 3, 3, 3, 3, 3, 3];
      const values = await runSeries(fl, (ctx) => ta.cci(ctx.close, 3).at(0));
      expect(values).toEqual(
        toNa([
          null, null, 0, 0, 0, 0, 100.00000000000001, 25.000000000000004, -41.269841269841244, 100,
          -99.99999999999999, -49.99999999999999, -49.99999999999999, -49.99999999999999,
          -49.99999999999999, -49.99999999999999,
        ]),
      );
    });
  });

  describe("ta.linreg (source: OakScriptJS tests/ta/linreg.test.ts, Pine outputs)", () => {
    // Daily BTCUSD closes, first 14 bars.
    const BTC_CLOSE_14 = [
      10.9, 11.69, 11.7, 11.7, 11.7, 10.5, 10, 8, 8.22, 8.88, 8.89, 8, 8.5, 7.4,
    ];

    it("matches PineScript with positive and negative offsets", async () => {
      const offset3 = await runSeries(BTC_CLOSE_14, (ctx) => ta.linreg(ctx.close, 10, 3).at(0));
      expect(offset3.slice(9)).toEqual([
        9.717454545454544, 9.455818181818183, 9.068909090909091, 8.84, 8.469272727272728,
      ]);
    });

    it("matches PineScript on a constant series (x = 1..length, intercept at x = 1)", async () => {
      const constant = Array.from({ length: 4 }, () => 0.1);
      const values = await runSeries(constant, (ctx) => ta.linreg(ctx.close, 3, 0).at(0));
      expect(values).toEqual(toNa([null, null, 0.10000000000000002, 0.10000000000000002]));
    });
  });
});
