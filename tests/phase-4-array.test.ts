import { describe, expect, it } from "vitest";
import { array, order, PineRuntime, str, ta } from "../src/index.js";
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

const makeBars = (count: number): Bar[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index + 1,
    open: 10 + index,
    high: 12 + index,
    low: 8 + index,
    close: 11 + index,
    volume: 100 + index,
    isClosed: true,
  }));

describe("Phase 4 — array constructors", () => {
  it("creates typed arrays with na elements and validates sizes", () => {
    const floats = array.newFloat(3);
    expect(array.size(floats)).toBe(3);
    expect(array.get(floats, 0)).toBeNaN();
    expect(array.get(floats, 2)).toBeNaN();

    const seeded = array.newFloat(2, 1.5);
    expect(array.get(seeded, 0)).toBe(1.5);

    const bools = array.newBool(2);
    expect(array.get(bools, 0)).toBeUndefined();
    expect(array.get(bools, 1)).toBeUndefined();

    const strings = array.newString(2, "x");
    expect(array.join(strings, "|")).toBe("x|x");

    const colors = array.newColor(1, "#FF0000");
    expect(array.get(colors, 0)).toBe("#FF0000");

    const generic = array.newArray<boolean>(2);
    expect(array.size(generic)).toBe(2);
    expect(array.get(generic, 0)).toBeUndefined();

    expect(() => array.newFloat(-1)).toThrow("Cannot create an array with a negative size");
    expect(() => array.newFloat(100_001)).toThrow("Array is too large. Maximum size is 100000");
  });

  it("builds arrays from arguments and copies independently", () => {
    const source = array.from(3, 1, 2);
    expect(array.size(source)).toBe(3);
    const duplicate = array.copy(source);
    array.set(duplicate, 0, 99);
    expect(array.get(source, 0)).toBe(3);
    expect(array.get(duplicate, 0)).toBe(99);
    expect(array.sort_indices(duplicate, order.ascending).toArray()).toEqual([1, 2, 0]);
  });

  it("concat mutates and returns the first array", () => {
    const a = array.from(1, 2);
    const b = array.from(3, 4);
    const merged = array.concat(a, b);
    expect(merged).toBe(a);
    expect(array.size(a)).toBe(4);
    expect(array.size(b)).toBe(2);
    expect(array.join(a, ",")).toBe("1,2,3,4");
  });

  it("enforces the size limit on growth", () => {
    const big = array.newFloat(100_000);
    expect(() => array.push(big, 1)).toThrow("Array is too large. Maximum size is 100000");
  });
});

describe("Phase 4 — element access and mutation", () => {
  it("resolves negative indices from the end (v6 remark)", () => {
    const a = array.from(10, 20, 30);
    expect(array.get(a, -1)).toBe(30);
    expect(array.get(a, -3)).toBe(10);
    expect(() => array.get(a, -4)).toThrow("Index -4 is out of bounds. Array size is 3");
    expect(() => array.get(a, 3)).toThrow("Index 3 is out of bounds. Array size is 3");
  });

  it("push, pop, shift, unshift, insert, remove round-trip", () => {
    const a = array.newFloat(0);
    array.push(a, 1);
    array.unshift(a, 0);
    array.insert(a, 1, 0.5);
    expect(array.join(a, ",")).toBe("0,0.5,1");
    expect(array.pop(a)).toBe(1);
    expect(array.shift(a)).toBe(0);
    expect(array.remove(a, 0)).toBe(0.5);
    expect(array.size(a)).toBe(0);
    expect(() => array.pop(a)).toThrow("Cannot use pop() if array is empty.");
    expect(() => array.shift(a)).toThrow("Cannot use shift() if array is empty.");
  });

  it("first and last throw on empty arrays", () => {
    const a = array.newFloat(0);
    expect(() => array.first(a)).toThrow("Cannot use first() if array is empty.");
    expect(() => array.last(a)).toThrow("Cannot use last() if array is empty.");
    array.push(a, 7);
    expect(array.first(a)).toBe(7);
    expect(array.last(a)).toBe(7);
  });

  it("fill honors the exclusive index_to and the na default", () => {
    const a = array.newFloat(5, 0);
    array.fill(a, 9, 1, 3);
    expect(array.join(a, ",")).toBe("0,9,9,0,0");
    array.fill(a, 4);
    expect(array.join(a, ",")).toBe("4,4,4,4,4");
    array.fill(a, 2, 3);
    expect(array.join(a, ",")).toBe("4,4,4,2,2");
    expect(() => array.fill(a, 1, 4, 2)).toThrow();
  });

  it("reverse and clear", () => {
    const a = array.from(1, 2, 3);
    array.reverse(a);
    expect(array.join(a, ",")).toBe("3,2,1");
    array.clear(a);
    expect(array.size(a)).toBe(0);
  });
});

