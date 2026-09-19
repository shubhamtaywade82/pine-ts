import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

interface VolumeBar {
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

const toBars = (rows: readonly VolumeBar[]): readonly Bar[] =>
  rows.map((row, index) => ({
    // Bar times are unix seconds; 60s spacing keeps every bar on one UTC day
    // so the default daily anchor never resets mid-run.
    time: 1700000000 + index * 60,
    open: row.close,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    isClosed: true,
  })) satisfies readonly Bar[];

const closesVolumeToBars = (
  closes: readonly number[],
  volumes: readonly number[],
): readonly Bar[] =>
  closes.map((close, index) => ({
    time: 1700000000 + index * 60,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes[index] ?? 0,
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

describe("ta.obv", () => {
  // Mirrors fixtures/v6/ta/obv.basic.json, computed from the official
  // re-implementation ta.cum(math.sign(ta.change(close)) * volume).
  const closes = [10, 11, 10.5, 10.5, 11];
  const volumes = [100, 200, 150, 300, 50];
  const expected = [0, 200, 50, 50, 100];

  it("matches the reference vector", async () => {
    const values = await runHistorical(
      closesVolumeToBars(closes, volumes),
      (_ctx) => ta.obv().value,
    );
    expect(values).toEqual(expected);
  });

  it("exposes committed history", async () => {
    const values = await runHistorical(closesVolumeToBars(closes, volumes), (_ctx) =>
      ta.obv().at(1),
    );
    expect(values[4]).toBe(50);
  });
});

describe("ta.pvt", () => {
  // Mirrors fixtures/v6/ta/pvt.basic.json: ta.cum((change(close) / close[1]) * volume).
  it("matches the reference vector", async () => {
    const values = await runHistorical(
      closesVolumeToBars([10, 11, 10.5, 11.55], [100, 200, 150, 300]),
      (_ctx) => ta.pvt().value,
    );
    expect(values[0]).toBe(0);
    expect(values[1]).toBeCloseTo(20, 10);
    expect(values[2]).toBeCloseTo(13.181818181818182, 10);
    expect(values[3]).toBeCloseTo(43.1818181818182, 10);
  });
});

describe("ta.pvi / ta.nvi", () => {
  // Mirrors fixtures/v6/ta/pvi.basic.json and nvi.basic.json: seed 1.0,
  // update only when volume rises (pvi) or falls (nvi), otherwise carry.
  const closes = [10, 11, 10, 11, 10.5];
  const volumes = [100, 150, 120, 200, 180];
  const bars = closesVolumeToBars(closes, volumes);

  it("pvi matches the reference vector", async () => {
    const values = await runHistorical(bars, (_ctx) => ta.pvi().value);
    expect(values[0]).toBe(1);
    expect(values[1]).toBeCloseTo(1.1, 10);
    expect(values[2]).toBeCloseTo(1.1, 10);
    expect(values[3]).toBeCloseTo(1.2100000000000002, 10);
    expect(values[4]).toBeCloseTo(1.2100000000000002, 10);
  });

  it("nvi matches the reference vector", async () => {
    const values = await runHistorical(bars, (_ctx) => ta.nvi().value);
    expect(values[0]).toBe(1);
    expect(values[1]).toBeCloseTo(1, 10);
    expect(values[2]).toBeCloseTo(0.9090909090909091, 10);
    expect(values[3]).toBeCloseTo(0.9090909090909091, 10);
    expect(values[4]).toBeCloseTo(0.8677685950413223, 10);
  });

  it("is isolated across independent runtimes", async () => {
    const first = await runHistorical(bars, (_ctx) => ta.pvi().value);
    const second = await runHistorical(bars, (_ctx) => ta.pvi().value);
    expect(second).toEqual(first);
  });
});

describe("ta.mfi", () => {
  // Mirrors fixtures/v6/ta/mfi.basic.json: math.sum windows over signed
  // volume * hlc3 flows, per the official re-implementation.
  const bars = toBars([
    { high: 10.5, low: 9.5, close: 10.0, volume: 100 },
    { high: 11.5, low: 10.5, close: 11.0, volume: 200 },
    { high: 11.0, low: 10.0, close: 10.5, volume: 150 },
    { high: 11.2, low: 10.2, close: 11.0, volume: 300 },
    { high: 11.8, low: 10.8, close: 11.5, volume: 120 },
    { high: 11.6, low: 10.6, close: 11.2, volume: 180 },
  ]);
  const expected = [
    Number.NaN,
    Number.NaN,
    55.41125541125541,
    77.54811119030649,
    74.51043858229487,
    69.67312348668281,
  ];

  it("matches the reference vector with math.sum windows", async () => {
    const values = await runHistorical(bars, (_ctx) => ta.mfi(_ctx.hlc3, 3).value);
    values.forEach((value, index) => {
      if (Number.isNaN(expected[index] ?? Number.NaN)) expect(Number.isNaN(value)).toBe(true);
      else expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 10);
    });
  });

  it("returns na while the window excludes bar 0 and when no negative flow exists", async () => {
    // Every bar closes higher. The first bar's na change seeds both windows
    // (Pine v6 na comparisons are false), so the 3-bar window still holds a
    // negative flow until bar 3 drops bar 0's contribution: from then on
    // lower = 0 and the MFI division is na, per the reference formula.
    const rising = toBars([
      { high: 11.0, low: 9.0, close: 10.0, volume: 100 },
      { high: 12.0, low: 10.0, close: 11.0, volume: 100 },
      { high: 13.0, low: 11.0, close: 12.0, volume: 100 },
      { high: 14.0, low: 12.0, close: 13.0, volume: 100 },
    ]);
    const values = await runHistorical(rising, (_ctx) => ta.mfi(_ctx.hlc3, 3).value);
    expect(Number.isNaN(values[0])).toBe(true);
    expect(Number.isNaN(values[1])).toBe(true);
    expect(values[2]).toBeCloseTo(76.74418604651163, 10);
    expect(Number.isNaN(values[3])).toBe(true);
  });

  it("rejects invalid lengths", () => {
    const runtime = new PineRuntime({
      provider: new Provider([]),
      symbol: "TEST",
      timeframe: "1m",
    });
    return runtime
      .run((ctx) => {
        expect(() => ta.mfi(ctx.hlc3, 0)).toThrow(RangeError);
      }, [])
      .then(() => undefined);
  });
});

describe("ta.vwap", () => {
  // Mirrors fixtures/v6/ta/vwap.basic.json: a single session accumulates
  // sum(source * volume) / sum(volume) from the first bar.
  it("accumulates within one session", async () => {
    const values = await runHistorical(
      closesVolumeToBars([10, 11, 10.5, 11.2], [100, 200, 150, 300]),
      (ctx) => ta.vwap(ctx.close).value,
    );
    expect(values[0]).toBeCloseTo(10, 10);
    expect(values[1]).toBeCloseTo(10.666666666666666, 10);
    expect(values[2]).toBeCloseTo(10.61111111111111, 10);
    expect(values[3]).toBeCloseTo(10.846666666666666, 10);
  });

  // Mirrors fixtures/v6/ta/vwap.anchor.json: an explicit anchor (source >
  // 11.9, expressed as a series over the source) resets the accumulation
  // and the anchor bar starts the new window.
  it("resets on an explicit anchor", async () => {
    const closes = [12, 10, 10.5, 12, 10.8, 11.5];
    const volumes = [100, 200, 150, 300, 250, 100];
    const bars = closesVolumeToBars(closes, volumes);
    const values = await runHistorical(bars, (ctx) => {
      const anchor = ctx.series("source-above-11.9", () => ctx.close.value > 11.9);
      return ta.vwap(ctx.close, anchor).value;
    });
    expect(values[0]).toBeCloseTo(12, 10);
    expect(values[1]).toBeCloseTo(10.666666666666666, 10);
    expect(values[2]).toBeCloseTo(10.61111111111111, 10);
    expect(values[3]).toBeCloseTo(12, 10);
    expect(values[4]).toBeCloseTo(11.454545454545455, 10);
    expect(values[5]).toBeCloseTo(11.461538461538462, 10);
  });

  it("returns na until the first anchor fires", async () => {
    const bars = closesVolumeToBars([10, 10.5, 11, 11.2], [100, 200, 150, 300]);
    const values = await runHistorical(bars, (ctx) => {
      const anchor = ctx.series("source-above-10.6", () => ctx.close.value > 10.6);
      return ta.vwap(ctx.close, anchor).value;
    });
    expect(Number.isNaN(values[0])).toBe(true);
    expect(Number.isNaN(values[1])).toBe(true);
    // Bar 2 starts the accumulation; bar 3 fires the anchor again and resets.
    expect(values[2]).toBeCloseTo(11, 10);
    expect(values[3]).toBeCloseTo(11.2, 10);
  });

  it("starts a new accumulation on a new trading day (default anchor)", async () => {
    // Bar times cross a UTC day boundary between bars 1 and 2.
    const bars: Bar[] = [
      { time: 1700000000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 1700000100, open: 11, high: 11, low: 11, close: 11, volume: 100, isClosed: true },
      { time: 1700064000, open: 12, high: 12, low: 12, close: 12, volume: 300, isClosed: true },
    ];
    const values = await runHistorical(bars, (_ctx) => ta.vwap(_ctx.close).value);
    expect(values[0]).toBeCloseTo(10, 10);
    expect(values[1]).toBeCloseTo(10.5, 10);
    // New day: the accumulation restarts with bar 2 alone.
    expect(values[2]).toBeCloseTo(12, 10);
  });
});

describe("ta.accdist", () => {
  // Mirrors fixtures/v6/ta/accdist.basic.json: the standard Chaikin
  // accumulation/distribution line.
  const bars = toBars([
    { high: 11.0, low: 9.0, close: 10.0, volume: 100 },
    { high: 12.0, low: 10.0, close: 11.5, volume: 200 },
    { high: 11.5, low: 9.5, close: 11.0, volume: 150 },
    { high: 12.0, low: 11.0, close: 11.8, volume: 300 },
  ]);

  it("matches the reference vector", async () => {
    const values = await runHistorical(bars, (_ctx) => ta.accdist().value);
    expect(values[0]).toBeCloseTo(0, 10);
    expect(values[1]).toBeCloseTo(100, 10);
    expect(values[2]).toBeCloseTo(175, 10);
    expect(values[3]).toBeCloseTo(355, 6);
  });

  it("skips zero-range bars instead of poisoning the sum", async () => {
    const flat = toBars([{ high: 10, low: 10, close: 10, volume: 500 }]);
    const values = await runHistorical(flat, (_ctx) => ta.accdist().value);
    expect(values[0]).toBe(0);
  });
});

describe("volume realtime rollback", () => {
  it("discards unconfirmed obv/pvi ticks and commits the confirmed bar", async () => {
    const confirmed: Bar[] = closesVolumeToBars([10, 11, 10.5], [100, 200, 150]).map((bar) => ({
      ...bar,
      isClosed: true,
    }));
    const unconfirmed: Bar = {
      ...closesVolumeToBars([9], [999])[0]!,
      time: confirmed[confirmed.length - 1]!.time + 60,
      isClosed: false,
    };
    const finalTick: Bar = { ...unconfirmed, close: 10.8, volume: 50, isClosed: true };
    const ticks = [...confirmed, unconfirmed, finalTick];

    const obvValues = await runRealtime(ticks, (_ctx) => ta.obv().value);
    // A historical run over [10, 11, 10.5, 10.8] with volumes [100, 200, 150, 50]
    // ends at 0 + 200 - 150 + 50 = 100.
    expect(obvValues[obvValues.length - 1]).toBeCloseTo(100, 10);

    const pviValues = await runRealtime(ticks, (_ctx) => ta.pvi().value);
    const historicalPvi = await runHistorical(
      closesVolumeToBars([10, 11, 10.5, 10.8], [100, 200, 150, 50]),
      (_ctx) => ta.pvi().value,
    );
    expect(pviValues[pviValues.length - 1]).toBeCloseTo(historicalPvi[3] ?? Number.NaN, 10);
  });
});
