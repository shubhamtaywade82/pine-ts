import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

class Provider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

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

const runOver = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("ta core", () => {
  it("calculates SMA over the trailing window", async () => {
    const values: number[] = [];
    await runOver(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      values.push(ta.sma(ctx.close, 3).value);
    });

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values.slice(2)).toEqual([2, 3, 4]);
  });

  it("calculates EMA seeded from the first source value", async () => {
    const values: number[] = [];
    await runOver(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      values.push(ta.ema(ctx.close, 3).value);
    });

    expect(values[0]).toBe(1);
    expect(values[4]).toBeCloseTo(4.0625, 10);
  });

  it("finds rolling highest and lowest values", async () => {
    const highestValues: number[] = [];
    const lowestValues: number[] = [];
    await runOver(closesToBars([5, 2, 8, 4]), (ctx) => {
      highestValues.push(ta.highest(ctx.close, 3).value);
      lowestValues.push(ta.lowest(ctx.close, 3).value);
    });

    expect(highestValues.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(lowestValues.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(highestValues[3]).toBe(8);
    expect(lowestValues[3]).toBe(2);
  });

  it("detects crossovers and crossunders", async () => {
    // close crosses above its own SMA(3) exactly on the final bar:
    // close = [1, 1, 1, 1, 3], sma(3) = [na, na, 1, 1, 5/3].
    let crossover = false;
    let crossunder = false;

    await runOver(closesToBars([1, 1, 1, 1, 3]), (ctx) => {
      const average = ta.sma(ctx.close, 3);
      crossover = ta.crossover(ctx.close, average).value;
      crossunder = ta.crossunder(ctx.close, average).value;
    });

    expect(crossover).toBe(true);
    expect(crossunder).toBe(false);
  });
});
