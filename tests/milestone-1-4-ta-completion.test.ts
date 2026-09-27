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

const closesToBars = (closes: readonly number[], volumes?: readonly number[]): readonly Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes?.[index] ?? 1,
    isClosed: true,
  })) satisfies readonly Bar[];

const ohlcvBars: readonly Bar[] = [
  { time: 1, open: 9, high: 12, low: 8, close: 11, volume: 100, isClosed: true },
  { time: 2, open: 11, high: 13, low: 9, close: 9, volume: 200, isClosed: true },
  { time: 3, open: 10, high: 10, low: 10, close: 10, volume: 50, isClosed: true },
  { time: 4, open: 11, high: 14, low: 10, close: 13, volume: 150, isClosed: true },
];

const runOver = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

const collectValues = async (
  bars: readonly Bar[],
  read: (ctx: Parameters<PineScript>[0]) => number,
): Promise<number[]> => {
  const values: number[] = [];
  await runOver(bars, (ctx) => {
    values.push(read(ctx));
  });
  return values;
};

describe("Milestone 1.4 — ta completion", () => {
  it("exposes the hlcc4 source with double close weight", async () => {
    const values = await collectValues(ohlcvBars, (ctx) => ctx.hlcc4.value);

    expect(values).toEqual([
      (12 + 8 + 2 * 11) / 4,
      (13 + 9 + 2 * 9) / 4,
      10,
      (14 + 10 + 2 * 13) / 4,
    ]);
  });

  it("calculates the cumulative sum of the source", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 2, 5]),
      (ctx) => ta.cum(ctx.close).value,
    );

    expect(values).toEqual([1, 3, 6, 8, 13]);
  });

  it("tracks the all-time high and low", async () => {
    const bars = closesToBars([3, 1, 4, 1, 5]);
    const highs = await collectValues(bars, (ctx) => ta.max(ctx.close).value);
    const lows = await collectValues(bars, (ctx) => ta.min(ctx.close).value);

    expect(highs).toEqual([3, 3, 4, 4, 5]);
    expect(lows).toEqual([3, 1, 1, 1, 1]);
  });

  it("detects crosses as crossover or crossunder", async () => {
    const bars = closesToBars([1, 2, 1, 2, 1], [1.5, 1.5, 1.5, 1.5, 1.5]);
    const values: boolean[] = [];
    await runOver(bars, (ctx) => {
      values.push(ta.cross(ctx.close, ctx.volume).value);
    });

    // bar 0 has no close[1]/volume[1] history; every later bar crosses 1.5.
    expect(values).toEqual([false, true, true, true, true]);
  });

  it("calculates ALMA from the reference Gaussian weights", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      (ctx) => ta.alma(ctx.close, 9, 0.85, 6).value,
    );

    expect(values.slice(0, 8).every(Number.isNaN)).toBe(true);
    expect(values[8]).toBeCloseTo(7.442_764_782_3, 9);
  });

  it("floors the ALMA offset center when floor is true", async () => {
    const bars = closesToBars([1, 2, 3, 4, 5]);
    const plain = await collectValues(bars, (ctx) => ta.alma(ctx.close, 5, 0.4, 3).value);
    const floored = await collectValues(bars, (ctx) => ta.alma(ctx.close, 5, 0.4, 3, true).value);

    // 0.4 * (5 - 1) = 1.6 floors to 1, shifting the weight center.
    expect(plain[4]).toBeCloseTo(2.781_225_824_6, 9);
    expect(floored[4]).toBeCloseTo(2.467_097_233_1, 9);
    expect(plain[4]).not.toBeCloseTo(floored[4] as number, 9);
  });

  it("rejects invalid ALMA parameters", () => {
    expect(() => ta.alma({} as never, 0, 0.85, 6)).toThrow(RangeError);
    expect(() => ta.alma({} as never, 9, Number.NaN, 6)).toThrow(RangeError);
    expect(() => ta.alma({} as never, 9, 0.85, Number.NaN)).toThrow(RangeError);
  });

  it("calculates the rolling median, mode, and range", async () => {
    const bars = closesToBars([5, 2, 8, 4, 7]);
    const medians = await collectValues(bars, (ctx) => ta.median(ctx.close, 4).value);
    const ranges = await collectValues(bars, (ctx) => ta.range(ctx.close, 4).value);

    expect(medians.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(medians[3]).toBeCloseTo(4.5);
    expect(medians[4]).toBeCloseTo(5.5);
    expect(ranges.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(ranges[3]).toBe(6);
    expect(ranges[4]).toBe(6);
  });

  it("resolves mode ties toward the smallest value", async () => {
    const values = await collectValues(
      closesToBars([3, 1, 1, 3, 2]),
      (ctx) => ta.mode(ctx.close, 4).value,
    );

    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    // window [3, 1, 1, 3]: 3 and 1 both occur twice, the smallest wins.
    expect(values[3]).toBe(1);
    // window [1, 1, 3, 2]: 1 occurs twice.
    expect(values[4]).toBe(1);
  });

  it("calculates percentiles with the nearest-rank method", async () => {
    const values = await collectValues(
      closesToBars([10, 20, 30, 40, 50]),
      (ctx) => ta.percentileNearestRank(ctx.close, 5, 50).value,
    );

    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    // ceil(0.5 * 5) = rank 3 -> the third smallest value.
    expect(values[4]).toBe(30);
  });

  it("defines the 100th nearest-rank percentile as the largest value", async () => {
    const values = await collectValues(
      closesToBars([10, 20, 30, 40, 50]),
      (ctx) => ta.percentileNearestRank(ctx.close, 5, 100).value,
    );

    expect(values[4]).toBe(50);
  });

  it("interpolates percentiles linearly between nearest ranks", async () => {
    const values = await collectValues(
      closesToBars([10, 20, 30, 40, 50]),
      (ctx) => ta.percentileLinearInterpolation(ctx.close, 5, 30).value,
    );

    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    // position 0.3 * 4 = 1.2 -> 20 * 0.8 + 30 * 0.2.
    expect(values[4]).toBeCloseTo(22);
  });

  it("ranks the current value against the strict window", async () => {
    const values = await collectValues(
      closesToBars([10, 20, 30, 25]),
      (ctx) => ta.percentrank(ctx.close, 3).value,
    );

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(100);
    // window [20, 30, 25]: 20 and 25 are <= 25.
    expect(values[3]).toBeCloseTo(200 / 3, 9);
  });

  it("computes the Pearson correlation over aligned pairs", async () => {
    const bars = closesToBars([1, 2, 3, 4, 5, 4, 3], [2, 4, 6, 8, 10, 8, 6]);
    const values = await collectValues(
      bars,
      (ctx) => ta.correlation(ctx.close, ctx.volume, 4).value,
    );

    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    for (const value of values.slice(3)) expect(value).toBeCloseTo(1, 9);
  });

  it("returns na correlation for a zero-variance operand", async () => {
    const bars = closesToBars([1, 2, 3, 4], [5, 5, 5, 5]);
    const values = await collectValues(
      bars,
      (ctx) => ta.correlation(ctx.close, ctx.volume, 3).value,
    );

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values.slice(2).every(Number.isNaN)).toBe(true);
  });

  it("computes RCI between +100 and -100 for monotonic runs", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 4, 5, 3, 2]),
      (ctx) => ta.rci(ctx.close, 5).value,
    );

    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(values[4]).toBeCloseTo(100, 9);
    expect(values[5]).toBeCloseTo(57.5, 9);
    expect(values[6]).toBeCloseTo(-42.5, 9);
  });

  it("computes CCI against the SMA and mean deviation", async () => {
    const values = await collectValues(
      closesToBars([10, 12, 14, 16, 18, 14]),
      (ctx) => ta.cci(ctx.close, 3).value,
    );

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    // linear ramps read exactly 100 and the reversal reads -100.
    expect(values[2]).toBeCloseTo(100, 9);
    expect(values[3]).toBeCloseTo(100, 9);
    expect(values[4]).toBeCloseTo(100, 9);
    expect(values[5]).toBeCloseTo(-100, 9);
  });

  it("returns na CCI for a constant source", async () => {
    const values = await collectValues(
      closesToBars([7, 7, 7, 7]),
      (ctx) => ta.cci(ctx.close, 3).value,
    );

    expect(values.slice(2).every(Number.isNaN)).toBe(true);
  });

  it("computes the center of gravity per the reference weights", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 4, 5]),
      (ctx) => ta.cog(ctx.close, 3).value,
    );

    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    // window [3, 2, 1]: -(3*1 + 2*2 + 1*3) / (3 + 2 + 1).
    expect(values[2]).toBeCloseTo(-5 / 3, 9);
    expect(values[3]).toBeCloseTo(-16 / 9, 9);
    expect(values[4]).toBeCloseTo(-11 / 6, 9);
  });

  it("computes TSI in the [-1, 1] range without a 100 scale factor", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 2, 4, 5, 3, 2, 4, 6]),
      (ctx) => ta.tsi(ctx.close, 3, 5).value,
    );

    expect(Number.isNaN(values[0])).toBe(true);
    expect(values[1]).toBeCloseTo(1, 9);
    expect(values[3]).toBeCloseTo(2 / 3, 9);
    expect(values[6]).toBeCloseTo(0.299_884_659_7, 9);
    expect(values[9]).toBeCloseTo(0.372_479_078_7, 9);
    expect(values.slice(1).every((value) => value >= -1 && value <= 1)).toBe(true);
  });

  it("computes the intraday intensity index per bar", async () => {
    const values = await collectValues(ohlcvBars, () => ta.iii().value);

    expect(values[0]).toBeCloseTo(50);
    expect(values[1]).toBeCloseTo(-200);
    // bar 2 has a zero high-low range, which divides to na.
    expect(Number.isNaN(values[2])).toBe(true);
    expect(values[3]).toBeCloseTo(75);
  });

  it("computes the Williams variable A/D per bar", async () => {
    const values = await collectValues(ohlcvBars, () => ta.wvad().value);

    expect(values[0]).toBeCloseTo(50);
    expect(values[1]).toBeCloseTo(-100);
    expect(Number.isNaN(values[2])).toBe(true);
    expect(values[3]).toBeCloseTo(75);
  });

  it("accumulates the Williams A/D line", async () => {
    const values = await collectValues(ohlcvBars, () => ta.wad().value);

    // bar 0: na change contributes nothing; bar 1: down move, close - max(high, close[1]);
    // bar 2: unchanged close contributes 0; bar 3: up move, close - min(low, close[1]).
    expect(values).toEqual([0, -4, -3, 0]);
  });

  it("preserves structural identity for the new nodes", async () => {
    const identities: unknown[] = [];
    await runOver(closesToBars([1, 2, 3, 4]), (ctx) => {
      identities.push(ta.cum(ctx.close));
      identities.push(ta.cum(ctx.close));
      identities.push(ta.alma(ctx.close, 3, 0.85, 6));
      identities.push(ta.alma(ctx.close, 3, 0.85, 6));
      identities.push(ta.alma(ctx.close, 3, 0.85, 6, true));
      identities.push(ta.tsi(ctx.close, 3, 5));
      identities.push(ta.tsi(ctx.close, 3, 5));
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).toBe(identities[3]);
    expect(identities[2]).not.toBe(identities[4]);
    expect(identities[5]).toBe(identities[6]);
  });
});
