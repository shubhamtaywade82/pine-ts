import { describe, expect, it } from "vitest";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";
import * as array from "../src/array/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  minTick: 0.01,
  timezone: "UTC",
};

class TestProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const runWithBars = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new TestProvider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("array creation and basic operations", () => {
  it("creates typed arrays with optional size and default values", () => {
    const floatArr = array.new_float(3, 10.5);
    expect(array.size(floatArr)).toBe(3);
    expect(array.get(floatArr, 0)).toBeCloseTo(10.5, 5);
    expect(array.get(floatArr, 1)).toBeCloseTo(10.5, 5);
    expect(array.get(floatArr, 2)).toBeCloseTo(10.5, 5);

    const intArr = array.new_int(2, 42);
    expect(array.size(intArr)).toBe(2);
    expect(array.get(intArr, 0)).toBe(42);

    const boolArr = array.new_bool(2, true);
    expect(array.get(boolArr, 0)).toBe(true);

    const strArr = array.new_string(1, "hello");
    expect(array.get(strArr, 0)).toBe("hello");

    const fromArr = array.from(1, 2, 3, 4);
    expect(array.size(fromArr)).toBe(4);
    expect(array.first(fromArr)).toBe(1);
    expect(array.last(fromArr)).toBe(4);
  });

  it("supports mutation operations: push, pop, shift, unshift, insert, remove, set", () => {
    const arr = array.new_float();
    array.push(arr, 10);
    array.push(arr, 20);
    array.unshift(arr, 5); // [5, 10, 20]
    expect(array.size(arr)).toBe(3);
    expect(array.get(arr, 0)).toBe(5);

    expect(array.pop(arr)).toBe(20); // [5, 10]
    expect(array.shift(arr)).toBe(5); // [10]
    expect(array.size(arr)).toBe(1);

    array.insert(arr, 0, 1); // [1, 10]
    array.set(arr, 1, 99); // [1, 99]
    expect(array.get(arr, 1)).toBe(99);

    const removed = array.remove(arr, 0); // [99]
    expect(removed).toBe(1);
    expect(array.size(arr)).toBe(1);
  });

  it("supports slice, concat, copy, fill, clear", () => {
    const arr = array.from(1, 2, 3, 4, 5);
    const sliced = array.slice(arr, 1, 4); // [2, 3, 4]
    expect(array.size(sliced)).toBe(3);
    expect(array.get(sliced, 0)).toBe(2);

    const cloned = array.copy(arr);
    expect(array.size(cloned)).toBe(5);
    array.clear(cloned);
    expect(array.size(cloned)).toBe(0);

    const merged = array.concat(arr, array.from(6, 7));
    expect(array.size(merged)).toBe(7);
    expect(array.last(merged)).toBe(7);

    array.fill(arr, 0, 1, 3); // arr becomes [1, 0, 0, 4, 5]
    expect(array.get(arr, 1)).toBe(0);
    expect(array.get(arr, 2)).toBe(0);
    expect(array.get(arr, 3)).toBe(4);
  });
});

describe("array search, sorting, and predicates", () => {
  it("searches elements: includes, indexof, lastindexof, binary_search", () => {
    const arr = array.from(10, 20, 30, 20, 40);
    expect(array.includes(arr, 20)).toBe(true);
    expect(array.includes(arr, 99)).toBe(false);
    expect(array.indexof(arr, 20)).toBe(1);
    expect(array.lastindexof(arr, 20)).toBe(3);

    const sorted = array.from(10, 20, 20, 20, 30, 40);
    expect(array.binary_search(sorted, 30)).toBe(4);
    expect(array.binary_search_leftmost(sorted, 20)).toBe(1);
    expect(array.binary_search_rightmost(sorted, 20)).toBe(3);
  });

  it("sorts and reverses arrays and computes sort_indices", () => {
    const arr = array.from(30, 10, 50, 20);
    const sortedIndicesAsc = array.sort_indices(arr);
    expect(array.get(sortedIndicesAsc, 0)).toBe(1); // 10 is at index 1
    expect(array.get(sortedIndicesAsc, 3)).toBe(2); // 50 is at index 2

    const sortedIndicesDesc = array.sort_indices(arr, "desc");
    expect(array.get(sortedIndicesDesc, 0)).toBe(2); // 50
    expect(array.get(sortedIndicesDesc, 3)).toBe(1); // 10

    array.sort(arr);
    expect(array.get(arr, 0)).toBe(10);
    expect(array.get(arr, 3)).toBe(50);

    array.sort(arr, "desc");
    expect(array.get(arr, 0)).toBe(50);
    expect(array.get(arr, 3)).toBe(10);

    array.reverse(arr);
    expect(array.get(arr, 0)).toBe(10);
  });

  it("handles binary search edge cases when element is outside range", () => {
    const sorted = array.from(10, 20, 30);
    expect(array.binary_search(sorted, 15)).toBe(-1);
    expect(array.binary_search_leftmost(sorted, 5)).toBe(-1);
    expect(array.binary_search_leftmost(sorted, 15)).toBe(0);
    expect(array.binary_search_rightmost(sorted, 35)).toBe(-1);
    expect(array.binary_search_rightmost(sorted, 25)).toBe(2);
  });

  it("evaluates every, some, join", () => {
    const bools = array.from(true, true, false);
    expect(array.every(bools)).toBe(false);
    expect(array.some(bools)).toBe(true);

    const strArr = array.from("A", "B", "C");
    expect(array.join(strArr, "-")).toBe("A-B-C");
  });
});

