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
import * as ta from "../ta/index.js";
import { alert, alertcondition, resetGlobalState, type AlertFrequency } from "../global/index.js";
import { createDraw, type ScriptDraw } from "./draw.js";
import { startLive, type LiveIndicator, type LiveRun } from "./live.js";
import { SecurityResolver, type HtfEvaluator, type HtfBarLoader } from "./security.js";
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
  BarColor,
  BoxShape,
  LabelPosition,
  LabelShape,
  LabelSize,
  LineShape,
  ScriptShape,
  ScriptTable,
  ShapeDraw,
  ShapeLineStyle,
  TableCell,
  TablePosition,
} from "./shapes.js";
export type { LiveIndicator } from "./live.js";
export type { HtfBarLoader } from "./security.js";
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
export type {
  CloseOptions,
  Condition,
  EntryOptions,
  ExitOptions,
  StrategyApi,
  StrategyOrders,
  WhenOptions,
} from "./strategy-orders.js";
export {
  defineStrategy,
  type BacktestOptions,
  type BacktestOutput,
  type StrategyOptions,
  type StrategyScript,
} from "./strategy.js";

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
  /**
   * Higher-timeframe value of `expression` from the previous closed bar of
   * `timeframe` ("15", "60", "240", "D"), like `request.security(..., expr[1],
   * lookahead_on)`; undefined before the first closed bar. Available in
   * `indicator().run()`; a bound (realtime) execution returns undefined.
   */
  readonly security: <T>(timeframe: string, expression: (api: ScriptApi) => T) => T | undefined;
  /** Rollback-safe drawings of `smc.*` results (BOS/CHoCH lines, order-block boxes). */
  readonly draw: ScriptDraw;
  /** Pine `alert()`: emits an alert event with message and frequency. */
  readonly alert: (message: string, freq?: AlertFrequency) => void;
  /** Pine `alertcondition()`: registers or evaluates a named alert condition. */
  readonly alertcondition: (condition: boolean, title?: string, message?: string) => void;
}

export interface IndicatorOptions {
  /** Pine `overlay`: plots on the price pane. Pine's default is `false`. */
  readonly overlay?: boolean;
}

export interface RunOptions {
  /** Input overrides keyed by input title. Unknown titles are rejected. */
  readonly inputs?: InputsBag;
  /** Custom loader for higher-timeframe bars (e.g. from exchange REST API). Falls back to resampling chart bars. */
  readonly getHtfBars?: HtfBarLoader;
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
  /** `run()` once, then `update(bars)` re-executes only what changed on a live chart. */
  live(bars: readonly Bar[], options?: RunOptions): Promise<LiveIndicator<ScriptOutput>>;
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
  const [options, body] = splitArgs<IndicatorOptions, ScriptApi>(optionsOrBody, maybeBody);
  const record = (
    runOptions: RunOptions,
    security?: SecurityResolver,
  ): [ScriptRecorder, PineScript] => {
    const recorder = new ScriptRecorder(runOptions.inputs ?? {}, options.overlay ? "main" : "sub");
    return [
      recorder,
      createScript(recorder, (ctx) => {
        security?.beginBar();
        body(createApi(ctx, recorder, security));
      }),
    ];
  };
  const runAll = async (
    bars: readonly Bar[],
    runOptions: RunOptions,
  ): Promise<LiveRun<ScriptOutput>> => {
    resetGlobalState();
    const security = new SecurityResolver(bars, runOptions.getHtfBars);
    let [recorder, script] = record(runOptions, security);
    let runtime = await runHistorical(script, bars);
    // security() calls return undefined until their timeframes are computed; then run again.
    if (security.hasPending) {
      await security.resolve(evaluateOnBars);
      [recorder, script] = record(runOptions, security);
      runtime = await runHistorical(script, bars);
    }
    recorder.assertOverridesDeclared();
    return { output: () => recorder.output(), script, runtime, security };
  };
  return {
    kind: "indicator",
    title,
    options,
    bind: (runOptions = {}) => {
      const [recorder, script] = record(runOptions);
      return { script, output: () => recorder.output() };
    },
    run: async (bars, runOptions = {}) => (await runAll(bars, runOptions)).output(),
    live: (bars, runOptions = {}) => startLive(bars, (next) => runAll(next, runOptions)),
  };
}

export const splitArgs = <TOptions extends object, TApi>(
  optionsOrBody: TOptions | ((api: TApi) => void),
  maybeBody: ((api: TApi) => void) | undefined,
): [Partial<TOptions>, (api: TApi) => void] => {
  if (typeof optionsOrBody === "function") return [{}, optionsOrBody];
  if (maybeBody === undefined) throw new TypeError("Script body function is required");
  return [optionsOrBody, maybeBody];
};

export const createScript =
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

export const createApi = (
  ctx: PineContext,
  recorder: ScriptRecorder,
  security?: SecurityResolver,
): ScriptApi => ({
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
  security: (timeframe, expression) => security?.request(timeframe, expression, ctx.bar.time),
  draw: createDraw(
    (drawing) => recorder.recordDrawing(drawing),
    () => ctx.bar_index.at(0) ?? 0,
  ),
  alert: (message: string, freq?: AlertFrequency) => alert(message, freq),
  alertcondition: (condition: boolean, title?: string, message?: string) =>
    alertcondition(condition, title, message),
});

/** Evaluates a security() expression once per higher-timeframe bar, on its own runtime. */
export const evaluateOnBars: HtfEvaluator = async (bars, expression) => {
  const evaluate = expression as (api: ScriptApi) => unknown;
  const values: unknown[] = [];
  const recorder = new ScriptRecorder({}, "sub");
  await runHistorical(
    createScript(recorder, (ctx) => {
      values[ctx.bar_index.at(0) ?? 0] = evaluate(createApi(ctx, recorder));
    }),
    bars,
  );
  return values;
};

export const runHistorical = async (script: PineScript, bars: readonly Bar[]): Promise<PineRuntime> => {
  const runtime = new PineRuntime({
    provider: new StubIndicatorProvider(bars),
    symbol: "SCRIPT",
    timeframe: "1",
  });
  await runtime.run(script, bars);
  return runtime;
};
