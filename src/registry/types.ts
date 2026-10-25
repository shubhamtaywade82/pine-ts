/**
 * Pine-ts indicator registry — declarative metadata model for indicators
 * and strategies. The shape mirrors lightweight-charts-indicators (1713
 * indicators use this exact `inputConfig` / `plotConfig` / `metadata` /
 * `calculate` shape) so a future chart workbench can list + configure +
 * render any indicator generically.
 *
 * The registry is the GLUE LAYER between:
 *  - The pine-ts runtime (the `ta.*` / `math.*` / `request.*` built-ins).
 *  - A chart workbench UI (Wave 14) that lists indicators in a sidebar,
 *    renders an input form from `inputConfig`, and plots `plotConfig`
 *    outputs.
 *  - A strategy backtest workbench (Wave 16+) that runs an indicator
 *    across historical bars and feeds the results to the strategy engine.
 *
 * Indicators are TypeScript modules exporting an `Indicator` object. There
 * is no Pine source parser (Phase 7 is deferred indefinitely); indicators
 * are authored in TypeScript with full type safety + IDE autocomplete.
 *
 * Authoring example (RSI):
 *
 * ```ts
 * import { ta } from "../index.js";
 * import { defineIndicator, sourceInput, intInput, linePlot } from "./define.js";
 *
 * export const rsi = defineIndicator({
 *   id: "rsi",
 *   name: "Relative Strength Index",
 *   category: "oscillator",
 *   description: "Wilder's RSI. Returns a value in [0, 100].",
 *   inputs: [
 *     sourceInput("source", "Source", "close"),
 *     intInput("length", "Length", 14, { min: 1, max: 2000 }),
 *   ],
 *   plots: [
 *     linePlot("main", "RSI", { color: "#7e57c2", pane: "sub" }),
 *     linePlot("upper", "Upper Band", { color: "#888", style: "dotted", pane: "sub" }),
 *     linePlot("lower", "Lower Band", { color: "#888", style: "dotted", pane: "sub" }),
 *   ],
 *   calculate: ({ ctx, inputs }) => ({
 *     main: ta.rsi(resolveSource(ctx, inputs.source), inputs.length).at(0),
 *     upper: 70,
 *     lower: 30,
 *   }),
 * });
 * ```
 */

import type { PineContext } from "../core/context.js";
import type { Bar } from "../core/types.js";

// ---------- input config ----------

/** Type of an indicator input. Drives the form rendering in the workbench UI. */
export type InputKind =
  | "int"
  | "float"
  | "bool"
  | "string"
  | "source"
  | "color"
  | "timeframe"
  | "symbol"
  | "session"
  | "resolution";

/** Common fields every input shares. */
export interface InputConfigBase<TKind extends InputKind, TValue> {
  readonly kind: TKind;
  readonly name: string;
  readonly displayName?: string;
  readonly defaultValue: TValue;
  readonly description?: string;
  readonly tooltip?: string;
  readonly hidden?: boolean;
  readonly group?: string;
  readonly deprecated?: boolean;
}

