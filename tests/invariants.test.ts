/**
 * Phase 0 invariant harness.
 *
 * These four invariants are the acceptance criteria for the runtime
 * foundation (see docs/SEMANTICS.md). Every scenario in the corpus must hold
 * all four, across every dataset:
 *
 * - I1 Determinism:      run(data, config) == run(data, config)
 * - I2 Replay equivalence: historical execution == realtime ticks with
 *                          rollback + final commit (recursive indicators and
 *                          `var` included; `varip` is excluded by design)
 * - I3 Truncation equivalence: full dataset @ bar N == dataset truncated at
 *                          N @ bar N (accidental lookahead detector)
 * - I4 Chunk invariance: for the same final OHLCV bar, any tick grouping
 *                          produces the same committed state after the final
 *                          commit
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

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

interface HistoryLike {
  history(): readonly unknown[];
}

interface ValueLike {
  readonly value: unknown;
}

type Observed = HistoryLike | ValueLike;

type Capture = Record<string, Observed>;

interface Scenario {
  readonly name: string;
  readonly build: (ctx: Context, capture: Capture) => void;
}

const isHistoryLike = (observed: Observed): observed is HistoryLike =>
  typeof (observed as HistoryLike).history === "function";

/**
 * Snapshot of a run: per-bar series histories plus run-end cell finals.
 * I3 compares histories only — a truncated run's final cell value is
 * legitimately different because the run ends earlier.
 */
interface RunOutputs {
  readonly histories: Record<string, readonly unknown[]>;
  readonly finals: Record<string, readonly unknown[]>;
}

const outputsOf = (capture: Capture): RunOutputs => {
  const histories: Record<string, readonly unknown[]> = {};
  const finals: Record<string, readonly unknown[]> = {};
  for (const [name, observed] of Object.entries(capture)) {
    if (isHistoryLike(observed)) histories[name] = [...observed.history()];
    else finals[name] = [observed.value];
  }
  return { histories, finals };
};

const formatValue = (value: unknown): string => {
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return String(value);
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (typeof left === "number" && typeof right === "number") {
    return (Number.isNaN(left) && Number.isNaN(right)) || left === right;
  }
  return left === right;
};

/**
 * Returns the first difference between two output maps, or undefined when
 * they are equal. NaN-aware. Invariant tests assert the result is undefined
 * so the diff text surfaces directly in vitest failures.
 */
const diffOutputs = (
  scenarioName: string,
  label: string,
  left: Record<string, readonly unknown[]>,
  right: Record<string, readonly unknown[]>,
): string | undefined => {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const name of names) {
    const a = left[name];
    const b = right[name];
    if (a === undefined || b === undefined) {
      return `${scenarioName} [${label}] ${name}: missing output (${a === undefined ? "left" : "right"})`;
    }
    if (a.length !== b.length) {
      return `${scenarioName} [${label}] ${name}: history length ${a.length} != ${b.length}\n  left:  ${a.map(formatValue).join(", ")}\n  right: ${b.map(formatValue).join(", ")}`;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!valuesEqual(a[index], b[index])) {
        return `${scenarioName} [${label}] ${name}[${index}]: ${formatValue(a[index])} != ${formatValue(b[index])}\n  left:  ${a.map(formatValue).join(", ")}\n  right: ${b.map(formatValue).join(", ")}`;
      }
    }
  }
  return undefined;
};

const runHistorical = async (bars: readonly Bar[], scenario: Scenario): Promise<RunOutputs> => {
  const capture: Capture = {};
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((ctx) => scenario.build(ctx, capture), bars);
  return outputsOf(capture);
};

/**
 * Replays the bars as a realtime stream, splitting every bar into `chunks`
 * intrabar ticks. Intermediate ticks are progressive interpolations (rolled
 * back by the runtime); the final tick carries the exact bar with
 * `isClosed: true`.
 */
