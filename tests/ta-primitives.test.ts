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

describe("ta primitives", () => {
  it("calculates change against previous bars", async () => {
    const changes: number[] = [];
    const extendedChanges: number[] = [];

    await runOver(closesToBars([10, 12, 15]), (ctx) => {
      changes.push(ta.change(ctx.close).value);
      extendedChanges.push(ta.change(ctx.close, 2).value);
    });

    expect(changes).toEqual([Number.NaN, 2, 3]);
    expect(extendedChanges).toEqual([Number.NaN, Number.NaN, 5]);
  });

  it("detects both crossover and crossunder", async () => {
    // close crosses above its own SMA(3) exactly on the final bar, so the
    // close series crosses over the average while the average crosses under.
    let crossover = false;
    let crossunder = false;

    await runOver(closesToBars([1, 1, 1, 1, 3]), (ctx) => {
      const average = ta.sma(ctx.close, 3);
      crossover = ta.crossover(ctx.close, average).value;
      crossunder = ta.crossunder(average, ctx.close).value;
    });

    expect(crossover).toBe(true);
    expect(crossunder).toBe(true);
  });
});