export interface NumberInputConfig extends InputConfigBase<"int" | "float", number> {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export type BoolInputConfig = InputConfigBase<"bool", boolean>;

export interface StringInputConfig extends InputConfigBase<"string", string> {
  readonly options?: readonly string[];
}

export interface SourceInputConfig extends InputConfigBase<"source", string> {
  /** Allowed source selectors; default is the full Pine set. */
  readonly options?: readonly string[];
}

export interface ColorInputConfig extends InputConfigBase<"color", string> {
  /** Allow alpha/transparency adjustment in the picker. */
  readonly alpha?: boolean;
}

export type TimeframeInputConfig = InputConfigBase<"timeframe", string>;

export interface SymbolInputConfig extends InputConfigBase<"symbol", string> {
  readonly provider?: "binance" | "dhanhq" | "auto";
}

export type SessionInputConfig = InputConfigBase<"session", string>;

export type ResolutionInputConfig = InputConfigBase<"resolution", string>;

export type InputConfig =
  | NumberInputConfig
  | BoolInputConfig
  | StringInputConfig
  | SourceInputConfig
  | ColorInputConfig
  | TimeframeInputConfig
  | SymbolInputConfig
  | SessionInputConfig
  | ResolutionInputConfig;

/** A fully-resolved inputs bag, keyed by input name. */
export type InputsBag = Record<string, unknown>;

// ---------- plot config ----------

/** The kind of plot an indicator emits. Maps to a ChartAdapter `Primitive`. */
export type PlotKind =
  | "line"
  | "histogram"
  | "marker"
  | "hline"
  | "fill_band"
  | "bgcolor"
  | "barcolor"
  | "candle"
  | "bar"
  | "area";

/** Which pane the plot belongs to: `main` overlays the price; `sub` is a separate pane. */
export type PlotPane = "main" | "sub";

export interface PlotConfig {
  readonly id: string;
  readonly kind: PlotKind;
  readonly displayName?: string;
  readonly color?: string;
  readonly linewidth?: number;
  readonly style?: "solid" | "dashed" | "dotted" | "arrowed";
  readonly display?: "none" | "all" | "data_window" | "status_line" | "legend";
  readonly axis?: "left" | "right";
  readonly pane: PlotPane;
  /** When this plot is a fill_band, the two plot ids to fill between. */
  readonly fillBetween?: readonly [string, string];
}

// ---------- indicator metadata ----------

export type IndicatorCategory =
  | "overlay"
  | "oscillator"
  | "volume"
  | "trend"
  | "momentum"
  | "bands"
  | "volatility"
  | "custom";

export interface IndicatorMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string;
  readonly category: IndicatorCategory;
  readonly tags?: readonly string[];
  readonly overlay: boolean;
  readonly inputs: readonly InputConfig[];
  readonly plots: readonly PlotConfig[];
  /** Default screenshot URL for the workbench UI; can be omitted. */
  readonly screenshot?: string;
}

// ---------- indicator calculate ----------

/**
 * Per-bar execution context for an indicator's `calculate` function. The
 * indicator reads source series from `ctx`, applies `ta.*` / `math.*`
 * built-ins, and returns one value per `plot` id.
 */
export interface IndicatorContext {
  readonly ctx: PineContext;
  readonly inputs: InputsBag;
}

/**
 * Per-bar indicator result: a map of `plot.id` → value (number or `undefined`
 * for na). The registry / chart workbench reads each plot's value by id and
 * routes it to the correct primitive in the chart renderer.
 */
export type IndicatorResult = Record<string, number | undefined>;

/**
 * An indicator — declarative metadata + a `calculate` function. The shape
 * mirrors lightweight-charts-indicators so any indicator written against
 * this contract can be rendered generically by a chart workbench.
 */
export interface Indicator {
  readonly metadata: IndicatorMetadata;
  calculate(context: IndicatorContext): IndicatorResult;
}

// ---------- indicator registry ----------

/**
 * A live indicator instance, with the resolved inputs bag. `run` drives
 * the indicator across historical bars and yields one `IndicatorResult`
 * per bar.
 */
export interface IndicatorInstance {
  readonly indicator: Indicator;
  readonly inputs: InputsBag;
  /** Returns a generator that yields one result per bar (in order). */
  run(bars: readonly Bar[]): AsyncGenerator<IndicatorResult>;
}

/**
 * The registry — list indicators, look one up by id, or instantiate one
 * with a custom inputs bag (defaults filled in for missing inputs).
 */
export interface IndicatorRegistry {
  register(indicator: Indicator): void;
  list(): readonly IndicatorMetadata[];
  get(id: string): Indicator | undefined;
  instantiate(id: string, inputs?: InputsBag): IndicatorInstance | undefined;
  /** Returns the metadata for a known id, or `undefined` if not registered. */
  metadata(id: string): IndicatorMetadata | undefined;
}

/** Default-merging helper: fill in missing inputs from their `InputConfig.defaultValue`. */
export const resolveDefaults = (
  inputs: readonly InputConfig[],
  overrides: InputsBag = {},
): InputsBag => {
  const out: InputsBag = {};
  for (const input of inputs) {
    const override = overrides[input.name];
    out[input.name] = override !== undefined ? override : input.defaultValue;
  }
  return out;
};
