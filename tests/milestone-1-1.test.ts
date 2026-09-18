import { describe, expect, it } from "vitest";
import { PineRuntime, createSeries, na, nz, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };
const bar = (time: number, close: number, isClosed = true): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  isClosed,
});

class Provider implements MarketDataProvider {
  public constructor(private readonly stream: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.stream;

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

describe("Milestone 1.1", () => {
  it("implements Pine-style history indexing and na", () => {
    const series = createSeries([10, 20, 30]);
    expect(series.current).toBe(30);
    expect(series.at(1)).toBe(20);
    expect(series.at(3)).toBeUndefined();
    expect(Number.isNaN(na)).toBe(true);
    expect(nz(undefined, 7)).toBe(7);
    expect(nz(5, 7)).toBe(5);
  });

  it("requires TA expressions to execute inside a Pine runtime", () => {
    const series = createSeries<number>();
    expect(() => ta.sma(series, 3)).toThrow(/PineSession-owned/);
  });

  it("rolls var back on intrabar execution but preserves varip", async () => {
    const events = [bar(1, 100, false), bar(1, 101, false), bar(1, 102, true), bar(2, 103, true)];
    const runtime = new PineRuntime({
      provider: new Provider(events),
      symbol: "TEST",
      timeframe: "1m",
      executionMode: "realtime",
    });
    const seen: Array<[number, number, number, boolean]> = [];

    await runtime.runRealtime((ctx) => {
      const regular = ctx.state.var("regular", () => 0);
      const intrabar = ctx.state.varip("intrabar", () => 0);
      regular.set(regular.value + 1);
      intrabar.set(intrabar.value + 1);
      seen.push([ctx.bar.close, regular.value, intrabar.value, ctx.barstate.isConfirmed]);
    });

    expect(seen).toEqual([
      [100, 1, 1, false],
      [101, 1, 2, false],
      [102, 1, 3, true],
      [103, 2, 4, true],
    ]);
  });
});
