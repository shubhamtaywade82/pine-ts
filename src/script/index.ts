/**
 * Concise, Pine-shaped authoring layer over `PineRuntime` and
 * `StrategyEngine`:
 *
 * ```ts
 * export default indicator("RSI", ({ close, input, plot, hline }) => {
 *   plot(ta.rsi(close, input.int(14, "Length", { min: 1 })), "RSI");
 *   hline(70);
 *   hline(30);
 * });
 * ```
 *
 * The body runs once per bar exactly like a `PineScript`; this layer only
 * removes plumbing (context types, input bags, result objects, `.at(0)`).
 * It never changes execution: series, history, `na`, and realtime rollback
 * are the runtime's.
 */

import type { PineContext } from "../core/context.js";
import { PineRuntime, type PineScript } from "../core/runtime.js";
import type { FloatSeries, Series } from "../core/series.js";
import type { Bar } from "../core/types.js";
import * as math from "../math/index.js";
import { StubIndicatorProvider } from "../registry/registry.js";
import type { InputsBag } from "../registry/types.js";
import {
  getActiveStrategyEngine,
  setActiveStrategyEngine,
  StrategyEngine,
  type ClosedTrade,
  type Direction,
  type StrategyDeclaration,
} from "../strategy/index.js";
import * as ta from "../ta/index.js";
import { createDraw, type ScriptDraw } from "./draw.js";
import {
  ScriptRecorder,
  type PlotValue,
  type ScriptHlineOptions,
  type ScriptInputs,
  type ScriptOutput,
  type ScriptPlotOptions,
} from "./recorder.js";

export type {
  DrawDirection,
  ScriptBox,
  ScriptDraw,
  ScriptDrawings,
  ScriptLine,
  StructureDrawOptions,
} from "./draw.js";
export type {
  FlagInputOptions,
  NumberInputOptions,
  PlotValue,
  ScriptHlineOptions,
  ScriptInputs,
  ScriptOutput,
  ScriptPlotOptions,
  StringInputOptions,
} from "./recorder.js";

/** Everything an indicator body needs, without imports or type annotations. */
export interface ScriptApi {
  /** Full Pine context: the escape hatch to `state`, `series`, `scope`, `barstate`, ... */
  readonly ctx: PineContext;
  readonly ta: typeof ta;
  readonly math: typeof math;
  readonly open: FloatSeries;
  readonly high: FloatSeries;
  readonly low: FloatSeries;
  readonly close: FloatSeries;
  readonly volume: FloatSeries;
  readonly hl2: FloatSeries;
  readonly hlc3: FloatSeries;
  readonly hlcc4: FloatSeries;
  readonly ohlc4: FloatSeries;
  readonly time: Series<number>;
  readonly bar_index: Series<number>;
  readonly input: ScriptInputs;
  /** Pine `plot()`: records the current bar's value; series are read at offset 0, NaN is `na`. */
  readonly plot: (value: PlotValue, title?: string, options?: ScriptPlotOptions) => void;
  /** Pine `hline()`: a constant level. */
  readonly hline: (price: number, title?: string, options?: ScriptHlineOptions) => void;
  /** Rollback-safe drawings of `smc.*` results (BOS/CHoCH lines, order-block boxes). */
  readonly draw: ScriptDraw;
}

/** A condition: a plain boolean or a boolean series (its current bar is read). */
export type Condition = boolean | Series<boolean>;

export interface EntryOptions {
  /** Defaults to the declaration's `default_qty_value` when `default_qty_type` is `"fixed"`. */
  readonly qty?: number;
  readonly limit?: number;
  readonly stop?: number;
  readonly oca_name?: string;
  /** The order is placed only on bars where this is true. Omitted means always. */
  readonly when?: Condition;
}

export interface CloseOptions {
  readonly qty?: number;
  readonly when?: Condition;
}

export interface WhenOptions {
  readonly when?: Condition;
}

export interface ExitOptions {
  /** Entry id the bracket protects. */
  readonly from_entry: string;
  /** Omitted exits the whole trade. */
  readonly qty?: number;
  /** Take-profit price. */
  readonly limit?: number;
  /** Stop-loss price. */
  readonly stop?: number;
  /** Take-profit distance in ticks from the entry price (needs `mintick`). */
  readonly profit?: number;
  /** Stop-loss distance in ticks from the entry price (needs `mintick`). */
  readonly loss?: number;
  readonly oca_name?: string;
  readonly when?: Condition;
}

/** Order helpers. Each call delegates to the `StrategyEngine` method of the same name. */
export interface StrategyOrders {
  readonly engine: StrategyEngine;
  entry(id: string, direction: Direction, options?: EntryOptions): void;
  close(id: string, options?: CloseOptions): void;
  close_all(options?: WhenOptions): void;
  cancel(id: string, options?: WhenOptions): void;
  cancel_all(options?: WhenOptions): void;
  /** Take-profit / stop-loss bracket; see `StrategyEngine.exit`. */
  exit(id: string, options: ExitOptions): void;
}

