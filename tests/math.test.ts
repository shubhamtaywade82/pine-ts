import { describe, expect, it } from "vitest";
import { PineRuntime, isNa, na } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";
import * as math from "../src/math/index.js";

const testSymbolInfo: SymbolInfo = {
  ticker: "BTCUSDT",
  minTick: 0.01,
  timezone: "UTC",
};

class MockProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => testSymbolInfo;
}

const numbersToBars = (values: readonly number[]): readonly Bar[] =>
  values.map((v, i) => ({
    time: (i + 1) * 60_000,
    open: v,
    high: v,
    low: v,
    close: v,
    volume: 100,
    isClosed: true,
  }));

const runScript = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new MockProvider(bars),
    symbol: "BTCUSDT",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("math namespace constants", () => {
  it("exposes standard mathematical constants", () => {
    expect(math.e).toBeCloseTo(Math.E, 10);
    expect(math.pi).toBeCloseTo(Math.PI, 10);
    expect(math.phi).toBeCloseTo(1.618033988749895, 10);
    expect(math.rphi).toBeCloseTo(0.618033988749895, 10);
    expect(math.phi - 1).toBeCloseTo(math.rphi, 10);
  });
});

describe("math scalar functions with Pine na semantics", () => {
  it("handles basic arithmetic: abs, sign", () => {
    expect(math.abs(-10)).toBe(10);
    expect(math.abs(10)).toBe(10);
    expect(isNa(math.abs(na))).toBe(true);

    expect(math.sign(42)).toBe(1);
    expect(math.sign(-42)).toBe(-1);
    expect(math.sign(0)).toBe(0);
    expect(isNa(math.sign(na))).toBe(true);
  });

  it("handles rounding: ceil, floor, round, round_to_mintick", () => {
    expect(math.ceil(4.1)).toBe(5);
    expect(math.ceil(-4.9)).toBe(-4);
    expect(isNa(math.ceil(na))).toBe(true);

    expect(math.floor(4.9)).toBe(4);
    expect(math.floor(-4.1)).toBe(-5);
    expect(isNa(math.floor(na))).toBe(true);

    expect(math.round(4.5)).toBe(5);
    expect(math.round(4.4)).toBe(4);
    expect(math.round(3.14159, 2)).toBeCloseTo(3.14, 5);
    expect(math.round(3.14159, 4)).toBeCloseTo(3.1416, 5);
    expect(isNa(math.round(na))).toBe(true);

    expect(math.round_to_mintick(100.126, 0.01)).toBeCloseTo(100.13, 5);
    expect(math.round_to_mintick(100.124, 0.05)).toBeCloseTo(100.1, 5);
    expect(math.round_to_mintick(100.13, 0.05)).toBeCloseTo(100.15, 5);
    expect(isNa(math.round_to_mintick(na, 0.01))).toBe(true);
  });

  it("handles powers and roots: pow, sqrt, exp, log, log10", () => {
    expect(math.pow(2, 3)).toBe(8);
    expect(isNa(math.pow(na, 2))).toBe(true);
    expect(isNa(math.pow(2, na))).toBe(true);

    expect(math.sqrt(16)).toBe(4);
    expect(isNa(math.sqrt(-1))).toBe(true);
    expect(isNa(math.sqrt(na))).toBe(true);

    expect(math.exp(0)).toBe(1);
    expect(math.exp(1)).toBeCloseTo(math.e, 10);
    expect(isNa(math.exp(na))).toBe(true);

    expect(math.log(math.e)).toBeCloseTo(1, 10);
    expect(isNa(math.log(0))).toBe(true);
    expect(isNa(math.log(-10))).toBe(true);
    expect(isNa(math.log(na))).toBe(true);

    expect(math.log10(100)).toBeCloseTo(2, 10);
    expect(isNa(math.log10(0))).toBe(true);
    expect(isNa(math.log10(-10))).toBe(true);
    expect(isNa(math.log10(na))).toBe(true);
  });

  it("handles trigonometry: sin, cos, tan, asin, acos, atan, todegrees, toradians", () => {
    expect(math.sin(0)).toBe(0);
    expect(math.cos(0)).toBe(1);
    expect(math.tan(0)).toBe(0);
    expect(isNa(math.sin(na))).toBe(true);
    expect(isNa(math.cos(na))).toBe(true);
    expect(isNa(math.tan(na))).toBe(true);

    expect(math.asin(0)).toBe(0);
    expect(isNa(math.asin(1.5))).toBe(true);
    expect(isNa(math.asin(-1.5))).toBe(true);

    expect(math.acos(1)).toBe(0);
    expect(isNa(math.acos(1.5))).toBe(true);
    expect(isNa(math.acos(-1.5))).toBe(true);

    expect(math.atan(0)).toBe(0);
    expect(isNa(math.atan(na))).toBe(true);

    expect(math.todegrees(math.pi)).toBeCloseTo(180, 10);
    expect(math.toradians(180)).toBeCloseTo(math.pi, 10);
  });

  it("handles variadic aggregations: min, max, avg", () => {
    expect(math.min(5, 2, 8, 1)).toBe(1);
    expect(math.max(5, 2, 8, 1)).toBe(8);
    expect(math.avg(10, 20, 30)).toBe(20);

    expect(isNa(math.min(5, na, 1))).toBe(true);
    expect(isNa(math.max(5, na, 1))).toBe(true);
    expect(isNa(math.avg(10, na, 30))).toBe(true);
  });

  it("handles random with and without seed", () => {
    const val = math.random(5, 10);
    expect(val).toBeGreaterThanOrEqual(5);
    expect(val).toBeLessThanOrEqual(10);

    const seeded1 = math.random(0, 100, 42);
    const seeded2 = math.random(0, 100, 42);
    expect(seeded1).toBe(seeded2);
  });
});

describe("math series integration", () => {
  it("evaluates unary math functions over FloatSeries", async () => {
    const recordedAbs: number[] = [];
    const recordedSqrt: number[] = [];
    const bars = numbersToBars([-4, 9, -16, 25]);

    await runScript(bars, (ctx) => {
      const absClose = math.abs(ctx.close);
      const sqrtClose = math.sqrt(absClose);
      recordedAbs.push(absClose.value);
      recordedSqrt.push(sqrtClose.value);
    });

    expect(recordedAbs).toEqual([4, 9, 16, 25]);
    expect(recordedSqrt).toEqual([2, 3, 4, 5]);
  });

  it("evaluates binary math functions over Series", async () => {
    const recordedPow: number[] = [];
    const bars = numbersToBars([1, 2, 3, 4]);

    await runScript(bars, (ctx) => {
      const squared = math.pow(ctx.close, 2);
      recordedPow.push(squared.value);
    });

    expect(recordedPow).toEqual([1, 4, 9, 16]);
  });

  it("computes math.sum rolling window with non-na accumulation", async () => {
    const recordedSum: number[] = [];
    const bars = numbersToBars([10, 20, 30, 40, 50]);

    await runScript(bars, (ctx) => {
      const sum3 = math.sum(ctx.close, 3);
      recordedSum.push(sum3.value);
    });

    expect(isNa(recordedSum[0]!)).toBe(true);
    expect(isNa(recordedSum[1]!)).toBe(true);
    expect(recordedSum[2]).toBe(60);
    expect(recordedSum[3]).toBe(90);
    expect(recordedSum[4]).toBe(120);
  });
});