const runRealtimeChunked = async (
  bars: readonly Bar[],
  scenario: Scenario,
  chunks: number,
): Promise<RunOutputs> => {
  const ticks: Bar[] = [];
  for (const bar of bars) {
    if (chunks <= 1) {
      ticks.push({ ...bar, isClosed: true });
      continue;
    }
    for (let step = 1; step < chunks; step += 1) {
      const t = step / chunks;
      ticks.push({
        ...bar,
        high: bar.open + (bar.high - bar.open) * t,
        low: bar.open + (bar.low - bar.open) * t,
        close: bar.open + (bar.close - bar.open) * t,
        volume: Math.round(bar.volume * t),
        isClosed: false,
      });
    }
    ticks.push({ ...bar, isClosed: true });
  }

  const capture: Capture = {};
  const runtime = new PineRuntime({
    provider: new Provider([], ticks),
    symbol: "TEST",
    timeframe: "1m",
    executionMode: "realtime",
  });
  await runtime.runRealtime((ctx) => scenario.build(ctx, capture));
  return outputsOf(capture);
};

/** Deterministic pseudo-random OHLCV with trends, reversals and variance. */
const syntheticBars = (count: number): readonly Bar[] => {
  let seed = 42;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const bars: Bar[] = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const open = close;
    close = close + (next() - 0.45) * 4;
    const high = Math.max(open, close) + next() * 2;
    const low = Math.min(open, close) - next() * 2;
    bars.push({
      time: 1700000000 + index * 60_000,
      open,
      high,
      low,
      close,
      volume: 100 + Math.floor(next() * 900),
      isClosed: true,
    });
  }
  return bars;
};

/** High/low/close bars with a trend reversal at each end (SAR fixture shape). */
const reversalBars: readonly Bar[] = [
  { time: 1, open: 10, high: 11, low: 9, close: 10, volume: 1, isClosed: true },
  { time: 2, open: 10, high: 12, low: 9.5, close: 11, volume: 1, isClosed: true },
  { time: 3, open: 11, high: 13, low: 10, close: 12, volume: 1, isClosed: true },
  { time: 4, open: 12, high: 12.5, low: 9.5, close: 10, volume: 1, isClosed: true },
  { time: 5, open: 10, high: 11.5, low: 8.5, close: 9, volume: 1, isClosed: true },
  { time: 6, open: 9, high: 10.5, low: 7.5, close: 8, volume: 1, isClosed: true },
  { time: 7, open: 8, high: 9.5, low: 7, close: 7.5, volume: 1, isClosed: true },
  { time: 8, open: 7.5, high: 12, low: 8, close: 11.5, volume: 1, isClosed: true },
];

const datasets: ReadonlyArray<{ name: string; bars: readonly Bar[] }> = [
  { name: "synthetic-40", bars: syntheticBars(40) },
  { name: "reversal-8", bars: reversalBars },
];

const scenarios: readonly Scenario[] = [
  {
    name: "sma-warmup",
    build: (ctx, capture) => {
      capture["sma5"] = ta.sma(ctx.close, 5);
      capture["sma10"] = ta.sma(ctx.close, 10);
    },
  },
  {
    name: "ema-recursive",
    build: (ctx, capture) => {
      capture["ema5"] = ta.ema(ctx.close, 5);
      capture["ema21"] = ta.ema(ctx.close, 21);
    },
  },
  {
    name: "rma-seeded",
    build: (ctx, capture) => {
      capture["rma7"] = ta.rma(ctx.close, 7);
    },
  },
  {
    name: "change-history",
    build: (ctx, capture) => {
      capture["change1"] = ta.change(ctx.close, 1);
      capture["change3"] = ta.change(ctx.close, 3);
    },
  },
  {
    name: "highest-window",
    build: (ctx, capture) => {
      capture["highest6"] = ta.highest(ctx.high, 6);
      capture["lowest6"] = ta.lowest(ctx.low, 6);
    },
  },
  {
    name: "crossover-multi",
    build: (ctx, capture) => {
      const fast = ta.ema(ctx.close, 3);
      const slow = ta.ema(ctx.close, 9);
      capture["fast"] = fast;
      capture["slow"] = slow;
      capture["crossover"] = ta.crossover(fast, slow);
      capture["crossunder"] = ta.crossunder(fast, slow);
    },
  },
  {
    name: "macd-chain",
    build: (ctx, capture) => {
      const result = ta.macd(ctx.close, 12, 26, 9);
      capture["macd"] = result.macdLine;
      capture["signal"] = result.signalLine;
      capture["hist"] = result.histLine;
    },
  },
  {
    name: "bb-bands",
    build: (ctx, capture) => {
      const result = ta.bb(ctx.close, 20, 2);
      capture["middle"] = result.middle;
      capture["upper"] = result.upper;
      capture["lower"] = result.lower;
    },
  },
  {
    name: "supertrend-stateful",
    build: (_ctx, capture) => {
      const result = ta.supertrend(2, 10);
      capture["supertrend"] = result.supertrend;
      capture["direction"] = result.direction;
    },
  },
  {
    name: "atr-rsi",
    build: (ctx, capture) => {
      capture["atr14"] = ta.atr(14);
      capture["rsi14"] = ta.rsi(ctx.close, 14);
    },
  },
  {
    name: "var-accumulator",
    build: (ctx, capture) => {
      const total = ctx.state.var("total", () => 0);
      total.set(total.value + ctx.close.value);
      capture["totalCell"] = total;
      capture["totalSeries"] = ctx.series("total", () => total.value);
    },
  },
  {
    name: "user-series",
    build: (ctx, capture) => {
      const fast = ta.ema(ctx.close, 5);
      const slow = ta.ema(ctx.close, 13);
      const spread = ctx.series("spread", () => fast.value - slow.value);
      capture["spread"] = spread;
      capture["above"] = ctx.series("above", () => (spread.value ?? Number.NaN) > 0);
    },
  },
];

