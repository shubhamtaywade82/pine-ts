import { describe, expect, it } from "vitest";
import { PineRuntime, createSeries, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

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

const tick = (time: number, close: number, isClosed: boolean): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  isClosed,
});

class Provider implements MarketDataProvider {
  public constructor(
    private readonly history: readonly Bar[],
    private readonly stream: readonly Bar[] = [],
  ) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;

  public streamBars = (): AsyncIterable<Bar> => {
    let index = 0;
    const iterator: AsyncIterator<Bar> = {
      next: async () => {
        const value = this.stream[index];
        if (value === undefined) return { value: undefined, done: true };
        index += 1;
        return { value, done: false };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

type Context = Parameters<PineScript>[0];

const runHistorical = async (bars: readonly Bar[], script: PineScript): Promise<PineRuntime> => {
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
  return runtime;
};

const runRealtime = async (ticks: readonly Bar[], script: PineScript): Promise<PineRuntime> => {
  const runtime = new PineRuntime({
    provider: new Provider([], ticks),
    symbol: "TEST",
    timeframe: "1m",
    executionMode: "realtime",
  });
  await runtime.runRealtime(script);
  return runtime;
};

const bars = closesToBars([1, 2, 3, 4, 5, 6, 7, 8]);

describe("Phase 0 — public series semantics", () => {
  it("does not implicitly coerce series into JavaScript numbers", () => {
    const series = createSeries([10, 20, 30]);
    // No valueOf/toString overrides exist on purpose: the only way out of the
    // series domain is an explicit .value / .current / at(n) read.
    expect(Number.isNaN(Number(series as unknown as number))).toBe(true);
    expect(String(series)).toContain("object");
    expect(series.value).toBe(30);
  });

  it("keeps ctx.series structural identity keyed by name", async () => {
    const identities: unknown[] = [];
    await runHistorical(bars, (ctx) => {
      const first = ctx.series("spread", () => 0);
      const second = ctx.series("spread", () => 1);
      const other = ctx.series("other", () => 0);
      identities.push(first, second, other);
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[0]).not.toBe(identities[2]);
  });

  it("exposes committed history through at(n) on user series", async () => {
    const observed: Array<Array<number | undefined>> = [];
    await runHistorical(bars, (ctx) => {
      const doubled = ctx.series("doubled", () => ctx.close.value * 2);
      observed.push([doubled.at(0), doubled.at(1), doubled.at(2)]);
    });

    // Bar 0 has no committed history yet; bar k reads bar k-1 at offset 1.
    expect(observed[0]).toEqual([2, undefined, undefined]);
    expect(observed[1]).toEqual([4, 2, undefined]);
    expect(observed[2]).toEqual([6, 4, 2]);
    expect(observed[7]).toEqual([16, 14, 12]);
  });

  it("captures JavaScript locals at creation and re-reads series state per evaluation", async () => {
    const readings: number[] = [];
    await runHistorical(bars, (ctx) => {
      // `factor` is a JS local: the closure created on bar 0 captures bar 0's
      // value forever. Series reads inside the closure always observe the
      // current bar. This is the documented series/JS-local boundary.
      const factor = ctx.bar.close > 5 ? 2 : 1;
      const scaled = ctx.series("scaled", () => ctx.close.value * factor);
      readings.push(scaled.value ?? Number.NaN);
    });

    // Bar 0 close = 1 -> factor 1, captured for every later bar.
    expect(readings).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("re-evaluates user series on realtime revisions and keeps history committed", async () => {
    const ticks = [tick(1, 10, true), tick(2, 20, false), tick(2, 30, false), tick(2, 40, true)];
    const spreadReadings: number[] = [];
    const aboveReadings: boolean[] = [];
    const aboveHistory: Array<boolean | undefined> = [];

    const runtime = await runRealtime(ticks, (ctx) => {
      const spread = ctx.series("spread", () => ctx.close.value - 10);
      // Generic user series keep `undefined` for missing values: coalesce to
      // Pine na semantics (NaN / false) at the read site.
      const above = ctx.series("above", () => (spread.value ?? Number.NaN) > 0);
      spreadReadings.push(spread.value ?? Number.NaN);
      aboveReadings.push(above.value ?? false);
      aboveHistory.push(above.at(1));
    });

    // Every tick re-evaluates both user series against the current revision.
    expect(spreadReadings).toEqual([0, 10, 20, 30]);
    expect(aboveReadings).toEqual([false, true, true, true]);
    // History offsets only ever expose confirmed bars: during bar 1 every
    // at(1) read resolves to bar 0's committed false, never bar 1's working
    // true, no matter how many revisions the bar has seen.
    expect(aboveHistory).toEqual([undefined, false, false, false]);
    // Committed history contains exactly the confirmed bars.
    expect(runtime.sources.close.history()).toEqual([10, 40]);
  });
});

describe("Phase 0 — per-bar commit and history alignment", () => {
  it("commits a value for every confirmed bar, even when the script never read the series", async () => {
    const holder: { spread?: ReturnType<Context["series"]> } = {};
    const fastHistory: number[] = [];
    const slowHistory: number[] = [];
    const readOnBar: number[] = [];

    await runHistorical(bars, (ctx) => {
      const fast = ta.ema(ctx.close, 2);
      const slow = ta.ema(ctx.close, 6);
      const spread = ctx.series("spread", () => fast.value - slow.value);
      holder.spread = spread;
      // Only read `spread` on even closes: bars 2, 4, 6, 8.
      if (ctx.bar.close % 2 === 0) {
        readOnBar.push(spread.value ?? Number.NaN);
      }
      fastHistory.push(fast.value);
      slowHistory.push(slow.value);
    });

    // Only half the bars read the series explicitly.
    expect(readOnBar).toHaveLength(4);
    const history = holder.spread?.history() ?? [];
    // One committed value per confirmed bar, no gaps.
    expect(history).toHaveLength(bars.length);
    // Each committed value matches the fast/slow values observed on that bar.
    for (let index = 0; index < bars.length; index += 1) {
      const fast = fastHistory[index] ?? Number.NaN;
      const slow = slowHistory[index] ?? Number.NaN;
      const expected = fast - slow;
      const committed = history[index];
      if (Number.isNaN(expected)) expect(Number.isNaN(committed)).toBe(true);
      else expect(committed).toBeCloseTo(expected, 10);
    }
  });
});

describe("Phase 0 — var / varip lifecycle", () => {
  it("discards unconfirmed bar state when the next bar opens", async () => {
    // Bar 1 streams two ticks and never confirms; bar 2 arrives and confirms.
    // Historical execution never saw bar 1, so it must leave no trace.
    const ticks = [tick(1, 100, false), tick(1, 101, false), tick(2, 103, true)];
    const runtime = await runRealtime(ticks, (ctx) => {
      const acc = ctx.state.var("acc", () => 0);
      acc.set(acc.value + 1);
    });

    const acc = runtime.state.var("acc", () => 0);
    // Only bar 2's increment survived; bar 1's unconfirmed increments vanished.
    expect(acc.value).toBe(1);
    // Committed history contains exactly the confirmed bar.
    expect(runtime.sources.close.history()).toEqual([103]);
    expect(runtime.barIndex).toBe(1);
  });

  it("keeps varip accumulating across unconfirmed ticks and bars", async () => {
    const ticks = [tick(1, 100, false), tick(1, 101, false), tick(2, 103, true)];
    const runtime = await runRealtime(ticks, (ctx) => {
      const counter = ctx.state.varip("counter", () => 0);
      counter.set(counter.value + 1);
    });

    const counter = runtime.state.varip("counter", () => 0);
    // varip never rolls back: all three executions left a permanent +1.
    expect(counter.value).toBe(3);
  });

  it("exposes var state through user series with replay-aligned history", async () => {
    const ticks = [tick(1, 10, true), tick(2, 20, false), tick(2, 25, true), tick(3, 30, true)];
    const holder: { totalSeries?: ReturnType<Context["series"]> } = {};
    const runtime = await runRealtime(ticks, (ctx) => {
      const total = ctx.state.var("total", () => 0);
      total.set(total.value + ctx.close.value);
      holder.totalSeries = ctx.series("totalSeries", () => total.value);
    });

    const total = runtime.state.var("total", () => 0);
    // Bar 1 commits 10. Bar 2 rolls the intrabar 20-update back in favor of
    // 25: 10 + 25 = 35. Bar 3 commits 35 + 30 = 65.
    expect(total.value).toBe(65);
    expect(holder.totalSeries?.history()).toEqual([10, 35, 65]);
  });
});

describe("Phase 0 — na propagation", () => {
  it("propagates na through windows and clears once na leaves the window", async () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8];
    const smoothed: number[] = [];
    await runHistorical(closesToBars(closes), (ctx) => {
      // change is na on bar 0, then 1 forever after.
      const diff = ta.change(ctx.close, 1);
      const smoothedDiff = ta.sma(diff, 3);
      smoothed.push(smoothedDiff.value);
    });

    // Window [bar0..bar2] contains bar 0's na -> na; bars 3+ are clean.
    expect(smoothed.slice(0, 3).every((value) => Number.isNaN(value))).toBe(true);
    expect(smoothed[3]).toBeCloseTo(1, 10);
    expect(smoothed[7]).toBeCloseTo(1, 10);
  });

  it("treats na operands as false in boolean built-ins", async () => {
    const results: boolean[] = [];
    await runHistorical(bars, (ctx) => {
      const fast = ta.ema(ctx.close, 2);
      const slow = ta.ema(ctx.close, 2);
      results.push(ta.crossover(fast, slow).value);
    });

    // Identical series never cross; na history on early bars reads as false.
    expect(results.every((value) => value === false)).toBe(true);
  });
});