describe("Phase 4 — slices (write-through views)", () => {
  it("writes through to the parent and vice versa", () => {
    const parent = array.from(1, 2, 3, 4, 5);
    const view = array.slice(parent, 1, 4);
    expect(array.size(view)).toBe(3);
    array.set(view, 0, 99);
    expect(array.get(parent, 1)).toBe(99);
    array.set(parent, 3, 77);
    expect(array.get(view, 2)).toBe(77);
  });

  it("insert and remove through a slice land in the parent", () => {
    const parent = array.from(1, 2, 3, 4, 5);
    const view = array.slice(parent, 1, 4);
    array.push(view, 8);
    expect(array.join(parent, ",")).toBe("1,2,3,4,8,5");
    expect(array.size(parent)).toBe(6);
    const removed = array.remove(view, 0);
    expect(removed).toBe(2);
    expect(array.join(parent, ",")).toBe("1,3,4,8,5");
  });

  it("validates slice bounds and reports parent shrink", () => {
    const parent = array.from(1, 2, 3, 4, 5);
    expect(() => array.slice(parent, 3, 3)).toThrow("Index 'from' should be less than index 'to'");
    expect(() => array.slice(parent, 0, 6)).toThrow();
    const view = array.slice(parent, 3, 5);
    array.remove(parent, 0);
    expect(() => array.size(view)).toThrow("Slice is out of bounds of the parent array");
    expect(() => array.get(view, 0)).toThrow("Slice is out of bounds of the parent array");
  });
});

describe("Phase 4 — queries and predicates", () => {
  it("includes, indexof, lastindexof with na elements", () => {
    const a = array.from(1, Number.NaN, 3, 1);
    expect(array.includes(a, 3)).toBe(true);
    expect(array.includes(a, 2)).toBe(false);
    expect(array.indexof(a, 1)).toBe(0);
    expect(array.lastindexof(a, 1)).toBe(3);
    expect(array.includes(a, Number.NaN)).toBe(true);
    expect(array.indexof(a, Number.NaN)).toBe(1);
    expect(array.indexof(a, 42)).toBe(-1);
  });

  it("every and some coerce numbers and treat na as false", () => {
    expect(array.every(array.from(1, 2, 3))).toBe(true);
    expect(array.every(array.from(1, 0, 3))).toBe(false);
    expect(array.every(array.from(1, Number.NaN))).toBe(false);
    expect(array.some(array.from(0, 0, 5))).toBe(true);
    expect(array.some(array.from(0, 0, 0))).toBe(false);
    expect(array.every(array.from(true, true))).toBe(true);
    expect(array.some(array.from(false, true))).toBe(true);
    expect(array.every(array.newBool(2))).toBe(false);
  });

  it("joins with na printing as NaN", () => {
    const a = array.from(1.5, Number.NaN, 3);
    expect(array.join(a, "-")).toBe("1.5-NaN-3");
    expect(array.join(array.from("a", "b"))).toBe("ab");
  });
});