describe("Phase 0 invariants", () => {
  for (const dataset of datasets) {
    describe(`dataset: ${dataset.name}`, () => {
      for (const scenario of scenarios) {
        it(`I1 determinism — ${scenario.name}`, async () => {
          const first = await runHistorical(dataset.bars, scenario);
          const second = await runHistorical(dataset.bars, scenario);
          expect(
            diffOutputs(scenario.name, "I1 histories", first.histories, second.histories),
            "identical runs must produce identical histories",
          ).toBeUndefined();
          expect(
            diffOutputs(scenario.name, "I1 finals", first.finals, second.finals),
            "identical runs must produce identical final state",
          ).toBeUndefined();
        });

        it(`I2 replay equivalence — ${scenario.name}`, async () => {
          const historical = await runHistorical(dataset.bars, scenario);
          const realtime = await runRealtimeChunked(dataset.bars, scenario, 3);
          expect(
            diffOutputs(scenario.name, "I2 histories", historical.histories, realtime.histories),
            "historical execution must equal realtime ticks + rollback + commit",
          ).toBeUndefined();
          expect(
            diffOutputs(scenario.name, "I2 finals", historical.finals, realtime.finals),
            "historical and realtime must end with identical committed state",
          ).toBeUndefined();
        });

        it(`I3 truncation equivalence — ${scenario.name}`, async () => {
          const full = await runHistorical(dataset.bars, scenario);
          const checkpoints = [5, 13, 27, dataset.bars.length - 1];
          for (const upto of checkpoints) {
            if (upto >= dataset.bars.length) continue;
            const truncated = await runHistorical(dataset.bars.slice(0, upto + 1), scenario);
            for (const [name, values] of Object.entries(full.histories)) {
              const expected = values.slice(0, upto + 1);
              expect(
                diffOutputs(
                  scenario.name,
                  `I3@${upto}`,
                  { [name]: expected },
                  { [name]: truncated.histories[name] ?? [] },
                ),
                `full run at bar ${upto} must equal truncated run (lookahead detector)`,
              ).toBeUndefined();
            }
          }
        });

        it(`I4 chunk invariance — ${scenario.name}`, async () => {
          const single = await runRealtimeChunked(dataset.bars, scenario, 1);
          const double = await runRealtimeChunked(dataset.bars, scenario, 2);
          const triple = await runRealtimeChunked(dataset.bars, scenario, 3);
          const quintuple = await runRealtimeChunked(dataset.bars, scenario, 5);
          expect(
            diffOutputs(scenario.name, "I4 histories", single.histories, double.histories),
            "tick grouping must not affect committed history",
          ).toBeUndefined();
          expect(
            diffOutputs(scenario.name, "I4 histories", single.histories, triple.histories),
            "tick grouping must not affect committed history",
          ).toBeUndefined();
          expect(
            diffOutputs(scenario.name, "I4 histories", single.histories, quintuple.histories),
            "tick grouping must not affect committed history",
          ).toBeUndefined();
          expect(
            diffOutputs(scenario.name, "I4 finals", single.finals, quintuple.finals),
            "tick grouping must not affect final committed state",
          ).toBeUndefined();
        });
      }
    });
  }
});
