import type { Bar } from "../core/types.js";
import {
  getActiveStrategyEngine,
  setActiveStrategyEngine,
  StrategyEngine,
  type ClosedTrade,
  type StrategyDeclaration,
} from "../strategy/index.js";
import { resetGlobalState } from "../global/index.js";
import { ScriptRecorder } from "./recorder.js";
import { createOrders, type StrategyApi } from "./strategy-orders.js";
import type { RunOptions, ScriptOutput } from "./index.js";
import { createApi, createScript, runHistorical, splitArgs } from "./index.js";

export type StrategyOptions = Omit<StrategyDeclaration, "title">;

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
  const [options, body] = splitArgs<StrategyOptions, StrategyApi>(optionsOrBody, maybeBody);
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
      resetGlobalState();
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
