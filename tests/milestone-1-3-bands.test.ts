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

interface OhlcBar {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

const ohlcToBars = (rows: readonly OhlcBar[]): readonly Bar[] =>
  rows.map((row, index) => ({
    time: index + 1,
    ...row,
    volume: 1,
    isClosed: true,
  })) satisfies readonly Bar[];

const closesWithNaToBars = (values: ReadonlyArray<number | null>): readonly Bar[] =>
  values.map((value, index) => {
    const close = value === null ? Number.NaN : value;
    return {
      time: index + 1,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      isClosed: true,
    };
  }) satisfies readonly Bar[];

const tick = (time: number, close: number, isClosed: boolean): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  isClosed,
});

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

describe("ta.bbw", () => {
  // Mirrors fixtures/v6/ta/bbw.basic.json, computed with the official v6
  // re-implementation (((basis + dev) - (basis - dev)) / basis) * 100.
  const expected = [
    Number.NaN,
    Number.NaN,
    163.2993161855452,
    108.8662107903635,
    81.64965809277261,
  ];

  it("matches the reference vector including the x100 factor", async () => {
    const values = await runHistorical(
      closesToBars([1, 2, 3, 4, 5]),
      (ctx) => ta.bbw(ctx.close, 3, 2).value,
    );
    values.forEach((value, index) => {
      const expectedValue = expected[index] ?? Number.NaN;
      if (Number.isNaN(expectedValue)) expect(Number.isNaN(value)).toBe(true);
      else expect(value).toBeCloseTo(expectedValue, 10);
    });
  });

  it("warms up for length - 1 bars and exposes history once committed", async () => {
    const values = await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const width = ta.bbw(ctx.close, 3, 2);
      return { value: width.value, previous: width.at(1) };
    });
    expect(values.slice(0, 2).every(({ value }) => Number.isNaN(value))).toBe(true);
    expect(values[4]?.previous).toBeCloseTo(108.8662107903635, 10);
  });

  it("rejects invalid lengths and multipliers", () => {
    const runtime = new PineRuntime({
      provider: new Provider([]),
      symbol: "TEST",
      timeframe: "1m",
    });
    return runtime
      .run((ctx) => {
        expect(() => ta.bbw(ctx.close, 0, 2)).toThrow(RangeError);
        expect(() => ta.bbw(ctx.close, 3, Number.POSITIVE_INFINITY)).toThrow(RangeError);
      }, [])
      .then(() => undefined);
  });
});

describe("ta.kc", () => {
  // Mirrors fixtures/v6/ta/kc.basic.json (useTrueRange = true). Bar 1 gaps
  // below the previous close, so ta.tr (0.6) differs from high - low (0.4).
  const bars = ohlcToBars([
    { open: 10.0, high: 11.0, low: 9.0, close: 10.0 },
    { open: 9.7, high: 9.8, low: 9.4, close: 9.5 },
    { open: 9.5, high: 10.4, low: 9.3, close: 10.2 },
    { open: 10.2, high: 10.3, low: 9.9, close: 10.1 },
    { open: 10.1, high: 10.9, low: 9.8, close: 10.8 },
    { open: 10.8, high: 11.6, low: 10.5, close: 11.5 },
  ]);
  const expectedMiddle = [10.0, 9.75, 9.975, 10.0375, 10.41875, 10.959375];
  const expectedUpper = [14.0, 12.35, 12.375, 11.6375, 12.31875, 13.009374999999999];
  const expectedLower = [6.0, 7.15, 7.575, 8.4375, 8.518749999999999, 8.909375];

  it("matches the true-range reference vector", async () => {
    const rows = await runHistorical(bars, (ctx) => {
      const channels = ta.kc(ctx.close, 3, 2, true);
      return {
        middle: channels.middle.value,
        upper: channels.upper.value,
        lower: channels.lower.value,
      };
    });
    rows.forEach((row, index) => {
      expect(row.middle).toBeCloseTo(expectedMiddle[index] ?? Number.NaN, 10);
      expect(row.upper).toBeCloseTo(expectedUpper[index] ?? Number.NaN, 10);
      expect(row.lower).toBeCloseTo(expectedLower[index] ?? Number.NaN, 10);
    });
  });

  // Mirrors fixtures/v6/ta/kc.range.json (useTrueRange = false).
  it("uses the plain high - low range when useTrueRange is false", async () => {
    const rows = await runHistorical(bars, (ctx) => {
      const channels = ta.kc(ctx.close, 3, 2, false);
      return { upper: channels.upper.value, lower: channels.lower.value };
    });
    const expectedUpper = [14.0, 12.15, 12.274999999999999, 11.5875, 12.29375, 12.996875];
    const expectedLower = [6.0, 7.35, 7.675, 8.487499999999999, 8.54375, 8.921875];
    rows.forEach((row, index) => {
      expect(row.upper).toBeCloseTo(expectedUpper[index] ?? Number.NaN, 10);
      expect(row.lower).toBeCloseTo(expectedLower[index] ?? Number.NaN, 10);
    });
  });

  it("defaults useTrueRange to true", async () => {
    const explicit = await runHistorical(bars, (ctx) => ta.kc(ctx.close, 3, 2, true).upper.value);
    const defaulted = await runHistorical(bars, (ctx) => ta.kc(ctx.close, 3, 2).upper.value);
    expect(defaulted).toEqual(explicit);
  });

  it("is isolated across independent runtimes", async () => {
    const first = await runHistorical(bars, (ctx) => ta.kc(ctx.close, 3, 2).middle.value);
    const second = await runHistorical(bars, (ctx) => ta.kc(ctx.close, 3, 2).middle.value);
    expect(second).toEqual(first);
  });
});

