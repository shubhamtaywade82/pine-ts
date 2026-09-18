import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const symbolInfo: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const makeBar = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  isClosed = true,
): Bar => ({ time, open, high, low, close, volume: 1, isClosed });

class FixtureProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => symbolInfo;
}

const run = async (
  bars: readonly Bar[],
  script: Parameters<PineRuntime["run"]>[0],
): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new FixtureProvider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("Milestone 1.2 — range and Wilder primitives", () => {
  it("composes ATR from TR and RMA as a first-class series", async () => {
    const bars = [
      makeBar(1, 10, 12, 9, 11),
      makeBar(2, 11, 13, 10, 12),
      makeBar(3, 12, 14, 11, 13),
      makeBar(4, 13, 15, 12, 14),
    ];
    const values: number[] = [];

    await run(bars, (_ctx) => {
      values.push(ta.atr(3).value);
    });

    // TR = [3, 3, 3, 3], so RMA(3) becomes 3 on the third bar and remains 3.
    expect(values).toEqual([Number.NaN, Number.NaN, 3, 3]);
  });

  it("evaluates true range against the previous committed close", async () => {
    const bars = [
      makeBar(1, 10, 12, 9, 11),
      makeBar(2, 11, 15, 14, 14.5),
      makeBar(3, 14.5, 16, 10, 11),
    ];
    const values: number[] = [];

    await run(bars, (_ctx) => {
      values.push(ta.tr().value);
    });

    expect(values[0]).toBe(3);
    expect(values[1]).toBe(4);
    expect(values[2]).toBe(6);
  });

  it("memoizes identical indicator expressions within a session", async () => {
    const bars = [makeBar(1, 10, 12, 9, 10), makeBar(2, 10, 13, 9, 11), makeBar(3, 11, 14, 10, 12)];
    const runtime = new PineRuntime({
      provider: new FixtureProvider(bars),
      symbol: "TEST",
      timeframe: "1m",
    });

    await runtime.run((ctx) => {
      const first = ta.ema(ctx.close, 2);
      const second = ta.ema(ctx.close, 2);
      expect(first).toBe(second);
    }, bars);
  });
});
