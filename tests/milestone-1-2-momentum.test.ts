import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };
const bars = [
  { time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1, isClosed: true },
  { time: 2, open: 2, high: 3, low: 1, close: 2, volume: 2, isClosed: true },
  { time: 3, open: 3, high: 4, low: 2, close: 3, volume: 3, isClosed: true },
  { time: 4, open: 4, high: 5, low: 3, close: 4, volume: 4, isClosed: true },
  { time: 5, open: 5, high: 6, low: 4, close: 5, volume: 5, isClosed: true },
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

type Evaluator = (context: Parameters<PineScript>[0]) => number;

const run = async (evaluate: Evaluator): Promise<number[]> => {
  const values: number[] = [];
  const runtime = new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1m" });
  await runtime.run(
    (ctx) => {
      values.push(evaluate(ctx));
    },
    bars,
  );
  return values;
};

describe("Milestone 1.2 — momentum oscillators", () => {
  it("calculates momentum", async () => {
    const values = await run((ctx) => ta.mom(ctx.close, 2).value);
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values.slice(2)).toEqual([2, 2, 2]);
  });

  it("calculates rate of change as percent", async () => {
    const values = await run((ctx) => ta.roc(ctx.close, 2).value);
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(200);
    expect(values[3]).toBeCloseTo(100);
    expect(values[4]).toBeCloseTo(66.66666666666667);
  });

  it("calculates RSI using Wilder smoothing", async () => {
    const values = await run((ctx) => ta.rsi(ctx.close, 3).value);
    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(values.slice(3)).toEqual([100, 100]);
  });

  it("calculates stochastic oscillator from source, high and low", async () => {
    const values = await run((ctx) => ta.stoch(ctx.close, ctx.high, ctx.low, 3).value);
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(75);
    expect(values[3]).toBeCloseTo(75);
    expect(values[4]).toBeCloseTo(75);
  });

  it("calculates Williams %R from implicit OHLC sources", async () => {
    const values = await run(() => ta.wpr(3).value);
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(-25);
    expect(values[3]).toBeCloseTo(-25);
    expect(values[4]).toBeCloseTo(-25);
  });

  it("calculates CMO from rolling gains and losses", async () => {
    const values = await run((ctx) => ta.cmo(ctx.close, 3).value);
    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(values.slice(3)).toEqual([100, 100]);
  });
});
