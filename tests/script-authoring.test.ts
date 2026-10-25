/**
 * Tests for the concise authoring layer (`indicator()` / `defineStrategy()`).
 *
 * The layer is sugar over `PineRuntime` + `StrategyEngine`: every test that
 * matters compares the concise form against the equivalent low-level script
 * so the convenience API can never drift from runtime semantics.
 */

import { describe, expect, it } from "vitest";
import {
  PineRuntime,
  StrategyEngine,
  defineStrategy,
  indicator,
  requireStrategyEngine,
  setActiveStrategyEngine,
  ta,
  type Bar,
  type MarketDataProvider,
  type PineContext,
  type SymbolInfo,
} from "../src/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  timezone: "UTC",
  type: "crypto",
};

const closesToBars = (closes: readonly number[]): Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
    isClosed: true,
  }));

const CLOSES = [
  10, 11, 12, 11, 10, 9, 10, 12, 13, 14, 13, 12, 11, 12, 13, 15, 16, 15, 14, 13, 12, 11, 12, 14, 15,
  16, 17, 16, 15, 14, 13, 12, 13, 14, 15,
];

class StreamProvider implements MarketDataProvider {
  public constructor(private readonly ticks: readonly Bar[]) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => [];
  public streamBars = (): AsyncIterable<Bar> => {
    const ticks = this.ticks;
    return {
      [Symbol.asyncIterator]: async function* () {
        await Promise.resolve();
        yield* ticks;
      },
    };
  };
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const runLowLevel = async (
  bars: readonly Bar[],
  script: (ctx: PineContext) => void,
): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new StreamProvider([]),
    symbol: "TEST",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

const toPlotValue = (value: number | undefined): number | undefined =>
  value === undefined || Number.isNaN(value) ? undefined : value;

describe("indicator()", () => {
  const rsi = indicator("RSI", ({ close, input, plot, hline }) => {
    const length = input.int(14, "Length", { min: 1 });
    plot(ta.rsi(close, length), "RSI");
    hline(70, "Upper");
    hline(30, "Lower");
  });

  it("produces the same values as the equivalent low-level script", async () => {
    const bars = closesToBars(CLOSES);
    const expected: Array<number | undefined> = [];
    await runLowLevel(bars, (ctx) => expected.push(toPlotValue(ta.rsi(ctx.close, 14).at(0))));

    const output = await rsi.run(bars);

    expect(output.values["RSI"]).toEqual(expected);
    expect(output.values["RSI"]?.[0]).toBeUndefined();
    expect(output.values["Upper"]).toEqual(bars.map(() => 70));
    expect(output.values["Lower"]).toEqual(bars.map(() => 30));
  });

  it("derives plot and input metadata from the calls", async () => {
    const output = await rsi.run(closesToBars(CLOSES.slice(0, 3)));

    expect(rsi.title).toBe("RSI");
    expect(output.inputs).toEqual([
      { kind: "int", name: "Length", displayName: "Length", defaultValue: 14, min: 1 },
    ]);
    expect(output.plots.map((p) => [p.id, p.kind, p.pane])).toEqual([
      ["RSI", "line", "sub"],
      ["Upper", "hline", "sub"],
      ["Lower", "hline", "sub"],
    ]);
  });

  it("applies input overrides by title", async () => {
    const bars = closesToBars(CLOSES);
    const expected: Array<number | undefined> = [];
    await runLowLevel(bars, (ctx) => expected.push(toPlotValue(ta.rsi(ctx.close, 5).at(0))));

    const output = await rsi.run(bars, { inputs: { Length: 5 } });

    expect(output.values["RSI"]).toEqual(expected);
  });

  it("rejects invalid or unknown input overrides instead of guessing", async () => {
    const bars = closesToBars(CLOSES.slice(0, 3));
    await expect(rsi.run(bars, { inputs: { Length: 2.5 } })).rejects.toThrow(/integer/);
    await expect(rsi.run(bars, { inputs: { Length: 0 } })).rejects.toThrow(/>= 1/);
    await expect(rsi.run(bars, { inputs: { Period: 5 } })).rejects.toThrow(
      /Unknown input override/,
    );
  });

  it("resolves source inputs to the selected price series", async () => {
    const script = indicator("Src", ({ input, plot }) => {
      plot(input.source("close", "Source"), "Value");
    });
    const bars = closesToBars([10, 11, 12]);

    const byDefault = await script.run(bars);
    const byHigh = await script.run(bars, { inputs: { Source: "high" } });

    expect(byDefault.values["Value"]).toEqual([10, 11, 12]);
    expect(byHigh.values["Value"]).toEqual([11, 12, 13]);
    await expect(script.run(bars, { inputs: { Source: "hl5" } })).rejects.toThrow(/Unknown source/);
  });

  it("validates string options and booleans", async () => {
    const script = indicator("Opts", ({ close, input, plot }) => {
      const mode = input.string("sma", "Mode", { options: ["sma", "ema"] });
      const show = input.bool(true, "Show");
      const average = mode === "sma" ? ta.sma(close, 2) : ta.ema(close, 2);
      plot(show ? average : undefined, "MA");
    });
    const bars = closesToBars([10, 12, 14]);

    expect((await script.run(bars)).values["MA"]).toEqual([undefined, 11, 13]);
    expect((await script.run(bars, { inputs: { Show: false } })).values["MA"]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    await expect(script.run(bars, { inputs: { Mode: "wma" } })).rejects.toThrow(/one of/);
  });

  it("names untitled plots by call order and disambiguates duplicate titles", async () => {
    const script = indicator("Ids", ({ close, plot }) => {
      plot(close);
      plot(close, "X");
      plot(close, "X");
    });
    const output = await script.run(closesToBars([1]));
    expect(output.plots.map((p) => p.id)).toEqual(["plot_0", "X", "X (2)"]);
  });

  it("rejects plots called conditionally, as Pine forbids local-scope plot()", async () => {
    const script = indicator("Conditional", ({ close, bar_index, plot }) => {
      if ((bar_index.at(0) ?? 0) % 2 === 0) plot(close, "Even");
    });
    await expect(script.run(closesToBars([1, 2, 3]))).rejects.toThrow(/unconditionally/);
  });

  it("propagates script errors with the failing bar index", async () => {
    const script = indicator("Boom", ({ bar_index }) => {
      if (bar_index.at(0) === 2) throw new Error("boom");
    });
    await expect(script.run(closesToBars([1, 2, 3]))).rejects.toThrow(/bar 2: boom/);
  });

  it("places plots on the price pane when overlay is set", async () => {
    const script = indicator("SMA", { overlay: true }, ({ close, plot }) => plot(ta.sma(close, 2)));
    const output = await script.run(closesToBars([1, 2]));
    expect(output.plots[0]?.pane).toBe("main");
  });

  it("keeps independent runs isolated", async () => {
    const bars = closesToBars(CLOSES);
    const [a, b] = await Promise.all([rsi.run(bars), rsi.run(bars, { inputs: { Length: 5 } })]);
    const again = await rsi.run(bars);
    expect(again.values["RSI"]).toEqual(a.values["RSI"]);
    expect(b.values["RSI"]).not.toEqual(a.values["RSI"]);
  });

  it("overwrites the open bar's values on realtime ticks (last tick wins)", async () => {
    const sma = indicator("SMA", ({ close, plot }) => plot(ta.sma(close, 2), "SMA"));
    const execution = sma.bind();
    const tick = (time: number, close: number, isClosed: boolean): Bar => ({
      time,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      isClosed,
    });
    const runtime = new PineRuntime({
      provider: new StreamProvider([tick(3, 20, false), tick(3, 30, false), tick(3, 40, true)]),
      symbol: "TEST",
      timeframe: "1",
    });

    await runtime.run(execution.script, [tick(1, 10, true), tick(2, 20, true)]);
    await runtime.runRealtime(execution.script);

    expect(execution.output().values["SMA"]).toEqual([undefined, 15, 30]);
  });
});

describe("defineStrategy()", () => {
  const bars = closesToBars(CLOSES);

  const lowLevelBacktest = async (): Promise<StrategyEngine> => {
    const engine = new StrategyEngine();
    engine.configure({ title: "SMA Cross", initial_capital: 10_000 });
    setActiveStrategyEngine(engine);
    try {
      await runLowLevel(bars, (ctx) => {
        engine.processBar(ctx.bar);
        const sma = ta.sma(ctx.close, 5);
        if (ta.crossover(ctx.close, sma).value) engine.entry("Long", "long", 2);
        if (ta.crossunder(ctx.close, sma).value) engine.close("Long");
      });
    } finally {
      setActiveStrategyEngine(undefined);
    }
    return engine;
  };

  const smaCross = defineStrategy(
    "SMA Cross",
    { initial_capital: 10_000, default_qty_value: 2 },
    ({ close, input, strategy }) => {
      const sma = ta.sma(close, input.int(5, "Length"));
      strategy.entry("Long", "long", { when: ta.crossover(close, sma) });
      strategy.close("Long", { when: ta.crossunder(close, sma) });
    },
  );

  it("produces the same trades and equity as the low-level engine loop", async () => {
    const engine = await lowLevelBacktest();
    const output = await smaCross.backtest(bars);

    expect(engine.getClosedTrades().length).toBeGreaterThan(0);
    expect(output.trades).toEqual(engine.getClosedTrades());
    expect(output.engine.netprofit).toBe(engine.netprofit);
    expect(output.equity).toHaveLength(bars.length);
    expect(output.equity.at(-1)).toBe(engine.equity);
  });

  it("accepts plain booleans as conditions and plots alongside orders", async () => {
    const script = defineStrategy(
      "Bool",
      { initial_capital: 1000 },
      ({ close, bar_index, strategy, plot }) => {
        strategy.entry("L", "long", { qty: 1, when: bar_index.at(0) === 0 });
        plot(close, "Close");
      },
    );
    const output = await script.backtest(closesToBars([10, 11, 12]));
    expect(output.engine.position_size).toBe(1);
    expect(output.engine.getOpenTrades()[0]?.entryPrice).toBe(10.5);
    expect(output.values["Close"]).toEqual([10, 11, 12]);
  });

  it("rejects non-boolean conditions (e.g. a number) instead of coercing", async () => {
    const script = defineStrategy("Bad", {}, ({ close, strategy }) => {
      strategy.entry("L", "long", { when: close as unknown as boolean });
    });
    await expect(script.backtest(closesToBars([1, 2]))).rejects.toThrow(/boolean/);
  });

  it("refuses to infer a quantity for non-fixed default sizing", async () => {
    const script = defineStrategy(
      "Pct",
      { default_qty_type: "percent_of_equity" },
      ({ strategy }) => {
        strategy.entry("L", "long");
      },
    );
    await expect(script.backtest(closesToBars([1, 2]))).rejects.toThrow(/qty/);
  });

  it("refuses unconfirmed bars because the engine has no realtime rollback", async () => {
    const open = closesToBars([1, 2]).map((b, i) => (i === 1 ? { ...b, isClosed: false } : b));
    await expect(smaCross.backtest(open)).rejects.toThrow(/confirmed/);
  });

  it("protects entries with an exit bracket identical to the engine", async () => {
    const protectedBars = closesToBars(CLOSES);
    const bracket = defineStrategy(
      "Bracket",
      { initial_capital: 10_000, default_qty_value: 1 },
      ({ close, strategy }) => {
        const sma = ta.sma(close, 5);
        strategy.entry("Long", "long", { when: ta.crossover(close, sma) });
        strategy.exit("Protect", { from_entry: "Long", profit: 4, loss: 2 });
      },
    );

    const engine = new StrategyEngine();
    engine.configure({ title: "Bracket", initial_capital: 10_000, default_qty_value: 1 });
    engine.setMintick(0.5);
    await runLowLevel(protectedBars, (ctx) => {
      engine.processBar(ctx.bar);
      if (ta.crossover(ctx.close, ta.sma(ctx.close, 5)).value) engine.entry("Long", "long", 1);
      engine.exit("Protect", "Long", undefined, { profit: 4, loss: 2 });
    });

    const output = await bracket.backtest(protectedBars, { mintick: 0.5 });
    expect(output.trades.length).toBeGreaterThan(0);
    expect(output.trades).toEqual(engine.getClosedTrades());
    await expect(bracket.backtest(protectedBars)).rejects.toThrow(/mintick/);
  });

  it("restores the previously active strategy engine", async () => {
    const host = new StrategyEngine();
    setActiveStrategyEngine(host);
    try {
      await smaCross.backtest(bars);
      expect(requireStrategyEngine()).toBe(host);
    } finally {
      setActiveStrategyEngine(undefined);
    }
  });
});