describe("Phase 4 — sorting", () => {
  it("sorts numerically with na sinking to the end in both orders", () => {
    const a = array.from(3, Number.NaN, 1, 2);
    array.sort(a, order.ascending);
    expect(a.toArray()).toEqual([1, 2, 3, Number.NaN]);
    const b = array.from(3, Number.NaN, 1, 2);
    array.sort(b, order.descending);
    expect(b.toArray()).toEqual([3, 2, 1, Number.NaN]);
  });

  it("sorts strings lexicographically", () => {
    const a = array.from("pear", "apple", "fig");
    array.sort(a);
    expect(array.join(a, ",")).toBe("apple,fig,pear");
  });

  it("sort_indices returns the permutation without mutating", () => {
    const a = array.from(5, -2, 0, 9, 1);
    const indices = array.sort_indices(a);
    expect(indices.toArray()).toEqual([1, 2, 4, 0, 3]);
    expect(array.join(a, ",")).toBe("5,-2,0,9,1");
    expect(array.sort_indices(a, order.descending).toArray()).toEqual([3, 0, 4, 2, 1]);
  });
});

describe("Phase 4 — statistics (skip-na rule)", () => {
  const data = array.from(4, Number.NaN, 1, 3, Number.NaN, 2);

  it("avg, sum, range, median skip na; all-na yields na", () => {
    expect(array.avg(data)).toBe(2.5);
    expect(array.sum(data)).toBe(10);
    expect(array.range(data)).toBe(3);
    expect(array.median(data)).toBe(2.5);
    expect(array.avg(array.from(Number.NaN, Number.NaN))).toBeNaN();
    expect(array.avg(array.newFloat(0))).toBeNaN();
  });

  it("max and min honor nth", () => {
    const a = array.from(5, 3, 9, 1);
    expect(array.max(a)).toBe(9);
    expect(array.max(a, 1)).toBe(5);
    expect(array.max(a, 4)).toBeNaN();
    expect(array.min(a)).toBe(1);
    expect(array.min(a, 2)).toBe(5);
    expect(array.max(array.from(Number.NaN, 2), 0)).toBe(2);
  });

  it("mode resolves ties to the smallest value", () => {
    expect(array.mode(array.from(1, 2, 2, 3, 3))).toBe(2);
    expect(array.mode(array.from(1, 2, 3))).toBe(1);
    expect(array.mode(array.from(5, 5, 5))).toBe(5);
    expect(array.mode(array.newFloat(0))).toBeNaN();
  });

  it("variance and stdev switch between population and sample", () => {
    const a = array.from(2, 4, 4, 4, 5, 5, 7, 9);
    expect(array.variance(a)).toBeCloseTo(4, 12);
    expect(array.variance(a, false)).toBeCloseTo(32 / 7, 12);
    expect(array.stdev(a)).toBeCloseTo(2, 12);
    expect(array.stdev(a, false)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(array.variance(array.from(5), false)).toBeNaN();
  });

  it("covariance pairs by index and skips na pairs", () => {
    const x = array.from(1, 2, 3, 4);
    const y = array.from(2, 4, 6, 8);
    expect(array.covariance(x, y)).toBeCloseTo(2.5, 12);
    expect(array.covariance(x, y, false)).toBeCloseTo(10 / 3, 12);
    const x2 = array.from(1, Number.NaN, 3, 4);
    // pairs (1,2), (3,6), (4,8): means 8/3 and 16/3, covariance 28/9
    expect(array.covariance(x2, y)).toBeCloseTo(28 / 9, 12);
    expect(() => array.covariance(array.from(1, 2), array.from(1))).toThrow();
    expect(array.covariance(array.newFloat(0), array.newFloat(0))).toBeNaN();
  });

  it("standardize preserves na in place and empties the all-na case", () => {
    const standardized = array.standardize(array.from(1, 2, 3));
    expect(array.avg(standardized)).toBeCloseTo(0, 12);
    expect(array.stdev(standardized)).toBeCloseTo(1, 12);
    const withNa = array.standardize(array.from(1, Number.NaN, 3));
    expect(array.size(withNa)).toBe(3);
    expect(array.get(withNa, 1)).toBeNaN();
    expect(array.size(array.standardize(array.from(Number.NaN)))).toBe(0);
    expect(array.size(array.standardize(array.newFloat(0)))).toBe(0);
  });

  it("percentrank counts less-than-or-equal as a percentage", () => {
    const a = array.from(1, 2, 3, 4);
    expect(array.percentrank(a, 0)).toBeCloseTo(25, 12);
    expect(array.percentrank(a, 3)).toBe(100);
    expect(array.percentrank(a, 1)).toBeCloseTo(50, 12);
    expect(array.percentrank(a, -1)).toBe(100);
  });

  it("percentiles use nearest rank and linear interpolation", () => {
    const a = array.from(1, 2, 3, 4);
    expect(array.percentile_nearest_rank(a, 50)).toBe(2);
    expect(array.percentile_nearest_rank(a, 100)).toBe(4);
    expect(array.percentile_nearest_rank(a, 0)).toBe(1);
    expect(array.percentile_linear_interpolation(a, 50)).toBe(2.5);
    expect(array.percentile_linear_interpolation(a, 25)).toBe(1.75);
  });

  it("abs maps element-wise and returns na for the all-na input", () => {
    const result = array.abs(array.from(-1, 2, Number.NaN));
    expect(array.join(result!, ",")).toBe("1,2,NaN");
    expect(array.abs(array.from(Number.NaN))).toBeUndefined();
    expect(array.abs(array.newFloat(0))).toBeUndefined();
  });
});

describe("Phase 4 — binary search", () => {
  const sorted = array.from(1, 3, 3, 5, 7, 9);

  it("binary_search locates values or returns -1", () => {
    expect(array.binary_search(sorted, 5)).toBe(3);
    expect(array.binary_search(sorted, 4)).toBe(-1);
    expect(array.binary_search(array.newFloat(0), 1)).toBe(-1);
  });

  it("leftmost and rightmost follow the v6 boundary rules", () => {
    expect(array.binary_search_leftmost(sorted, 3)).toBe(1);
    expect(array.binary_search_leftmost(sorted, 4)).toBe(2);
    expect(array.binary_search_leftmost(sorted, 0)).toBe(0);
    expect(array.binary_search_leftmost(sorted, 99)).toBe(5);
    expect(array.binary_search_rightmost(sorted, 3)).toBe(2);
    expect(array.binary_search_rightmost(sorted, 4)).toBe(3);
    expect(array.binary_search_rightmost(sorted, 0)).toBe(0);
    expect(array.binary_search_rightmost(sorted, 99)).toBe(6);
    expect(array.binary_search_leftmost(array.newFloat(0), 1)).toBe(0);
    expect(array.binary_search_rightmost(array.newFloat(0), 1)).toBe(0);
  });
});

describe("Phase 4 — runtime integration (var, varip, rollback)", () => {
  const tickBars = (index: number): Bar[] => [
    { ...makeBars(2)[index]!, isClosed: false },
    { ...makeBars(2)[index]!, high: 99, isClosed: false },
    { ...makeBars(2)[index]!, high: 100, isClosed: true },
  ];

  class StreamProvider implements MarketDataProvider {
    public constructor(
      private readonly history: readonly Bar[],
      private readonly stream: readonly Bar[],
    ) {}
    public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;
    public streamBars = (): AsyncIterable<Bar> => {
      const stream = this.stream;
      return {
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
          yield* stream;
        },
      };
    };
    public getSymbolInfo = async (): Promise<SymbolInfo> => info;
  }

  it("rolls var array mutations back on realtime revisions", async () => {
    const sizes: number[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("a", () => array.newFloat(0));
      const a = cell.value;
      array.push(a, ctx.close.value);
      sizes.push(array.size(a));
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    expect(sizes).toEqual([1, 2, 2, 2]);
  });

  it("keeps varip array mutations across revisions", async () => {
    const sizes: number[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.varip("v", () => array.newFloat(0));
      const v = cell.value;
      array.push(v, ctx.close.value);
      sizes.push(array.size(v));
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    expect(sizes).toEqual([1, 2, 3, 4]);
  });

  it("undoes slice mutations and sort on rollback", async () => {
    const snapshots: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("p", () => array.from(3, 1, 2));
      const parent = cell.value;
      array.reverse(parent);
      array.push(parent, ctx.close.value);
      const view = array.slice(parent, 0, 2);
      array.set(view, 1, 42);
      snapshots.push(array.join(parent, ","));
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    // bar 0: [3,1,2] reversed -> [2,1,3], push 11, slice set -> [2,42,3,11]
    // every realtime revision restarts from the committed [2,42,3,11]:
    // reverse -> [11,3,42,2], push 12, slice set -> [11,42,42,2,12]
    expect(snapshots).toEqual(["2,42,3,11", "11,42,42,2,12", "11,42,42,2,12", "11,42,42,2,12"]);
  });
});

describe("Phase 4 — str.split", () => {
  it("splits on separators and propagates na", () => {
    const parts = str.split("a,b,c", ",")!;
    expect(parts.toArray()).toEqual(["a", "b", "c"]);
    expect(str.split("a,b,c,", ",")?.toArray()).toEqual(["a", "b", "c", ""]);
    expect(str.split("abc", "")!.toArray()).toEqual(["abc"]);
    expect(str.split(undefined, ",")).toBeUndefined();
    expect(str.split("abc", undefined)).toBeUndefined();
    expect(str.split("", ",")!.toArray()).toEqual([""]);
  });
});

describe("Phase 4 — ta.pivot_point_levels", () => {
  it("computes Traditional levels from the previous anchor period", async () => {
    const levelsPerBar: Array<Array<number | undefined>> = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      const levels = ta.pivotPointLevels("Traditional", anchor);
      levelsPerBar.push(levels.toArray());
    };
    const runtime = new PineRuntime({
      provider: new Provider(makeBars(6)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script);
    // anchor at bar 4 (time 5): the levels of the period covering bars 0-3
    // (H=15, L=8, C=14) and the same frozen values on bar 5
    expect(
      levelsPerBar.slice(0, 4).every((levels) => levels!.every((value) => Number.isNaN(value))),
    ).toBe(true);
    const bar5 = levelsPerBar[5]!;
    const high = 15;
    const low = 8;
    const close = 14;
    const p = (high + low + close) / 3;
    expect(bar5[0]).toBeCloseTo(p, 12);
    expect(bar5[1]).toBeCloseTo(2 * p - low, 12);
    expect(bar5[2]).toBeCloseTo(2 * p - high, 12);
    expect(bar5[10]).toBeCloseTo(4 * p - (4 * high - low), 12);
  });

  it("freezes non-developing levels between anchors", async () => {
    const pivotPerBar: number[] = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      const levels = ta.pivotPointLevels("Classic", anchor);
      pivotPerBar.push(levels.get(0) ?? Number.NaN);
    };
    const runtime = new PineRuntime({
      provider: new Provider(makeBars(11)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script);
    // bars 0-3 na (no anchor yet), bar 4 anchor computes bars 0-3,
    // bars 5-8 frozen, bar 9 is a new anchor with a different period
    expect(pivotPerBar.slice(0, 4).every((value) => Number.isNaN(value))).toBe(true);
    expect(pivotPerBar[5]).toBe(pivotPerBar[6]);
    expect(pivotPerBar[6]).toBe(pivotPerBar[8]);
    expect(Number.isNaN(pivotPerBar[5])).toBe(false);
    expect(pivotPerBar[5]).not.toBe(pivotPerBar[9]);
  });

  it("developing levels recalculate on the running period", async () => {
    const pivotPerBar: number[] = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      const levels = ta.pivotPointLevels("Traditional", anchor, true);
      pivotPerBar.push(levels.get(0) ?? Number.NaN);
    };
    const runtime = new PineRuntime({
      provider: new Provider(makeBars(7)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script);
    // anchor never fired before bar 4: developing window starts at bar 0
    // bar 1: bars 0-1 running H=13 L=8 C=12
    const p1 = (13 + 8 + 12) / 3;
    expect(pivotPerBar[1]).toBeCloseTo(p1, 12);
    // bar 3: bars 0-3 H=15 L=8 C=14
    const p3 = (15 + 8 + 14) / 3;
    expect(pivotPerBar[3]).toBeCloseTo(p3, 12);
    // bar 4 is an anchor: the developing window restarts at bar 4 alone
    const p4 = (16 + 12 + 15) / 3;
    expect(pivotPerBar[4]).toBeCloseTo(p4, 12);
    // bar 5: bars 4-5 running H=17 L=12 C=16
    const p5 = (17 + 12 + 16) / 3;
    expect(pivotPerBar[5]).toBeCloseTo(p5, 12);
  });

  it("fills absent levels with na per type and rejects Woodie+developing", async () => {
    const dmPerBar: Array<Array<number | undefined>> = [];
    const fibPerBar: Array<Array<number | undefined>> = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      dmPerBar.push(ta.pivotPointLevels("DM", anchor).toArray());
      fibPerBar.push(ta.pivotPointLevels("Fibonacci", anchor).toArray());
    };
    const runtime = new PineRuntime({
      provider: new Provider(makeBars(6)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script);
    const dm = dmPerBar[5]!;
    expect(Number.isNaN(dm[3])).toBe(true);
    expect(Number.isNaN(dm[10])).toBe(true);
    expect(Number.isNaN(dm[0])).toBe(false);
    const fib = fibPerBar[5]!;
    expect(Number.isNaN(fib[7])).toBe(true);
    expect(Number.isNaN(fib[6])).toBe(false);

    expect(() => ta.pivotPointLevels("Woodie", undefined as never, true)).toThrow(/Woodie/);
  });

  it("uses the period open for Woodie and the DM doji check", async () => {
    const bars: Bar[] = [
      { time: 1, open: 10, high: 12, low: 8, close: 10, volume: 1, isClosed: true },
      { time: 2, open: 11, high: 13, low: 9, close: 12, volume: 1, isClosed: true },
      { time: 3, open: 12, high: 15, low: 10, close: 11, volume: 1, isClosed: true },
      { time: 4, open: 13, high: 14, low: 11, close: 13, volume: 1, isClosed: true },
      { time: 5, open: 14, high: 16, low: 12, close: 15, volume: 1, isClosed: true },
    ];
    const woodieP: number[] = [];
    const dmP: number[] = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      woodieP.push(ta.pivotPointLevels("Woodie", anchor).get(0) ?? Number.NaN);
      dmP.push(ta.pivotPointLevels("DM", anchor).get(0) ?? Number.NaN);
    };
    const runtime = new PineRuntime({
      provider: new Provider(bars),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script);
    // bar 0 anchor, no prior period: na
    expect(Number.isNaN(woodieP[0])).toBe(true);
    // bar 5 (index 4) anchor: previous period = bars 0-3: H=15 L=8 C=13 O=10
    // Woodie P = (15 + 8 + 2*14) / 4 (current period open = bar 4's open)
    expect(woodieP[4]).toBeCloseTo((15 + 8 + 2 * 14) / 4, 12);
    // DM: prevOpen 10 < prevClose 13 -> X = 2*15 + 8 + 13 = 51 -> P = 12.75
    expect(dmP[4]).toBeCloseTo(51 / 4, 12);
  });
});
