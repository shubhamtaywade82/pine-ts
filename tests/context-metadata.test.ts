import { describe, expect, it } from "vitest";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";
import * as time from "../src/time/index.js";
import * as timeframe from "../src/time/timeframe.js";

const testInfo: SymbolInfo = {
  ticker: "BTCUSDT",
  tickerId: "BINANCE:BTCUSDT",
  minTick: 0.01,
  timezone: "UTC",
};

class TestProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const runWithBars = async (bars: readonly Bar[], script: PineScript, tf = "1m"): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new TestProvider(bars),
    symbol: "BTCUSDT",
    timeframe: tf,
  });
  await runtime.run(script, bars);
};

describe("bar_index and barstate metadata", () => {
  it("tracks bar_index accurately across bars and supports history", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 11, high: 11, low: 11, close: 11, volume: 100, isClosed: true },
      { time: 3000, open: 12, high: 12, low: 12, close: 12, volume: 100, isClosed: true },
    ];

    const observedIndices: number[] = [];
    let prevIndexAtLastBar = -1;

    await runWithBars(bars, (ctx) => {
      // at(0) is always defined on a live bar; bar_index is pushed before execute()
      observedIndices.push(ctx.bar_index.at(0)!);
      if (ctx.barstate.islast) {
        prevIndexAtLastBar = ctx.bar_index.at(1) ?? -1;
      }
    });

    expect(observedIndices).toEqual([0, 1, 2]);
    expect(prevIndexAtLastBar).toBe(1);
  });

  it("exposes Pine-compatible barstate flags", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 11, high: 11, low: 11, close: 11, volume: 100, isClosed: true },
    ];

    let firstFlag = false;
    let lastFlag = false;
    let historyFlag = false;

    await runWithBars(bars, (ctx) => {
      if (ctx.barstate.isfirst) firstFlag = true;
      if (ctx.barstate.islast) lastFlag = true;
      if (ctx.barstate.ishistory) historyFlag = true;
    });

    expect(firstFlag).toBe(true);
    expect(lastFlag).toBe(true);
    expect(historyFlag).toBe(true);
  });
});

describe("calendar and time functions", () => {
  it("extracts UTC date/time components correctly", () => {
    // 2026-09-27T12:34:56.000Z
    // Sunday -> dayofweek = 1 in Pine Script
    const ts = Date.UTC(2026, 8, 27, 12, 34, 56); // month is 0-indexed in Date.UTC (8 = September)

    expect(time.year(ts)).toBe(2026);
    expect(time.month(ts)).toBe(9); // 1-indexed (September = 9)
    expect(time.dayofmonth(ts)).toBe(27);
    expect(time.dayofweek(ts)).toBe(1); // Sunday is 1
    expect(time.hour(ts)).toBe(12);
    expect(time.minute(ts)).toBe(34);
    expect(time.second(ts)).toBe(56);
  });
});

describe("timeframe calculations", () => {
  it("converts timeframes to seconds and back", () => {
    expect(timeframe.in_seconds("1")).toBe(60);
    expect(timeframe.in_seconds("5")).toBe(300);
    expect(timeframe.in_seconds("1m")).toBe(60);
    expect(timeframe.in_seconds("1h")).toBe(3600);
    expect(timeframe.in_seconds("1D")).toBe(86400);
    expect(timeframe.in_seconds("1W")).toBe(604800);

    expect(timeframe.from_seconds(60)).toBe("1");
    expect(timeframe.from_seconds(300)).toBe("5");
    expect(timeframe.from_seconds(86400)).toBe("1D");
  });

  it("detects timeframe types accurately", () => {
    const tfInfo = timeframe.parse("15m");
    expect(tfInfo.isintraday).toBe(true);
    expect(tfInfo.isdaily).toBe(false);
    expect(tfInfo.multiplier).toBe(15);

    const dailyInfo = timeframe.parse("1D");
    expect(dailyInfo.isdaily).toBe(true);
    expect(dailyInfo.isdwm).toBe(true);
    expect(dailyInfo.isintraday).toBe(false);
  });
});
