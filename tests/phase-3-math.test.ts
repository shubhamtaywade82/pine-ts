import { describe, expect, it } from "vitest";
import { PineRuntime, createSeries, math } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto", minTick: 0.25 };

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

const collectValues = async (
  bars: readonly Bar[],
  read: (ctx: Parameters<PineScript>[0]) => number,
): Promise<number[]> => {
  const values: number[] = [];
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((ctx) => {
    values.push(read(ctx));
  }, bars);
  return values;
};

describe("Phase 3 — math scalar surface", () => {
  it("computes absolute values and propagates na", () => {
    expect(math.abs(42)).toBe(42);
    expect(math.abs(-3.5)).toBe(3.5);
    expect(math.abs(Number.NaN)).toBeNaN();
  });

  it("rounds with ties up, at any precision", () => {
    expect(math.round(2.5)).toBe(3);
    expect(math.round(-2.5)).toBe(-2);
    // 1.005 is 1.00499999... as a double: the 10^2 scaling rounds it back to
    // 1.00 — the same IEEE-754 arithmetic TradingView's Java runtime performs.
    expect(math.round(1.005, 2)).toBe(1);
    expect(math.round(2.675, 2)).toBeCloseTo(2.68, 10);
    expect(math.round(1234, -2)).toBe(1200);
    expect(math.round(Number.NaN)).toBeNaN();
    expect(() => math.round(1, 1.5)).toThrow(RangeError);
  });

  it("converts between degrees and radians", () => {
    expect(math.todegrees(Math.PI)).toBeCloseTo(180, 12);
    expect(math.toradians(180)).toBeCloseTo(Math.PI, 12);
    expect(math.todegrees(0)).toBe(0);
  });

  it("returns na for domain violations, infinities flow through", () => {
    // IEEE-754 domain errors are NaN (Pine na); log(0) is the documented
    // -Infinity double, which TV also renders rather than na.
    expect(math.sqrt(-1)).toBeNaN();
    expect(math.log(-1)).toBeNaN();
    expect(math.log(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(math.log10(-5)).toBeNaN();
    expect(math.acos(2)).toBeNaN();
    expect(math.asin(-2)).toBeNaN();
  });

  it("computes ceil, floor, sign, and pow", () => {
    expect(math.ceil(2.1)).toBe(3);
    expect(math.ceil(-2.1)).toBe(-2);
    expect(math.floor(2.9)).toBe(2);
    expect(math.floor(-2.9)).toBe(-3);
    expect(math.sign(-3)).toBe(-1);
    expect(math.sign(0)).toBe(0);
    expect(math.sign(4.2)).toBe(1);
    expect(math.pow(2, 10)).toBe(1024);
    expect(math.pow(9, 0.5)).toBe(3);
  });

  it("aggregates variadic scalars", () => {
    expect(math.avg(1, 2, 3)).toBe(2);
    expect(math.max(3, 1, 2)).toBe(3);
    expect(math.min(3, 1, 2)).toBe(1);
    // na propagates through the variadic aggregates.
    expect(math.max(1, Number.NaN)).toBeNaN();
    expect(math.min(Number.NaN, 1)).toBeNaN();
    expect(math.avg(1, Number.NaN, 3)).toBeNaN();
    expect(() => math.max(1)).toThrow(RangeError);
    expect(() => math.min()).toThrow(RangeError);
    expect(() => math.avg(4)).toThrow(RangeError);
  });

  it("rounds scalars to an explicit mintick with ties up", () => {
    expect(math.roundToMintick(1.13, 0.25)).toBe(1.25);
    // 1.11 is nearer 1.00 (0.11) than 1.25 (0.14).
    expect(math.roundToMintick(1.11, 0.25)).toBe(1);
    expect(math.roundToMintick(1.125, 0.25)).toBe(1.25);
    expect(math.roundToMintick(-1.13, 0.25)).toBe(-1.25);
    expect(math.roundToMintick(Number.NaN, 0.25)).toBeNaN();
    expect(() => math.roundToMintick(1, 0)).toThrow(RangeError);
    expect(() => math.roundToMintick(1, -0.25)).toThrow(RangeError);
  });
});

describe("Phase 3 — math seeded random", () => {
  it("produces repeatable sequences across script executions", async () => {
    const runSeeded = async (): Promise<number[]> => {
      const values: number[] = [];
      const bars = closesToBars([1, 2, 3, 4]);
      const runtime = new PineRuntime({
        provider: new Provider(bars),
        symbol: "TEST",
        timeframe: "1m",
      });
      await runtime.run(() => {
        values.push(math.random(0, 1, 42));
      }, bars);
      return values;
    };
    const first = await runSeeded();
    const second = await runSeeded();
    expect(first).toEqual(second);
    // The sequence advances across the four bars of one execution.
    expect(new Set(first).size).toBe(first.length);
  });

  it("keeps both bounds excluded from the range", () => {
    for (let index = 0; index < 500; index += 1) {
      const value = math.random(-1, 1, index);
      expect(value).toBeGreaterThan(-1);
      expect(value).toBeLessThan(1);
    }
  });

  it("rescales to arbitrary ranges", () => {
    for (let index = 0; index < 100; index += 1) {
      const value = math.random(10, 20, 1000 + index);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it("advances the sequence on successive calls with one seed", () => {
    const a = math.random(0, 100, 7);
    const b = math.random(0, 100, 7);
    expect(a).not.toBe(b);
  });
});

describe("Phase 3 — math series surface", () => {
  it("applies pointwise functions elementwise over a series", async () => {
    const values = await collectValues(
      closesToBars([-4, 9, -16]),
      (ctx) => math.abs(ctx.close).value,
    );
    expect(values).toEqual([4, 9, 16]);
  });

  it("memoizes the derived series per node key", async () => {
    let first: unknown;
    let second: unknown;
    await collectValues(closesToBars([1, 2]), (ctx) => {
      first ??= math.abs(ctx.close);
      second = math.abs(ctx.close);
      return first as number;
    });
    expect(second).toBe(first);
  });

  it("supports precision rounding on series", async () => {
    const values = await collectValues(
      closesToBars([1.234, 2.345, 3.456]),
      (ctx) => math.round(ctx.close, 2).value,
    );
    expect(values).toEqual([1.23, 2.35, 3.46]);
  });

  it("combines series and scalar operands elementwise", async () => {
    const bars = closesToBars([1, 2, 3], [5, 1, 4]);
    const maxima = await collectValues(bars, (ctx) => math.max(ctx.close, 2).value);
    const averages = await collectValues(bars, (ctx) => math.avg(ctx.close, ctx.volume, 0).value);
    expect(maxima).toEqual([2, 2, 3]);
    expect(averages).toEqual([2, 1, 7 / 3]);
  });

  it("propagates na operands in variadic series aggregates", async () => {
    const bars = closesToBars([1, 2, 3, 4]);
    const values = await collectValues(bars, (ctx) => {
      const noisy = ctx.series("noisy", () =>
        ctx.close.value % 2 === 0 ? Number.NaN : ctx.close.value,
      );
      return math.max(noisy, ctx.close).value;
    });
    expect(values).toEqual([1, Number.NaN, 3, Number.NaN]);
  });

  it("computes the sliding sum over non-na values", async () => {
    const values = await collectValues(
      closesToBars([1, 2, 3, 4]),
      (ctx) => math.sum(ctx.close, 3).value,
    );
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBe(6);
    expect(values[3]).toBe(9);
    expect(() => math.sum({} as never, 0)).toThrow(RangeError);
  });

  it("skips na values inside the sum window", async () => {
    const bars = closesToBars([1, 2, 3, 4]);
    const values = await collectValues(bars, (ctx) => {
      const gappy = ctx.series("gappy", () =>
        ctx.close.value === 2 ? Number.NaN : ctx.close.value,
      );
      return math.sum(gappy, 2).value;
    });
    // bar 0: only one non-na value exists -> na (warm-up)
    // bar 1: current value is na -> na
    // bar 2: last two non-na values are 3 and 1 -> 4
    // bar 3: 4 + 3 -> 7
    expect(values[0]).toBeNaN();
    expect(values[1]).toBeNaN();
    expect(values[2]).toBe(4);
    expect(values[3]).toBe(7);
  });

  it("rounds series values to the session mintick", async () => {
    const values = await collectValues(
      closesToBars([1.13, 1.11, -1.13]),
      (ctx) => math.roundToMintick(ctx.close).value,
    );
    expect(values).toEqual([1.25, 1, -1.25]);
  });

  it("rejects series operands without a session", () => {
    const standalone = createSeries<number>([1, 2, 3]);
    expect(() => math.abs(standalone)).toThrow(/PineSession-owned/);
    expect(() => math.sum(standalone, 2)).toThrow(/PineSession-owned/);
    expect(() => math.roundToMintick(standalone)).toThrow(/PineSession-owned/);
  });
});