export interface StrategyApi extends ScriptApi {
  readonly strategy: StrategyOrders;
}

export interface IndicatorOptions {
  /** Pine `overlay`: plots on the price pane. Pine's default is `false`. */
  readonly overlay?: boolean;
}

export type StrategyOptions = Omit<StrategyDeclaration, "title">;

export interface RunOptions {
  /** Input overrides keyed by input title. Unknown titles are rejected. */
  readonly inputs?: InputsBag;
}

export interface BacktestOptions extends RunOptions {
  /** `syminfo.mintick`; required when `strategy.exit` uses `profit`/`loss` ticks. */
  readonly mintick?: number;
  /**
   * Overrides of the `defineStrategy()` declaration for this run (capital,
   * sizing, commission, ...), as TradingView's Properties tab overrides
   * `strategy()` arguments. The script's own `options` are left unchanged.
   */
  readonly properties?: StrategyOptions;
}

/** A bound execution: feed `script` to any `PineRuntime` (historical or realtime). */
export interface ScriptExecution {
  readonly script: PineScript;
  output(): ScriptOutput;
}

export interface IndicatorScript {
  readonly kind: "indicator";
  readonly title: string;
  readonly options: IndicatorOptions;
  /** Runs over confirmed (or one trailing open) bars and returns all plot values. */
  run(bars: readonly Bar[], options?: RunOptions): Promise<ScriptOutput>;
  bind(options?: RunOptions): ScriptExecution;
}

export interface BacktestOutput extends ScriptOutput {
  readonly engine: StrategyEngine;
  readonly trades: readonly ClosedTrade[];
  /** Engine equity after each bar's script execution. */
  readonly equity: readonly number[];
  /** Margin used in account currency after each bar's script execution. */
  readonly margin: readonly number[];
}

export interface StrategyScript {
  readonly kind: "strategy";
  readonly title: string;
  readonly options: StrategyOptions;
  backtest(bars: readonly Bar[], options?: BacktestOptions): Promise<BacktestOutput>;
}

export function indicator(title: string, body: (api: ScriptApi) => void): IndicatorScript;
export function indicator(
  title: string,
  options: IndicatorOptions,
  body: (api: ScriptApi) => void,
): IndicatorScript;
export function indicator(
  title: string,
  optionsOrBody: IndicatorOptions | ((api: ScriptApi) => void),
  maybeBody?: (api: ScriptApi) => void,
): IndicatorScript {
  const [options, body] = splitArgs(optionsOrBody, maybeBody);
  const record = (runOptions: RunOptions): [ScriptRecorder, PineScript] => {
    const recorder = new ScriptRecorder(runOptions.inputs ?? {}, options.overlay ? "main" : "sub");
    return [recorder, createScript(recorder, (ctx) => body(createApi(ctx, recorder)))];
  };
  return {
    kind: "indicator",
    title,
    options,
    bind: (runOptions = {}) => {
      const [recorder, script] = record(runOptions);
      return { script, output: () => recorder.output() };
    },
    run: async (bars, runOptions = {}) => {
      const [recorder, script] = record(runOptions);
      await runHistorical(script, bars);
      recorder.assertOverridesDeclared();
      return recorder.output();
    },
  };
}

export function defineStrategy(title: string, body: (api: StrategyApi) => void): StrategyScript;
export function defineStrategy(
  title: string,
  options: StrategyOptions,
  body: (api: StrategyApi) => void,
): StrategyScript;
export function defineStrategy(
  title: string,
  optionsOrBody: StrategyOptions | ((api: StrategyApi) => void),
  maybeBody?: (api: StrategyApi) => void,
): StrategyScript {
  const [options, body] = splitArgs(optionsOrBody, maybeBody);
  return {
    kind: "strategy",
    title,
    options,
    backtest: async (bars, runOptions = {}) => {
      // The engine fills orders without realtime rollback, so an unconfirmed
      // bar would turn every tick into a permanent fill.
      if (bars.some((bar) => bar.isClosed === false)) {
        throw new Error("backtest() requires confirmed bars only; drop the open bar first");
      }
      const engine = new StrategyEngine();
      engine.configure({ ...options, ...runOptions.properties, title });
      if (runOptions.mintick !== undefined) engine.setMintick(runOptions.mintick);
      const orders = createOrders(engine);
      const recorder = new ScriptRecorder(
        runOptions.inputs ?? {},
        options.overlay ? "main" : "sub",
      );
      const equity: number[] = [];
      const margin: number[] = [];
      const script = createScript(recorder, (ctx) => {
        // Orders queued on the previous bar fill against this bar first.
        engine.processBar(ctx.bar);
        body({ ...createApi(ctx, recorder), strategy: orders });
        equity.push(engine.equity);
        margin.push(engine.margin_used);
      });

      const previous = getActiveStrategyEngine();
      setActiveStrategyEngine(engine);
      try {
        await runHistorical(script, bars);
      } finally {
        setActiveStrategyEngine(previous);
      }
      recorder.assertOverridesDeclared();
      return { ...recorder.output(), engine, trades: engine.getClosedTrades(), equity, margin };
    },
  };
}

