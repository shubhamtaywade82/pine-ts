import { describe, expect, it } from "vitest";
import { map, PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto", minTick: 0.25 };

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

describe("Phase 5 — map construction and put", () => {
  it("puts pairs and returns the previous value (na when the key is new)", () => {
    const m = map.newMap<string, number>();
    expect(map.put(m, "first", 10)).toBeUndefined();
    expect(map.put(m, "second", 15)).toBeUndefined();
    expect(map.put(m, "first", 20)).toBe(10);
    expect(map.get(m, "first")).toBe(20);
  });

  it("keeps the insertion-order slot when re-putting an existing key", () => {
    const m = map.newMap<string, number>();
    map.put(m, "a", 1);
    map.put(m, "b", 2);
    map.put(m, "c", 3);
    map.put(m, "a", 10);
    expect(map.keys(m).toArray()).toEqual(["a", "b", "c"]);
    expect(map.values(m).toArray()).toEqual([10, 2, 3]);
  });

  it("enforces the 50,000-pair cap", () => {
    const m = map.newMap<number, number>();
    for (let index = 0; index < 50_000; index += 1) map.put(m, index, index);
    expect(() => map.put(m, 50_000, 1)).toThrow(/Maximum size is 50000/);
    // Re-putting an existing key is still allowed at the cap.
    expect(map.put(m, 0, -1)).toBe(0);
  });
});

describe("Phase 5 — map queries", () => {
  it("gets, contains, and sizes", () => {
    const m = map.newMap<number, number>();
    expect(map.size(m)).toBe(0);
    map.put(m, 1, 1.5);
    map.put(m, 2, 2.5);
    expect(map.size(m)).toBe(2);
    expect(map.get(m, 1)).toBe(1.5);
    expect(map.get(m, 3)).toBeUndefined();
    expect(map.contains(m, 2)).toBe(true);
    expect(map.contains(m, 3)).toBe(false);
  });

  it("keys and values return independent array copies", () => {
    const m = map.newMap<string, number>();
    map.put(m, "open", 1);
    map.put(m, "close", 2);
    const keys = map.keys(m);
    const values = map.values(m);
    expect(keys.toArray()).toEqual(["open", "close"]);
    keys.set(0, "mutated");
    values.set(0, 99);
    expect(map.contains(m, "open")).toBe(true);
    expect(map.get(m, "open")).toBe(1);
  });

  it("numeric keys distinguish values but treat 0 and -0 as one key", () => {
    const m = map.newMap<number, number>();
    map.put(m, 0, 42);
    expect(map.contains(m, -0)).toBe(true);
    expect(map.contains(m, 1)).toBe(false);
    expect(map.size(m)).toBe(1);
  });
});

describe("Phase 5 — map removal and merging", () => {
  it("removes pairs, returning the previous value or na", () => {
    const m = map.newMap<string, number>();
    map.put(m, "a", 1);
    map.put(m, "b", 2);
    expect(map.remove(m, "zz")).toBeUndefined();
    expect(map.remove(m, "a")).toBe(1);
    expect(map.size(m)).toBe(1);
    expect(map.keys(m).toArray()).toEqual(["b"]);
  });

  it("clear removes every pair", () => {
    const m = map.newMap<string, number>();
    map.put(m, "a", 1);
    map.put(m, "b", 2);
    map.clear(m);
    expect(map.size(m)).toBe(0);
    expect(map.contains(m, "a")).toBe(false);
  });

  it("copy is independent of the original", () => {
    const a = map.newMap<string, number>();
    map.put(a, "example", 1);
    const b = map.copy(a);
    map.put(b, "example", 2);
    expect(map.get(a, "example")).toBe(1);
    expect(map.get(b, "example")).toBe(2);
    map.put(b, "extra", 3);
    expect(map.size(a)).toBe(1);
    expect(map.size(b)).toBe(2);
  });

  it("put_all merges with id2's insertion order for new keys", () => {
    const a = map.newMap<string, number>();
    map.put(a, "first", 10);
    map.put(a, "second", 15);
    const b = map.newMap<string, number>();
    map.put(b, "third", 20);
    map.put(b, "second", 99);
    map.put_all(a, b);
    expect(map.keys(a).toArray()).toEqual(["first", "second", "third"]);
    expect(map.get(a, "third")).toBe(20);
    expect(map.get(a, "second")).toBe(99);
  });
});

describe("Phase 5 — map runtime integration (var, varip, rollback)", () => {
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

  it("rolls var map mutations back on realtime revisions", async () => {
    const sizes: number[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("m", () => map.newMap<string, number>());
      const m = cell.value;
      // The size-derived key makes every execution insert a fresh pair, so
      // rollback must restore the committed size before the next revision.
      map.put(m, `k${map.size(m)}`, ctx.close.value);
      sizes.push(map.size(m));
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

  it("keeps varip map mutations across revisions", async () => {
    const sizes: number[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.varip("m", () => map.newMap<string, number>());
      const m = cell.value;
      map.put(m, `k${map.size(m)}`, ctx.close.value);
      sizes.push(map.size(m));
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

  it("undoes value replacement, removal, and clear on rollback", async () => {
    const observations: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("m", () => map.newMap<string, number>());
      const m = cell.value;
      if (ctx.barstate.isFirst) {
        map.put(m, "a", 1);
        map.put(m, "b", 2);
      }
      map.put(m, "a", ctx.close.value);
      map.remove(m, "b");
      if (ctx.barstate.index === 1) map.clear(m);
      observations.push(`${map.size(m)}:${map.get(m, "a") ?? "na"}:${map.contains(m, "b")}`);
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    // bar 0 commits {a: 11}; each realtime revision restarts from there:
    // put a -> 12, remove b (absent), clear -> 0 pairs.
    expect(observations).toEqual(["1:11:false", "0:na:false", "0:na:false", "0:na:false"]);
  });
});
