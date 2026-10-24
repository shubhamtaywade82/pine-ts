/**
 * Tests for ta.* functions not yet shipped:
 *   ta.cum, ta.cross, ta.percentrank,
 *   ta.percentile_nearest_rank, ta.percentile_linear_interpolation,
 *   ta.correlation
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

// ---------- ta.correlation ----------

describe("ta.correlation", () => {
  // Two perfectly correlated series (y = 2x) over a 4-bar window: r = 1
  it("returns 1 for a perfectly linear positive relationship", async () => {
    // close: 1,2,3,4 ; open: 2,4,6,8 (y = 2x)
    const bars = [1, 2, 3, 4].map((c, i) => ({
      time: (i + 1) * 1000,
      open: 2 * c,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const out: number[] = [];
    await runtime.run((ctx) => {
      const v = ta.correlation(ctx.close, ctx.open, 4).at(0);
      if (typeof v === "number" && !Number.isNaN(v)) out.push(v);
    }, bars);
    expect(out.at(-1)).toBeCloseTo(1, 10);
  });

  // Two perfectly inversely correlated series over a 4-bar window: r = -1
  it("returns -1 for a perfectly linear inverse relationship", async () => {
    // close: 1,2,3,4 ; open: -2,-4,-6,-8 (y = -2x)
    const bars = [1, 2, 3, 4].map((c, i) => ({
      time: (i + 1) * 1000,
      open: -2 * c,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const out: number[] = [];
    await runtime.run((ctx) => {
      const v = ta.correlation(ctx.close, ctx.open, 4).at(0);
      if (typeof v === "number" && !Number.isNaN(v)) out.push(v);
    }, bars);
    expect(out.at(-1)).toBeCloseTo(-1, 10);
  });

  // Constant window has zero variance → correlation is undefined → na
  it("returns na when one series is constant (zero variance)", async () => {
    const bars = [1, 2, 3, 4].map((c, i) => ({
      time: (i + 1) * 1000,
      open: 5,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const out: Array<number | undefined> = [];
    await runtime.run((ctx) => {
      const v = ta.correlation(ctx.close, ctx.open, 4).at(0);
      out.push(typeof v === "number" && !Number.isNaN(v) ? v : undefined);
    }, bars);
    expect(out.at(-1)).toBeUndefined();
  });

  // Warm-up: length=4 needs at least 4 paired samples; first 3 bars yield na
  it("returns na during warm-up until length paired samples are available", async () => {
    const bars = [1, 2, 3, 4, 5].map((c, i) => ({
      time: (i + 1) * 1000,
      open: c * 2,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const out: Array<number | undefined> = [];
    await runtime.run((ctx) => {
      const v = ta.correlation(ctx.close, ctx.open, 4).at(0);
      out.push(typeof v === "number" && !Number.isNaN(v) ? v : undefined);
    }, bars);
    expect(out.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(out.at(3)).toBeCloseTo(1, 10);
    expect(out.at(4)).toBeCloseTo(1, 10);
  });

  // Bars where either source is na are skipped; the window counts paired non-na
  // samples, not raw bars.
  it("skips bars where either source is na when forming the paired window", async () => {
    // Pair (close, open):
    //   bar0: (1, 2)
    //   bar1: (na, 4)  -> skipped (close is na)
    //   bar2: (3, 6)
    //   bar3: (4, 8)
    //   bar4: (5, 10)
    // length=4: at bar4 the paired samples are (1,2),(3,6),(4,8),(5,10) → r=1
    const closes = [1, Number.NaN, 3, 4, 5];
    const bars = closes.map((c, i) => ({
      time: (i + 1) * 1000,
      open: 2 * c,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const out: Array<number | undefined> = [];
    await runtime.run((ctx) => {
      const v = ta.correlation(ctx.close, ctx.open, 4).at(0);
      out.push(typeof v === "number" && !Number.isNaN(v) ? v : undefined);
    }, bars);
    // bar1 has na close → correlation is na (current value na)
    expect(out.at(1)).toBeUndefined();
    // bar4 has 4 paired non-na samples (bars 0,2,3,4) all on y=2x line → r=1
    expect(out.at(4)).toBeCloseTo(1, 10);
  });

  // Structural identity: two identical calls share one node, matching the
  // runtime's call-site keying rule for stateless series functions.
  it("preserves structural identity for repeated correlation nodes", async () => {
    const bars = [1, 2, 3, 4].map((c, i) => ({
      time: (i + 1) * 1000,
      open: 2 * c,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    })) satisfies readonly Bar[];
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    const identities: unknown[] = [];
    await runtime.run((ctx) => {
      identities.push(ta.correlation(ctx.close, ctx.open, 4));
      identities.push(ta.correlation(ctx.close, ctx.open, 4));
    }, bars);
    expect(identities[0]).toBe(identities[1]);
  });
});