const splitArgs = <TOptions extends object, TApi>(
  optionsOrBody: TOptions | ((api: TApi) => void),
  maybeBody: ((api: TApi) => void) | undefined,
): [Partial<TOptions>, (api: TApi) => void] => {
  if (typeof optionsOrBody === "function") return [{}, optionsOrBody];
  if (maybeBody === undefined) throw new TypeError("Script body function is required");
  return [optionsOrBody, maybeBody];
};

const createScript =
  (recorder: ScriptRecorder, execute: (ctx: PineContext) => void): PineScript =>
  (ctx) => {
    const barIndex = ctx.bar_index.at(0) ?? 0;
    recorder.beginBar(barIndex);
    try {
      execute(ctx);
      recorder.endBar();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Script error on bar ${barIndex}: ${message}`, { cause: error });
    }
  };

const createApi = (ctx: PineContext, recorder: ScriptRecorder): ScriptApi => ({
  ctx,
  ta,
  math,
  open: ctx.open,
  high: ctx.high,
  low: ctx.low,
  close: ctx.close,
  volume: ctx.volume,
  hl2: ctx.hl2,
  hlc3: ctx.hlc3,
  hlcc4: ctx.hlcc4,
  ohlc4: ctx.ohlc4,
  time: ctx.time,
  bar_index: ctx.bar_index,
  input: recorder.inputs(() => ctx),
  plot: (value, title, options) => recorder.plot(value, title, options),
  hline: (price, title, options) => recorder.hline(price, title, options),
  draw: createDraw(
    (drawing) => recorder.recordDrawing(drawing),
    () => ctx.bar_index.at(0) ?? 0,
  ),
});

const runHistorical = async (script: PineScript, bars: readonly Bar[]): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new StubIndicatorProvider(bars),
    symbol: "SCRIPT",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

const isTrue = (condition: Condition | undefined): boolean => {
  if (condition === undefined) return true;
  if (typeof condition === "boolean") return condition;
  if (typeof condition === "object" && typeof condition.at === "function") {
    const value: unknown = condition.at(0);
    // A v6 bool is never na: a missing value reads as false.
    if (value === undefined || typeof value === "boolean") return value === true;
  }
  throw new TypeError(
    `Order condition must be a boolean or boolean series; got ${typeof condition}`,
  );
};

const defaultQty = (engine: StrategyEngine): number => {
  const { default_qty_type: type = "fixed", default_qty_value: value } = engine.config;
  if (type !== "fixed" || value === undefined) {
    throw new Error(
      `strategy.entry() needs an explicit qty when default_qty_type is "${type}"; only "fixed" sizing is resolved automatically`,
    );
  }
  return value;
};

const createOrders = (engine: StrategyEngine): StrategyOrders => ({
  engine,
  entry: (id, direction, { qty, limit, stop, oca_name: ocaName, when } = {}) => {
    if (!isTrue(when)) return;
    engine.entry(id, direction, qty ?? defaultQty(engine), {
      ...(limit === undefined ? {} : { limit }),
      ...(stop === undefined ? {} : { stop }),
      ...(ocaName === undefined ? {} : { ocaName }),
    });
  },
  close: (id, { qty, when } = {}) => {
    if (isTrue(when)) engine.close(id, qty);
  },
  close_all: ({ when } = {}) => {
    if (isTrue(when)) engine.close_all();
  },
  cancel: (id, { when } = {}) => {
    if (isTrue(when)) engine.cancel(id);
  },
  exit: (
    id,
    { from_entry: fromEntry, qty, limit, stop, profit, loss, oca_name: ocaName, when },
  ) => {
    if (!isTrue(when)) return;
    engine.exit(id, fromEntry, qty, {
      ...(limit === undefined ? {} : { limit }),
      ...(stop === undefined ? {} : { stop }),
      ...(profit === undefined ? {} : { profit }),
      ...(loss === undefined ? {} : { loss }),
      ...(ocaName === undefined ? {} : { ocaName }),
    });
  },
  cancel_all: ({ when } = {}) => {
    if (isTrue(when)) engine.cancel_all();
  },
});