describe("array math and statistics", () => {
  it("calculates basic math: min, max, range, sum, avg, abs", () => {
    const arr = array.from(10, -20, 30, -5);
    expect(array.min(arr)).toBe(-20);
    expect(array.max(arr)).toBe(30);
    expect(array.range(arr)).toBe(50);
    expect(array.sum(arr)).toBe(15);
    expect(array.avg(arr)).toBeCloseTo(3.75, 4);

    const absArr = array.abs(arr);
    expect(array.get(absArr, 1)).toBe(20);
    expect(array.get(absArr, 3)).toBe(5);
    expect(array.get(arr, 1)).toBe(-20);
  });

  it("calculates advanced statistics: variance, stdev, median, mode, standardize", () => {
    const arr = array.from(2, 4, 4, 4, 5, 5, 7, 9);
    // mean = 5, biased variance = 4, stdev = 2
    expect(array.variance(arr, true)).toBeCloseTo(4, 4);
    expect(array.stdev(arr, true)).toBeCloseTo(2, 4);
    expect(array.median(arr)).toBeCloseTo(4.5, 4);
    expect(array.mode(arr)).toBe(4);

    // Pine Script mode tie-break: returns smallest value among tied elements
    const tied = array.from(20, 10, 20, 10, 30);
    expect(array.mode(tied)).toBe(10);

    const standardized = array.standardize(arr);
    expect(array.get(standardized, 0)).toBeCloseTo(-1.5, 4); // (2 - 5) / 2 = -1.5
  });

  it("handles out of bounds and empty array exceptions gracefully", () => {
    const empty = array.new_float();
    expect(Number.isNaN(array.min(empty))).toBe(true);
    expect(Number.isNaN(array.avg(empty))).toBe(true);
    expect(Number.isNaN(array.median(empty))).toBe(true);
    expect(() => array.get(empty, 0)).toThrow(RangeError);
    expect(() => array.pop(empty)).toThrow(RangeError);
    expect(() => array.shift(empty)).toThrow(RangeError);
  });

  it("calculates percentiles and covariance", () => {
    const arr = array.from(15, 20, 35, 40, 50);
    expect(array.percentrank(arr, 0)).toBe(0);
    expect(array.percentrank(arr, 4)).toBe(100);

    expect(array.percentile_nearest_rank(arr, 50)).toBe(35);
    expect(array.percentile_linear_interpolation(arr, 50)).toBe(35);

    const x = array.from(1, 2, 3, 4);
    const y = array.from(2, 4, 6, 8);
    expect(array.covariance(x, y, true)).toBeCloseTo(2.5, 4);
  });
});

describe("array realtime rollback integration", () => {
  it("rolls back intrabar var array mutations on revised realtime ticks", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 12, high: 12, low: 12, close: 12, volume: 100, isClosed: false },
    ];

    let lastSize = 0;
    await runWithBars(bars, (ctx) => {
      const arr = ctx.state.var("tracked", () => array.new_float());
      array.push(arr.value, ctx.close.value);
      lastSize = array.size(arr.value);
    });

    expect(lastSize).toBe(2);
  });
});