describe("ta.kcw", () => {
  // Mirrors fixtures/v6/ta/kcw.basic.json: (upper - lower) / middle with no
  // x100 factor, derived from the kc.basic.json channels.
  const bars = ohlcToBars([
    { open: 10.0, high: 11.0, low: 9.0, close: 10.0 },
    { open: 9.7, high: 9.8, low: 9.4, close: 9.5 },
    { open: 9.5, high: 10.4, low: 9.3, close: 10.2 },
    { open: 10.2, high: 10.3, low: 9.9, close: 10.1 },
    { open: 10.1, high: 10.9, low: 9.8, close: 10.8 },
    { open: 10.8, high: 11.6, low: 10.5, close: 11.5 },
  ]);
  const expected = [
    0.8, 0.5333333333333332, 0.48120300751879697, 0.3188044831880448, 0.3647270545890823,
    0.3741089250071284,
  ];

  it("matches the reference vector without the x100 factor", async () => {
    const values = await runHistorical(bars, (ctx) => ta.kcw(ctx.close, 3, 2, true).value);
    values.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 10);
    });
  });
});

describe("statistics na windows (v6 length non-na semantics)", () => {
  // Mirrors fixtures/v6/ta/highest.na.json and stdev.na.json: na bars are
  // skipped and the window extends back to collect `length` non-na values.
  const naBars = closesWithNaToBars([3, null, 5, null, 2, 4]);

  it("highest skips na bars and extends the window back", async () => {
    const values = await runHistorical(naBars, (ctx) => ta.highest(ctx.close, 3).value);
    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(values[4]).toBe(5);
    expect(values[5]).toBe(5);
  });

  it("lowest shares the skip-extend window model", async () => {
    const values = await runHistorical(naBars, (ctx) => ta.lowest(ctx.close, 3).value);
    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(values[4]).toBe(2);
    expect(values[5]).toBe(2);
  });

  it("stdev skips na bars and extends the window back", async () => {
    const values = await runHistorical(naBars, (ctx) => ta.stdev(ctx.close, 3).value);
    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(values[4]).toBeCloseTo(1.247219128924647, 10);
    expect(values[5]).toBeCloseTo(1.247219128924647, 10);
  });

  it("keeps the clean-window behavior identical to the pinned fixtures", async () => {
    const values = await runHistorical(
      closesToBars([1, 2, 3, 4]),
      (ctx) => ta.stdev(ctx.close, 3).value,
    );
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(0.816496580927726, 10);
    expect(values[3]).toBeCloseTo(0.816496580927726, 10);
  });
});

describe("band realtime rollback", () => {
  it("discards unconfirmed bbw ticks and commits the confirmed bar", async () => {
    const ticks: Bar[] = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
      { time: 2, open: 2, high: 2, low: 2, close: 2, volume: 1, isClosed: true },
      { time: 3, open: 3, high: 3, low: 3, close: 3, volume: 1, isClosed: true },
      tick(4, 9, false),
      tick(4, 4, true),
    ];
    const values = await runRealtime(ticks, (ctx) => ta.bbw(ctx.close, 3, 2).value);
    // The unconfirmed close=9 tick rolls back; the confirmed bar replays to
    // the same value a historical run produces for window [2, 3, 4].
    expect(values[values.length - 1]).toBeCloseTo(108.8662107903635, 10);
  });
});
