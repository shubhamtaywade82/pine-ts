import { describe, expect, it } from "vitest";
import { PineRuntime, type Bar, type MarketDataProvider } from "../src/index.js";

const bars: readonly Bar[] = [
  { time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
  { time: 2, open: 1.5, high: 3, low: 1, close: 2.5, volume: 12 },
];

const provider: MarketDataProvider = {
  async getHistoricalBars() {
    return bars;
  },
  async *streamBars() {
    yield* [];
  },
  async getSymbolInfo(symbol) {
    return { ticker: symbol };
  },
};

describe("PineRuntime", () => {
  it("executes once per historical bar and exposes history", async () => {
    const runtime = new PineRuntime({ provider, symbol: "TEST", timeframe: "1m" });
    const observed: Array<[number, number | undefined, boolean]> = [];

    await runtime.run((ctx) => {
      observed.push([ctx.close.current!, ctx.close.at(1), ctx.barstate.isConfirmed]);
    });

    expect(observed).toEqual([
      [1.5, undefined, true],
      [2.5, 1.5, true],
    ]);
  });
});
