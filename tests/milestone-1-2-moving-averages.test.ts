import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };
const bars = [
  { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { time: 2, open: 2, high: 2, low: 2, close: 2, volume: 2, isClosed: true },
  { time: 3, open: 3, high: 3, low: 3, close: 3, volume: 3, isClosed: true },
  { time: 4, open: 4, high: 4, low: 4, close: 4, volume: 4, isClosed: true },
] satisfies readonly Bar[];

class Provider implements MarketDataProvider {
  public getHistoricalBars = async (): Promise<readonly Bar[]> => bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

describe("Milestone 1.2 — moving averages", () => {
  it("calculates WMA with greater weight on recent bars", async () => {
    const values: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => values.push(ta.wma(ctx.close, 3).value), bars);

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(14 / 6);
    expect(values[3]).toBeCloseTo(16 / 6);
  });

  it("calculates VWMA from price and volume", async () => {
    const values: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => values.push(ta.vwma(ctx.close, 3).value), bars);

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo((1 * 1 + 2 * 2 + 3 * 3) / 6);
    expect(values[3]).toBeCloseTo((2 * 2 + 3 * 3 + 4 * 4) / 9);
  });

  it("calculates fixed four-bar SWMA", async () => {
    const values: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => values.push(ta.swma(ctx.close).value), bars);

    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(values[3]).toBeCloseTo((4 + 2 * 3 + 2 * 2 + 1) / 6);
  });

  it("composes HMA from WMA nodes instead of duplicating moving-average logic", async () => {
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });
    const identities: unknown[] = [];

    await runtime.run((ctx) => {
      identities.push(ta.hma(ctx.close, 4));
      identities.push(ta.hma(ctx.close, 4));
    }, bars);

    expect(identities[0]).toBe(identities[1]);
  });
});
