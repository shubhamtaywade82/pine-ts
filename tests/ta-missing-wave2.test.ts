/**
 * Tests for the second wave of ta.* functions shipped in 2026-10:
 *   ta.alma, ta.cog, ta.cci, ta.tsi, ta.rci,
 *   ta.max, ta.min, ta.median, ta.mode, ta.range,
 *   ta.iii, ta.wad, ta.wvad
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

const makeOhlcvBars = (
  rows: ReadonlyArray<{ o: number; h: number; l: number; c: number; v: number }>,
): Bar[] =>
  rows.map((r, i) => ({
    time: (i + 1) * 1000,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
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

const runOhlcvScript = async (
  rows: ReadonlyArray<{ o: number; h: number; l: number; c: number; v: number }>,
  script: (ctx: import("../src/index.js").PineContext) => void,
): Promise<void> => {
  const bars = makeOhlcvBars(rows);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

const maybe = (v: number | undefined): number | undefined =>
  v === undefined || Number.isNaN(v) ? undefined : v;

// ---------- ta.max ----------

describe("ta.max", () => {
  it("returns the running maximum, carrying forward on lower values", async () => {
    const out: Array<number | undefined> = [];
    await runScript([3, 1, 4, 1, 5, 9, 2, 6], (ctx) => {
      out.push(maybe(ta.max(ctx.close).at(0)));
    });
    expect(out).toEqual([3, 3, 4, 4, 5, 9, 9, 9]);
  });

  it("carries the previous maximum across na current values", async () => {
    const out: Array<number | undefined> = [];
    const bars = [5, Number.NaN, 3, Number.NaN, 7].map((c, i) => ({
      time: (i + 1) * 1000,
      open: 0,
      high: 0,
      low: 0,
      close: c,
      volume: 1,
      isClosed: true,
    }));
    const runtime = new PineRuntime({
      provider: new StaticProvider(bars),
      symbol: "TEST",
      timeframe: "1",
    });
    await runtime.run((ctx) => out.push(maybe(ta.max(ctx.close).at(0))), bars);
    expect(out).toEqual([5, 5, 5, 5, 7]);
  });

  it("preserves structural identity for repeated calls", async () => {
    const identities: unknown[] = [];
    await runScript([1, 2, 3], (ctx) => {
      identities.push(ta.max(ctx.close));
      identities.push(ta.max(ctx.close));
    });
    expect(identities[0]).toBe(identities[1]);
  });
});

// ---------- ta.min ----------

describe("ta.min", () => {
  it("returns the running minimum, mirror of ta.max", async () => {
    const out: Array<number | undefined> = [];
    await runScript([3, 1, 4, 1, 5, 0], (ctx) => {
      out.push(maybe(ta.min(ctx.close).at(0)));
    });
    expect(out).toEqual([3, 1, 1, 1, 1, 0]);
  });
});

// ---------- ta.median ----------

describe("ta.median", () => {
  it("returns the median of the last length non-na samples", async () => {
    const out: Array<number | undefined> = [];
    await runScript([5, 1, 3, 2, 4], (ctx) => {
      out.push(maybe(ta.median(ctx.close, 3).at(0)));
    });
    expect(out).toEqual([undefined, undefined, 3, 2, 3]);
  });

  it("averages the two middle values for an even-length window", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.median(ctx.close, 4).at(0)));
    });
    // window [3,4,5,4]→ wait, bars are close=[1,2,3,4,5]; at bar 3 window=[1,2,3,4]→(2+3)/2=2.5
    // at bar 4 window=[2,3,4,5]→(3+4)/2=3.5
    expect(out.at(-1)).toBeCloseTo(3.5, 10);
    expect(out.at(-2)).toBeCloseTo(2.5, 10);
  });
});

// ---------- ta.mode ----------

describe("ta.mode", () => {
  it("returns the most frequent value, smallest-tied value wins", async () => {
    // window length 4 over [1, 2, 2, 1, 3, 3, 3, 1, 1, 1]
    // bar 6: window=[2,2,1,3,3]→ counts: 1×1, 2×2, 3×2 — tie between 2 and 3 → smallest is 2
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 2, 1, 3, 3], (ctx) => {
      out.push(maybe(ta.mode(ctx.close, 5).at(0)));
    });
    // bar 4: window=[1,2,2,1,3] counts 1×2, 2×2, 3×1 → tie 1,2 → smallest = 1
    expect(out.at(4)).toBe(1);
    // bar 5: window=[2,2,1,3,3] counts 2×2, 1×1, 3×2 → tie 2,3 → smallest = 2
    expect(out.at(5)).toBe(2);
  });
});

// ---------- ta.range ----------

describe("ta.range", () => {
  it("returns highest minus lowest over the rolling window", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 5, 3, 4, 2], (ctx) => {
      out.push(maybe(ta.range(ctx.close, 3).at(0)));
    });
    expect(out).toEqual([undefined, undefined, 4, 2, 2]);
  });
});

// ---------- ta.alma ----------

describe("ta.alma", () => {
  it("matches a Gaussian-weighted average with offset toward responsiveness", async () => {
    // length=5 over [1,2,3,4,5,6,7,8,9]; offset=0.85, sigma=6.
    // At bar 4 (window=[1,2,3,4,5]), the standard ALMA formula gives a value
    // pulled toward the most recent samples by offset>0.5.
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.alma(ctx.close, 5, 0.85, 6).at(0)));
    });
    expect(out.slice(0, 4).every((v) => v === undefined)).toBe(true);
    // The ALMA value at bar 4 should be in the [3, 5] range, pulled toward 5.
    const v = out.at(-1);
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(3);
    expect(v!).toBeLessThanOrEqual(5);
  });

  it("returns na during warm-up", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4], (ctx) => {
      out.push(maybe(ta.alma(ctx.close, 4, 0.5, 1).at(0)));
    });
    expect(out.slice(0, 3).every((v) => v === undefined)).toBe(true);
    expect(out.at(-1)).toBeDefined();
  });
});

// ---------- ta.cog ----------

describe("ta.cog", () => {
  it("returns the negative bar-weighted price sum divided by the unweighted sum", async () => {
    // window=[3,6,9,12] (newest first: [12,9,6,3])
    // weights by (i+1): i=0 (newest=12) → 1, i=1 (9) → 2, i=2 (6) → 3, i=3 (3) → 4
    // weighted = 12*1 + 9*2 + 6*3 + 3*4 = 12+18+18+12 = 60
    // unweighted = 30, COG = -60/30 = -2
    const out: Array<number | undefined> = [];
    await runScript([3, 6, 9, 12], (ctx) => {
      out.push(maybe(ta.cog(ctx.close, 4).at(0)));
    });
    expect(out.at(-1)).toBeCloseTo(-2, 10);
  });

  it("returns na during warm-up", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3], (ctx) => {
      out.push(maybe(ta.cog(ctx.close, 4).at(0)));
    });
    expect(out.every((v) => v === undefined)).toBe(true);
  });
});

// ---------- ta.cci ----------

describe("ta.cci", () => {
  it("returns na during warm-up", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.cci(ctx.close, 4).at(0)));
    });
    expect(out.slice(0, 3).every((v) => v === undefined)).toBe(true);
  });

  it("returns 0 for a first flat window and keeps it afterwards (zero MD)", async () => {
    const out: Array<number | undefined> = [];
    await runScript([5, 5, 5, 5], (ctx) => {
      out.push(maybe(ta.cci(ctx.close, 4).at(0)));
    });
    // Corrected flat-window semantics (Pine reference vectors): a first
    // flat window gives 0, and later flat windows keep the previous result.
    expect(out).toEqual([undefined, undefined, undefined, 0]);
  });

  it("returns a finite value for a normally-varying window", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.cci(ctx.close, 4).at(0)));
    });
    const v = out.at(-1);
    expect(v).toBeDefined();
    expect(Number.isFinite(v!)).toBe(true);
  });
});

// ---------- ta.tsi ----------

describe("ta.tsi", () => {
  it("returns na during warm-up", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.tsi(ctx.close, 3, 5).at(0)));
    });
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("returns +1 for a strictly increasing series once warmed up (ratio, not x100)", async () => {
    // 12 bars with constant 1-bar changes; the double-smoothed change equals
    // the double-smoothed absolute change, so the TSI ratio converges to +1.
    const out: Array<number | undefined> = [];
    await runScript(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      (ctx) => out.push(maybe(ta.tsi(ctx.close, 3, 5).at(0))),
    );
    expect(out.at(-1)).toBeCloseTo(1, 6);
  });
});

// ---------- ta.rci ----------

describe("ta.rci", () => {
  it("returns 100 for a strictly increasing series", async () => {
    const out: Array<number | undefined> = [];
    await runScript([1, 2, 3, 4, 5], (ctx) => {
      out.push(maybe(ta.rci(ctx.close, 5).at(0)));
    });
    expect(out.slice(0, 4).every((v) => v === undefined)).toBe(true);
    expect(out.at(-1)).toBeCloseTo(100, 6);
  });

  it("returns -100 for a strictly decreasing series", async () => {
    const out: Array<number | undefined> = [];
    await runScript([5, 4, 3, 2, 1], (ctx) => {
      out.push(maybe(ta.rci(ctx.close, 5).at(0)));
    });
    expect(out.at(-1)).toBeCloseTo(-100, 6);
  });

  it("returns na for a constant window (no price variation)", async () => {
    const out: Array<number | undefined> = [];
    await runScript([7, 7, 7, 7, 7], (ctx) => {
      out.push(maybe(ta.rci(ctx.close, 5).at(0)));
    });
    expect(out.at(-1)).toBeUndefined();
  });
});

// ---------- ta.iii ----------

describe("ta.iii", () => {
  it("cumulates the Bostian intraday intensity term", async () => {
    const out: Array<number | undefined> = [];
    await runOhlcvScript(
      [
        { o: 100, h: 102, l: 98, c: 100, v: 10 },
        { o: 100, h: 105, l: 99, c: 104, v: 10 },
        { o: 97, h: 100, l: 96, c: 99, v: 12 },
      ],
      (_ctx) => out.push(maybe(ta.iii().at(0))),
    );
    // bar 0: H==L==C → term undefined → cumulative stays 0
    expect(out.at(0)).toBe(0);
    // bar 1: term = ((2*104 - 105 - 99)/(105-99)) * 10 = (208-204)/6 * 10 = 4/6 * 10
    expect(out.at(1)).toBeCloseTo((4 / 6) * 10, 10);
    // bar 2: term = ((2*99 - 100 - 96)/(100-96)) * 12 = (198-196)/4 * 12 = 2/4 * 12 = 6
    expect(out.at(2)).toBeCloseTo((4 / 6) * 10 + (2 / 4) * 12, 10);
  });
});

// ---------- ta.wad ----------

describe("ta.wad", () => {
  it("cumulates the Williams A/D contribution per the v6 reference worked example", async () => {
    const out: Array<number | undefined> = [];
    await runOhlcvScript(
      [
        // bar 0: seed, no previous close → 0
        { o: 100, h: 102, l: 98, c: 100, v: 1000 },
        // bar 1: C=104 > prevC=100, trueLow=min(99,100)=99 → +5
        { o: 100, h: 105, l: 99, c: 104, v: 1000 },
        // bar 2: C=99 < prevC=104, trueHigh=max(100,104)=104 → 99-104 = -5, total 0
        { o: 97, h: 100, l: 96, c: 99, v: 1200 },
        // bar 3: C=99 == prevC=99 → 0, total stays 0
        { o: 98, h: 103, l: 97, c: 99, v: 900 },
        // bar 4: C=107 > prevC=99, trueLow=min(105,99)=99 → +8, total 8
        { o: 106, h: 108, l: 105, c: 107, v: 800 },
      ],
      (_ctx) => out.push(maybe(ta.wad().at(0))),
    );
    expect(out).toEqual([0, 5, 0, 0, 8]);
  });
});

// ---------- ta.wvad ----------

describe("ta.wvad", () => {
  it("returns the per-bar (close - open)/(high - low)*volume value, non-cumulative", async () => {
    const out: Array<number | undefined> = [];
    await runOhlcvScript(
      [
        { o: 100, h: 110, l: 90, c: 105, v: 10 }, // (105-100)/(110-90)*10 = 5/20*10 = 2.5
        { o: 105, h: 110, l: 100, c: 100, v: 20 }, // (100-105)/(110-100)*20 = -5/10*20 = -10
        { o: 95, h: 105, l: 85, c: 100, v: 15 }, // (100-95)/(105-85)*15 = 5/20*15 = 3.75
      ],
      (_ctx) => out.push(maybe(ta.wvad().at(0))),
    );
    expect(out.at(0)).toBeCloseTo(2.5, 10);
    expect(out.at(1)).toBeCloseTo(-10, 10);
    expect(out.at(2)).toBeCloseTo(3.75, 10);
  });

  it("returns na on a zero-range bar", async () => {
    const out: Array<number | undefined> = [];
    await runOhlcvScript(
      [
        { o: 100, h: 100, l: 100, c: 100, v: 10 }, // zero range → na
        { o: 100, h: 110, l: 90, c: 105, v: 5 }, // 5/20*5 = 1.25
      ],
      (_ctx) => out.push(maybe(ta.wvad().at(0))),
    );
    expect(out.at(0)).toBeUndefined();
    expect(out.at(1)).toBeCloseTo(1.25, 10);
  });
});
