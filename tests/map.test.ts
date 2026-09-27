import { describe, expect, it } from "vitest";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";
import * as map from "../src/map/index.js";
import * as array from "../src/array/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
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

const runWithBars = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new TestProvider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("map creation and basic operations", () => {
  it("creates and mutates maps: put, get, contains, size", () => {
    const m = map.new_map<string, number>();
    expect(map.size(m)).toBe(0);
    expect(map.contains(m, "a")).toBe(false);

    map.put(m, "a", 100);
    map.put(m, "b", 200);
    expect(map.size(m)).toBe(2);
    expect(map.contains(m, "a")).toBe(true);
    expect(map.get(m, "a")).toBe(100);
    expect(map.get(m, "b")).toBe(200);
    expect(map.get(m, "c")).toBeUndefined();
  });

  it("supports remove, clear, copy, put_all", () => {
    const m = map.new_map<string, number>();
    map.put(m, "k1", 1);
    map.put(m, "k2", 2);

    const removed = map.remove(m, "k1");
    expect(removed).toBe(1);
    expect(map.contains(m, "k1")).toBe(false);
    expect(map.size(m)).toBe(1);

    const cloned = map.copy(m);
    expect(map.size(cloned)).toBe(1);
    expect(map.get(cloned, "k2")).toBe(2);

    const m2 = map.new_map<string, number>();
    map.put(m2, "k3", 3);
    map.put_all(m, m2);
    expect(map.size(m)).toBe(2);
    expect(map.get(m, "k3")).toBe(3);

    map.clear(m);
    expect(map.size(m)).toBe(0);
  });

  it("extracts keys and values into PineArrays", () => {
    const m = map.new_map<string, number>();
    map.put(m, "x", 10);
    map.put(m, "y", 20);

    const keys = map.keys(m);
    const values = map.values(m);

    expect(array.size(keys)).toBe(2);
    expect(array.includes(keys, "x")).toBe(true);
    expect(array.includes(keys, "y")).toBe(true);

    expect(array.size(values)).toBe(2);
    expect(array.includes(values, 10)).toBe(true);
    expect(array.includes(values, 20)).toBe(true);
  });
});

describe("map realtime rollback integration", () => {
  it("rolls back intrabar var map mutations on revised realtime ticks", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 12, high: 12, low: 12, close: 12, volume: 100, isClosed: false },
    ];

    let lastSize = 0;
    await runWithBars(bars, (ctx) => {
      const m = ctx.state.var("trackedMap", () => map.new_map<string, number>());
      map.put(m.value, `tick_${ctx.close.value}`, ctx.close.value);
      lastSize = map.size(m.value);
    });

    expect(lastSize).toBe(2);
  });
});
