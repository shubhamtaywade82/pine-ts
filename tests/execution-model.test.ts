import { describe, expect, it } from "vitest";
import { PineRuntime, fixnan, ta } from "../src/index.js";
import type {
  Bar,
  DiscardedTick,
  FloatSeries,
  MarketDataProvider,
  PineScript,
  RuntimeOptions,
  Series,
  SymbolInfo,
} from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const bar = (time: number, close: number, isClosed = true, volume = 100): Bar => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume,
  isClosed,
});

const closesToBars = (closes: readonly number[]): Bar[] =>
  closes.map((close, index) => bar(index + 1, close, true, 100 + index * 10));

class Provider implements MarketDataProvider {
  public constructor(
    private readonly history: readonly Bar[],
    private readonly stream: readonly Bar[] = [],
  ) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;

  public streamBars = (): AsyncIterable<Bar> => {
    const stream = this.stream;
    return {
      async *[Symbol.asyncIterator]() {
        yield* stream;
      },
    };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

const runtimeFor = (
  history: readonly Bar[],
  stream: readonly Bar[] = [],
  options: Partial<RuntimeOptions> = {},
): PineRuntime =>
  new PineRuntime({
    provider: new Provider(history, stream),
    symbol: "TEST",
    timeframe: "1",
    ...options,
  });

const run = async (
  history: readonly Bar[],
  script: PineScript,
  options: Partial<RuntimeOptions> = {},
): Promise<PineRuntime> => {
  const runtime = runtimeFor(history, [], options);
  await runtime.run(script);
  return runtime;
};

const CLOSES = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 21, 20] as const;

describe("last_bar_index", () => {
  it("is the dataset's last bar index on every historical bar, then the realtime bar index", async () => {
    const history = closesToBars(CLOSES);
    const stream = [bar(13, 22, false), bar(13, 23, true), bar(14, 24, true)];
    const runtime = runtimeFor(history, stream);
    const observed: number[] = [];
    const script: PineScript = (ctx) => {
      observed.push(ctx.last_bar_index);
    };

    await runtime.run(script);
    expect(observed).toEqual(Array.from({ length: CLOSES.length }, () => CLOSES.length - 1));

    observed.length = 0;
    await runtime.runRealtime(script);
    expect(observed).toEqual([12, 12, 13]);
    expect(runtime.lastBarIndex).toBe(13);
  });
});

describe("historical to realtime hand-off", () => {
  it("executes a final isClosed:false historical bar as the open realtime bar", async () => {
    const history = [bar(1, 10), bar(2, 11), bar(3, 12), bar(4, 13, false)];
    const runtime = runtimeFor(history, [bar(4, 14, false), bar(4, 15, true)]);
    const states: Array<[number, boolean, boolean, boolean, boolean, boolean, number]> = [];
    const script: PineScript = (ctx) => {
      const { barstate } = ctx;
      states.push([
        barstate.index,
        barstate.ishistory,
        barstate.isrealtime,
        barstate.isconfirmed,
        barstate.islast,
        barstate.islastconfirmedhistory,
        ctx.last_bar_index,
      ]);
    };

    await runtime.run(script);
    expect(states).toEqual([
      [0, true, false, true, false, false, 3],
      [1, true, false, true, false, false, 3],
      [2, true, false, true, false, true, 3],
      [3, false, true, false, true, false, 3],
    ]);

    states.length = 0;
    await runtime.runRealtime(script);
    expect(states).toEqual([
      [3, false, true, false, true, false, 3],
      [3, false, true, true, true, false, 3],
    ]);
    expect(runtime.sources.close.history()).toEqual([10, 11, 12, 15]);
  });

  it("reports and skips out-of-order updates and updates to confirmed bars", async () => {
    const discarded: DiscardedTick[] = [];
    const stream = [bar(1, 10), bar(1, 11, false), bar(2, 12, false), bar(1, 9), bar(2, 13)];
    const runtime = runtimeFor([], stream, { onDiscardedTick: (tick) => discarded.push(tick) });
    const closes: number[] = [];

    await runtime.runRealtime((ctx) => {
      closes.push(ctx.close.value);
    });

    expect(closes).toEqual([10, 12, 13]);
    expect(discarded.map(({ bar: { time, close }, reason }) => [time, close, reason])).toEqual([
      [1, 11, "bar_already_confirmed"],
      [1, 9, "out_of_order"],
    ]);
    expect(runtime.sources.close.history()).toEqual([10, 13]);
  });

  it("rejects historical bars that are not strictly increasing in time", async () => {
    const runtime = runtimeFor([bar(1, 10), bar(3, 11), bar(2, 12)]);
    await expect(runtime.run(() => undefined)).rejects.toThrow(/strictly increasing/);
  });
});

describe("runtime-scoped series identity", () => {
  it("allocates series ids per session, independent of other runtimes", async () => {
    const smaId = async (extraSeries: boolean): Promise<number | undefined> => {
      let id: number | undefined;
      await run(closesToBars(CLOSES), (ctx) => {
        if (extraSeries) ta.ema(ta.rsi(ctx.close, 3), 4);
        else id = ta.sma(ctx.close, 3).id;
      });
      return id;
    };

    const first = await smaId(false);
    await smaId(true);
    expect(await smaId(false)).toBe(first);
  });
});

describe("ctx.scope call-site identity", () => {
  const counter = (ctx: Parameters<PineScript>[0]): number => {
    const cell = ctx.state.var("n", () => 0);
    cell.set(cell.value + 1);
    return cell.value;
  };

  it("gives each scope independent var state and shares state within one scope", async () => {
    const a: number[] = [];
    const b: number[] = [];
    await run(closesToBars(CLOSES.slice(0, 4)), (ctx) => {
      a.push(ctx.scope("a", () => counter(ctx)));
      b.push(ctx.scope("b", () => counter(ctx)));
      // Re-evaluating the same written call (same id) within one bar reuses
      // its state, like a Pine call inside a loop.
      if (ctx.barstate.index % 2 === 0) b.push(ctx.scope("b", () => counter(ctx)));
    });

    expect(a).toEqual([1, 2, 3, 4]);
    expect(b).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("gives ta.* calls in different scopes independent nodes", async () => {
    let distinct = false;
    let equal = true;
    await run(closesToBars(CLOSES), (ctx) => {
      const global = ta.cum(ctx.close);
      const scoped = ctx.scope("inner", () => ta.cum(ctx.close));
      const nested = ctx.scope("outer", () => ctx.scope("inner", () => ta.cum(ctx.close)));
      distinct = global !== scoped && scoped !== nested;
      equal &&= global.value === scoped.value && scoped.value === nested.value;
    });

    expect(distinct).toBe(true);
    expect(equal).toBe(true);
  });

  it("rejects empty and path-like scope ids", async () => {
    await expect(run([bar(1, 1)], (ctx) => ctx.scope(" ", () => 0))).rejects.toThrow(RangeError);
    await expect(run([bar(1, 1)], (ctx) => ctx.scope("a/b", () => 0))).rejects.toThrow(RangeError);
  });
});

describe("conditional execution (Pine local-scope rule)", () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8];

  it("advances ta state only on bars where the call executes and carries history forward", async () => {
    const holder: { cum?: FloatSeries } = {};
    const called: number[] = [];
    await run(closesToBars(closes), (ctx) => {
      if (ctx.barstate.index % 2 === 0) {
        holder.cum = ta.cum(ctx.close);
        called.push(holder.cum.value);
      }
    });

    // Called on bars 0, 2, 4, 6 with closes 1, 3, 5, 7.
    expect(called).toEqual([1, 4, 9, 16]);
    // Bars where the call did not run commit the last committed value.
    expect(holder.cum?.history()).toEqual([1, 1, 4, 4, 9, 9, 16, 16]);
  });

  it("seeds and smooths a conditional ta.ema over executed bars only", async () => {
    const conditional: number[] = [];
    await run(closesToBars(closes), (ctx) => {
      if (ctx.barstate.index % 2 === 0) conditional.push(ta.ema(ctx.close, 3).value);
    });

    // alpha = 0.5 over closes 1, 3, 5, 7.
    expect(conditional).toEqual([1, 2, 3.5, 5.25]);
  });

  it("resolves [1] on a conditional series to the last committed value (User Manual example)", async () => {
    const previous: Array<number | undefined> = [];
    await run(closesToBars(closes), (ctx) => {
      const remainder = ctx.barstate.index % 3;
      if (remainder !== 0) {
        const source = ctx.series("source", () => ctx.close.value);
        previous.push(source.at(1));
      }
    });

    // Calls on bars 1, 2, 4, 5, 7; after a skipped bar, [1] is the value from
    // the last call, not from the previous bar.
    expect(previous).toEqual([undefined, 2, 3, 5, 6]);
  });
});

describe("series int lengths", () => {
  const referenceSma = (index: number, length: number): number => {
    if (index - length + 1 < 0) return Number.NaN;
    const window = CLOSES.slice(index - length + 1, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / length;
  };

  it("recomputes ta.sma over history when the length changes", async () => {
    const values: number[] = [];
    await run(closesToBars(CLOSES), (ctx) => {
      const length = ctx.barstate.index < 6 ? 3 : 5;
      values.push(ta.sma(ctx.close, length).value);
    });

    const expected = CLOSES.map((_, index) => referenceSma(index, index < 6 ? 3 : 5));
    expect(values).toHaveLength(expected.length);
    for (const [index, value] of values.entries()) {
      const want = expected[index] ?? Number.NaN;
      if (Number.isNaN(want)) expect(value).toBeNaN();
      else expect(value).toBeCloseTo(want, 10);
    }
  });

  it.each([
    ["sma", (source: FloatSeries) => ta.sma(source, 4)],
    ["cmo", (source: FloatSeries) => ta.cmo(source, 4)],
    ["mfi", (source: FloatSeries) => ta.mfi(source, 4)],
  ] as const)(
    "seeds a mid-run %s node to match one that ran from the first bar",
    async (_name, build) => {
      const pairs: Array<[number, number]> = [];
      await run(closesToBars(CLOSES), (ctx) => {
        const full = build(ctx.close);
        if (ctx.barstate.index >= 6) {
          const late = ctx.scope("late", () => build(ctx.close));
          pairs.push([late.value, full.value]);
        }
      });

      expect(pairs).toHaveLength(CLOSES.length - 6);
      for (const [late, full] of pairs) expect(late).toBeCloseTo(full, 10);
    },
  );
});

describe("max_bars_back", () => {
  it("bounds history reads and retained history", async () => {
    const history = closesToBars(CLOSES);
    let withinLimit: number | undefined;
    let beyondLimit: unknown;
    const runtime = await run(
      history,
      (ctx) => {
        if (!ctx.barstate.islast) return;
        withinLimit = ctx.close.at(3);
        try {
          ctx.close.at(4);
        } catch (error) {
          beyondLimit = error;
        }
      },
      { maxBarsBack: 3 },
    );

    expect(withinLimit).toBe(CLOSES[CLOSES.length - 4]);
    expect(beyondLimit).toBeInstanceOf(RangeError);
    expect((beyondLimit as Error).message).toMatch(/max_bars_back/);
    expect(runtime.sources.close.history()).toEqual(CLOSES.slice(-4));
  });

  it("raises when a built-in window exceeds the buffer", async () => {
    await expect(
      run(closesToBars(CLOSES), (ctx) => ta.wma(ctx.close, 5).value, { maxBarsBack: 3 }),
    ).rejects.toThrow(RangeError);
  });

  it.each([0, 5001, 2.5])("rejects maxBarsBack %s", (maxBarsBack) => {
    expect(() => runtimeFor([], [], { maxBarsBack })).toThrow(RangeError);
  });
});

describe("fixnan", () => {
  it("replaces na with the previous non-na value and keeps leading na", async () => {
    const raw = [Number.NaN, 1, Number.NaN, Number.NaN, 4, Number.NaN];
    const fixed: number[] = [];
    const holder: { series?: Series<number> } = {};
    await run(closesToBars(raw.map((_, index) => index)), (ctx) => {
      const source = ctx.series("raw", () => raw[ctx.bar_index.value ?? 0] ?? Number.NaN);
      holder.series = fixnan(source);
      fixed.push(holder.series.value ?? Number.NaN);
    });

    expect(fixed.slice(1)).toEqual([1, 1, 1, 4, 4]);
    expect(fixed[0]).toBeNaN();
  });
});
