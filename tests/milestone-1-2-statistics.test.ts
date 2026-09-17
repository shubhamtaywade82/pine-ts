import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };
const bars = [1, 2, 3, 4].map((close, index) => ({
  time: index + 1,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  isClosed: true,
})) satisfies readonly Bar[];

class Provider implements MarketDataProvider {
  public getHistoricalBars = async (): Promise<readonly Bar[]> => bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

describe("Milestone 1.2 — statistics", () => {
  it("calculates biased and unbiased rolling variance", async () => {
    const biased: number[] = [];
    const unbiased: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => {
      biased.push(ta.variance(ctx.close, 3).value);
      unbiased.push(ta.variance(ctx.close, 3, false).value);
    }, bars);

    expect(biased.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(unbiased.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(biased[2]).toBeCloseTo(2 / 3);
    expect(biased[3]).toBeCloseTo(2 / 3);
    expect(unbiased[2]).toBeCloseTo(1);
    expect(unbiased[3]).toBeCloseTo(1);
  });

  it("calculates standard deviation from the same variance semantics", async () => {
    const values: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => values.push(ta.stdev(ctx.close, 3).value), bars);

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(Math.sqrt(2 / 3));
    expect(values[3]).toBeCloseTo(Math.sqrt(2 / 3));
  });

  it("calculates mean absolute deviation", async () => {
    const values: number[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => values.push(ta.dev(ctx.close, 3).value), bars);

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(2 / 3);
    expect(values[3]).toBeCloseTo(2 / 3);
  });

  it("preserves structural identity for repeated statistical nodes", async () => {
    const identities: unknown[] = [];
    const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });

    await runtime.run((ctx) => {
      identities.push(ta.stdev(ctx.close, 3));
      identities.push(ta.stdev(ctx.close, 3));
    }, bars);

    expect(identities[0]).toBe(identities[1]);
  });
});
