import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const closesToBars = (closes: readonly number[]): readonly Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    isClosed: true,
  })) satisfies readonly Bar[];

const openCloseToBars = (pairs: ReadonlyArray<readonly [number, number]>): readonly Bar[] =>
  pairs.map(([open, close], index) => ({
    time: index + 1,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
    isClosed: true,
  })) satisfies readonly Bar[];

class Provider implements MarketDataProvider {
  public constructor(
    private readonly history: readonly Bar[],
    private readonly stream: readonly Bar[] = [],
  ) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;

  public streamBars = (): AsyncIterable<Bar> => {
    let index = 0;
    const iterator: AsyncIterator<Bar> = {
      next: async () => {
        const value = this.stream[index];
        if (value === undefined) return { value: undefined, done: true };
        index += 1;
        return { value, done: false };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

type Context = Parameters<PineScript>[0];

const runHistorical = async <T>(
  bars: readonly Bar[],
  read: (context: Context) => T,
): Promise<T[]> => {
  const values: T[] = [];
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((context) => {
    values.push(read(context));
  }, bars);
  return values;
};

const runRealtime = async <T>(
  ticks: readonly Bar[],
  read: (context: Context) => T,
): Promise<T[]> => {
  const values: T[] = [];
  const runtime = new PineRuntime({
    provider: new Provider([], ticks),
    symbol: "TEST",
    timeframe: "1m",
    executionMode: "realtime",
  });
  await runtime.runRealtime((context) => {
    values.push(read(context));
  });
  return values;
};

describe("ta.barssince", () => {
  // Mirrors fixtures/v6/ta/barssince.basic.json: 0 on the condition bar,
  // distance to the last true bar otherwise, na before the first occurrence.
  const bars = openCloseToBars([
    [10, 9.5],
    [9.5, 10.2],
    [10.2, 10.0],
    [10.0, 10.6],
    [10.6, 10.3],
  ]);

  it("matches the reference vector", async () => {
    const values = await runHistorical(bars, (ctx) => {
      const condition = ctx.series("close-above-open", () => ctx.close.value > ctx.open.value);
      return ta.barssince(condition).value;
    });
    expect(Number.isNaN(values[0])).toBe(true);
    expect(values[1]).toBe(0);
    expect(values[2]).toBe(1);
    expect(values[3]).toBe(0);
    expect(values[4]).toBe(1);
  });

  it("keeps counting when the condition never fires again", async () => {
    const falling = closesToBars([5, 4, 3, 2, 1]);
    const values = await runHistorical(falling, (ctx) => {
      const condition = ctx.series("close-above-4", () => ctx.close.value > 4);
      return ta.barssince(condition).value;
    });
    expect(values[0]).toBe(0);
    expect(values[4]).toBe(4);
  });
});

describe("ta.rising / ta.falling", () => {
  // Mirrors fixtures/v6/ta/rising.basic.json and falling.basic.json: strict
  // chains over the current value plus the last `length` non-na prior values.
  const bars = closesToBars([10, 11, 12, 11.5, 11, 10.5, 10.5, 11]);

  it("rising matches the reference vector", async () => {
    const values = await runHistorical(bars, (ctx) => ta.rising(ctx.close, 2).value);
    expect(values).toEqual([false, false, true, false, false, false, false, false]);
  });

  it("falling matches the reference vector", async () => {
    const values = await runHistorical(bars, (ctx) => ta.falling(ctx.close, 2).value);
    expect(values).toEqual([false, false, false, false, true, true, false, false]);
  });

  it("requires the full run length", async () => {
    const rising = closesToBars([1, 2, 3, 4]);
    const rising3 = await runHistorical(rising, (ctx) => ta.rising(ctx.close, 3).value);
    expect(rising3).toEqual([false, false, false, true]);
    const rising1 = await runHistorical(rising, (ctx) => ta.rising(ctx.close, 1).value);
    expect(rising1).toEqual([false, true, true, true]);
  });

  it("skips na bars when collecting the prior values", async () => {
    const withNa = [1, Number.NaN, 2, 3].map((close, index) => ({
      time: index + 1,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      isClosed: true,
    }));
    const values = await runHistorical(withNa, (ctx) => ta.rising(ctx.close, 2).value);
    // Bar 3: current 3 > prior non-na [2, 1] -> true even though bar 1 is na.
    expect(values[3]).toBe(true);
    // Bar 1 has a na current value, which reads as false.
    expect(values[1]).toBe(false);
  });
});

describe("ta.valuewhen", () => {
  // Mirrors fixtures/v6/ta/valuewhen.basic.json.
  const closes = [10, 12, 10.5, 13, 11.5, 10];
  const bars = closesToBars(closes);

  it("returns the most recent occurrence (occurrence 0)", async () => {
    const values = await runHistorical(bars, (ctx) => {
      const condition = ctx.series("close-above-11", () => ctx.close.value > 11);
      return ta.valuewhen(condition, ctx.close, 0).value;
    });
    expect(values[0]).toBeUndefined();
    expect(values[1]).toBe(12);
    expect(values[2]).toBe(12);
    expect(values[3]).toBe(13);
    expect(values[4]).toBe(11.5);
    expect(values[5]).toBe(11.5);
  });

  it("returns the nth most recent occurrence (occurrence 1)", async () => {
    const values = await runHistorical(bars, (ctx) => {
      const condition = ctx.series("close-above-11", () => ctx.close.value > 11);
      return ta.valuewhen(condition, ctx.close, 1).value;
    });
    expect(values[2]).toBeUndefined();
    expect(values[3]).toBe(12);
    expect(values[4]).toBe(13);
    expect(values[5]).toBe(13);
  });

  it("captures the current bar's value when the condition holds now", async () => {
    const values = await runHistorical(bars, (ctx) => {
      const condition = ctx.series("close-above-12.9", () => ctx.close.value > 12.9);
      return ta.valuewhen(condition, ctx.close, 0).value;
    });
    expect(values[3]).toBe(13);
  });

  it("rejects negative or fractional occurrences", () => {
    const runtime = new PineRuntime({
      provider: new Provider([]),
      symbol: "TEST",
      timeframe: "1m",
    });
    return runtime
      .run((ctx) => {
        const condition = ctx.series("cond", () => ctx.close.value > 11);
        expect(() => ta.valuewhen(condition, ctx.close, -1)).toThrow(RangeError);
        expect(() => ta.valuewhen(condition, ctx.close, 1.5)).toThrow(RangeError);
      }, [])
      .then(() => undefined);
  });
});

describe("ta.highestbars / ta.lowestbars", () => {
  // Mirrors fixtures/v6/ta/highestbars.basic.json and lowestbars.basic.json.
  // Ties resolve to the most recent bar (offset closest to zero).
  it("highestbars matches the reference vector including ties", async () => {
    const values = await runHistorical(
      closesToBars([5, 1, 2, 3, 3, 4, 2, 1]),
      (ctx) => ta.highestbars(ctx.close, 3).value,
    );
    expect(Number.isNaN(values[0])).toBe(true);
    expect(Number.isNaN(values[1])).toBe(true);
    expect(values[2]).toBe(-2);
    expect(values[3]).toBe(0);
    expect(values[4]).toBe(0);
    expect(values[5]).toBe(0);
    expect(values[6]).toBe(-1);
    expect(values[7]).toBe(-2);
  });

  it("lowestbars matches the reference vector including ties", async () => {
    const values = await runHistorical(
      closesToBars([1, 4, 3, 2, 2, 5, 6, 4]),
      (ctx) => ta.lowestbars(ctx.close, 3).value,
    );
    expect(values[2]).toBe(-2);
    expect(values[3]).toBe(0);
    expect(values[4]).toBe(0);
    expect(values[5]).toBe(-1);
    expect(values[6]).toBe(-2);
    expect(values[7]).toBe(0);
  });
});

describe("ta.pivothigh / ta.pivotlow", () => {
  // Mirrors fixtures/v6/ta/pivothigh.basic.json and pivotlow.basic.json.
  // Equal neighbors break strict dominance, so no pivot forms for them.
  const highSeries = [1, 2, 5, 2, 1, 3, 4, 3, 2, 5, 5, 4, 3, 2];
  const lowSeries = [5, 4, 1, 4, 5, 3, 2, 3, 4, 1, 1, 2, 3, 4];

  const ohlcBars = (highs: readonly number[], lows: readonly number[]): readonly Bar[] =>
    highs.map((high, index) => ({
      time: index + 1,
      open: (high + (lows[index] ?? high)) / 2,
      high,
      low: lows[index] ?? high,
      close: (high + (lows[index] ?? high)) / 2,
      volume: 1,
      isClosed: true,
    }));

  it("pivothigh matches the reference vector and blocks equal highs", async () => {
    const bars = ohlcBars(highSeries, highSeries);
    const values = await runHistorical(bars, (ctx) => ta.pivothigh(ctx.high, 2, 2).value);
    expect(values[4]).toBe(5);
    expect(values[8]).toBe(4);
    // The equal 5s at bars 9-10 never confirm a pivot at bar 11.
    expect(Number.isNaN(values[11])).toBe(true);
    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
  });

  it("pivotlow matches the reference vector and blocks equal lows", async () => {
    const bars = ohlcBars(lowSeries, lowSeries);
    const values = await runHistorical(bars, (ctx) => ta.pivotlow(ctx.low, 2, 2).value);
    expect(values[4]).toBe(1);
    expect(values[8]).toBe(2);
    expect(Number.isNaN(values[11])).toBe(true);
  });

  it("supports the implicit high/low overloads", async () => {
    const bars = ohlcBars(highSeries, lowSeries);
    const fromSource = await runHistorical(bars, (ctx) => ta.pivothigh(ctx.high, 2, 2).value);
    const implicit = await runHistorical(bars, (_ctx) => ta.pivothigh(2, 2).value);
    expect(implicit).toEqual(fromSource);
    const lowFromSource = await runHistorical(bars, (ctx) => ta.pivotlow(ctx.low, 2, 2).value);
    const lowImplicit = await runHistorical(bars, (_ctx) => ta.pivotlow(2, 2).value);
    expect(lowImplicit).toEqual(lowFromSource);
  });

  it("waits for the full window before reporting (no lookahead)", async () => {
    const bars = ohlcBars(highSeries, highSeries);
    const values = await runHistorical(bars, (ctx) => ta.pivothigh(ctx.high, 2, 2).value);
    // The bar 2 pivot (5) is only reported once two right-side bars passed.
    expect(Number.isNaN(values[2])).toBe(true);
    expect(Number.isNaN(values[3])).toBe(true);
    expect(values[4]).toBe(5);
  });

  it("rejects non-positive strengths", () => {
    const runtime = new PineRuntime({
      provider: new Provider([]),
      symbol: "TEST",
      timeframe: "1m",
    });
    return runtime
      .run((ctx) => {
        expect(() => ta.pivothigh(ctx.high, 0, 2)).toThrow(RangeError);
        expect(() => ta.pivotlow(ctx.low, 2, -1)).toThrow(RangeError);
      }, [])
      .then(() => undefined);
  });
});

describe("events realtime rollback", () => {
  it("discards unconfirmed barssince/valuewhen ticks", async () => {
    const ticks: Bar[] = [
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1, isClosed: true },
      { time: 2, open: 10, high: 10, low: 10, close: 11, volume: 1, isClosed: true },
      { time: 3, open: 11, high: 11, low: 11, close: 11, volume: 1, isClosed: false },
      { time: 3, open: 11, high: 11, low: 11, close: 12, volume: 1, isClosed: false },
      { time: 3, open: 11, high: 11, low: 11, close: 10.5, volume: 1, isClosed: true },
    ];
    const barsSince = await runRealtime(ticks, (ctx) => {
      const condition = ctx.series("close-above-10.5", () => ctx.close.value > 10.5);
      return ta.barssince(condition).value;
    });
    // The confirmed bar 3 close is 10.5, so the last true bar is bar 2 -> 1.
    expect(barsSince[barsSince.length - 1]).toBe(1);

    const captured = await runRealtime(ticks, (ctx) => {
      const condition = ctx.series("close-above-10.5", () => ctx.close.value > 10.5);
      return ta.valuewhen(condition, ctx.close, 0).value;
    });
    // Unconfirmed 11/12 ticks roll back; the only committed capture on bar 3
    // stays bar 2's close (11), because the confirmed 10.5 does not fire.
    expect(captured[captured.length - 1]).toBe(11);
  });
});
