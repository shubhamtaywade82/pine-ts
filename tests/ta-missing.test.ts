/**
 * Tests for ta.* functions not yet shipped:
 *   ta.cum, ta.cross, ta.percentrank,
 *   ta.percentile_nearest_rank, ta.percentile_linear_interpolation
 *
 * Verified against TradingView Pine Script v6 Reference Manual semantics.
 */
import { describe, expect, it } from "vitest";
import * as ta from "../src/ta/index.js";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

// ---------- shared test harness ----------

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

const makeBars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({
    time: (i + 1) * 1000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    isClosed: true,
  }));

const runScript = async (
  closes: number[],
  script: (ctx: import("../src/index.js").PineContext) => void,
): Promise<void> => {
  const bars = makeBars(closes);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

// ---------- ta.cum ----------

describe("ta.cum", () => {
  it("returns running cumulative sum, na terms skipped", async () => {
    const results: number[] = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      results.push(ta.cum(ctx.close).at(0)!);
    });
    expect(results).toEqual([1, 3, 6, 10, 15]);
  });

  it("na on current bar yields na but prior sum is preserved on next bar", async () => {
    const results: Array<number | undefined> = [];
    const closes = [1, 2, NaN, 4];
    await runScript(closes, (ctx) => {
      const v = ta.cum(ctx.close).at(0);
      results.push(Number.isNaN(v) ? undefined : v);
    });
    // Pine: cum skips na; cumulative stays at 3 on the NaN bar then adds 4
    expect(results[0]).toBe(1);
    expect(results[1]).toBe(3);
    expect(results[2]).toBeUndefined(); // na bar
    expect(results[3]).toBe(7);
  });
});

// ---------- ta.cross ----------

describe("ta.cross", () => {
  it("returns true when either a crossover or crossunder occurs", async () => {
    // source: 1, 3, 2  |  other: 2, 2, 2
    // bar0: 1 < 2, bar1: 3 > 2 → crossover  bar2: 2 = 2 (no cross from above)
    const results: boolean[] = [];
    const script = (ctx: import("../src/index.js").PineContext) => {
      results.push(ta.cross(ctx.close, ctx.open).at(0) === true);
    };
    const bars = [
      { time: 1000, open: 2, high: 2, low: 1, close: 1, volume: 1, isClosed: true },
      { time: 2000, open: 2, high: 3, low: 2, close: 3, volume: 1, isClosed: true },
      { time: 3000, open: 2, high: 2, low: 2, close: 2, volume: 1, isClosed: true },
    ];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    await runtime.run(script, bars);

    expect(results[0]).toBe(false); // no prior bar
    expect(results[1]).toBe(true); // crossover on bar1
    expect(results[2]).toBe(false); // meets but doesn't cross
  });
});

// ---------- ta.percentrank ----------

describe("ta.percentrank", () => {
  it("returns 0 for the minimum and 100 for the strict maximum in the window", async () => {
    // bars: 1,2,3,4,5  with length=5
    // bar4 (value=5): all 4 prior values (1,2,3,4) + current (5) → 4 below → 80
    const results: number[] = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      const r = ta.percentrank(ctx.close, 5).at(0);
      if (r !== undefined && !Number.isNaN(r)) results.push(r);
    });
    // Pine: (count of values in window strictly less than current) / length * 100
    // bar4(5): 4 values < 5 → 4/5*100 = 80
    expect(results[results.length - 1]).toBeCloseTo(80, 6);
  });

  it("returns na during warmup", async () => {
    const results: boolean[] = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      const r = ta.percentrank(ctx.close, 5).at(0);
      results.push(r === undefined || Number.isNaN(r));
    });
    // First 4 bars (indices 0-3) are warmup
    expect(results[0]).toBe(true);
    expect(results[3]).toBe(true);
    expect(results[4]).toBe(false);
  });
});

// ---------- ta.percentile_nearest_rank ----------

describe("ta.percentile_nearest_rank", () => {
  it("returns the value at the Nth percentile rank position", async () => {
    // bars 1..10 with length=10, percentile=90
    // sorted: [1,2,3,4,5,6,7,8,9,10], 90th → ceil(10*0.9)=9th index(1-based) → value 9
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const results: number[] = [];
    await runScript(closes, (ctx) => {
      const r = ta.percentile_nearest_rank(ctx.close, 10, 90).at(0);
      if (r !== undefined && !Number.isNaN(r)) results.push(r);
    });
    expect(results[results.length - 1]).toBe(9);
  });
});

// ---------- ta.percentile_linear_interpolation ----------

describe("ta.percentile_linear_interpolation", () => {
  it("interpolates between adjacent values for non-exact percentile positions", async () => {
    // For [1,2,3,4,5], length=5, percentile=50: median = 3
    const closes = [1, 2, 3, 4, 5];
    const results: number[] = [];
    await runScript(closes, (ctx) => {
      const r = ta.percentile_linear_interpolation(ctx.close, 5, 50).at(0);
      if (r !== undefined && !Number.isNaN(r)) results.push(r);
    });
    expect(results[results.length - 1]).toBeCloseTo(3, 6);
  });
});
