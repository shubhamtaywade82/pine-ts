/**
 * Indicator authoring helpers — concise factories for `InputConfig` and
 * `PlotConfig` so an indicator definition reads like a declarative spec.
 *
 * See `src/registry/indicators/*.ts` for usage, and
 * `src/registry/types.ts` for the contract these factories build.
 */

import type {
  BoolInputConfig,
  ColorInputConfig,
  Indicator,
  IndicatorMetadata,
  InputConfig,
  NumberInputConfig,
  PlotConfig,
  PlotKind,
  PlotPane,
  ResolutionInputConfig,
  SessionInputConfig,
  SourceInputConfig,
  StringInputConfig,
  SymbolInputConfig,
  TimeframeInputConfig,
} from "./types.js";

// ---------- input factories ----------

export type NumberInputExtra = Omit<
  NumberInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const intInput = (
  name: string,
  displayName: string,
  defaultValue: number,
  extra: NumberInputExtra = {},
): NumberInputConfig => ({ kind: "int", name, displayName, defaultValue, ...extra });

export const floatInput = (
  name: string,
  displayName: string,
  defaultValue: number,
  extra: NumberInputExtra = {},
): NumberInputConfig => ({ kind: "float", name, displayName, defaultValue, ...extra });

export type BoolExtra = Omit<BoolInputConfig, "kind" | "name" | "displayName" | "defaultValue">;
export const boolInput = (
  name: string,
  displayName: string,
  defaultValue: boolean,
  extra: BoolExtra = {},
): BoolInputConfig => ({ kind: "bool", name, displayName, defaultValue, ...extra });

export type StringInputExtra = Omit<
  StringInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const stringInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: StringInputExtra = {},
): StringInputConfig => ({ kind: "string", name, displayName, defaultValue, ...extra });

export type SourceInputExtra = Omit<
  SourceInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const sourceInput = (
  name: string,
  displayName: string,
  defaultValue = "close",
  extra: SourceInputExtra = {},
): SourceInputConfig => ({ kind: "source", name, displayName, defaultValue, ...extra });

export type ColorInputExtra = Omit<
  ColorInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const colorInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: ColorInputExtra = {},
): ColorInputConfig => ({ kind: "color", name, displayName, defaultValue, ...extra });

export type TimeframeInputExtra = Omit<
  TimeframeInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const timeframeInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: TimeframeInputExtra = {},
): TimeframeInputConfig => ({ kind: "timeframe", name, displayName, defaultValue, ...extra });

export type SymbolInputExtra = Omit<
  SymbolInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const symbolInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: SymbolInputExtra = {},
): SymbolInputConfig => ({ kind: "symbol", name, displayName, defaultValue, ...extra });

export type SessionInputExtra = Omit<
  SessionInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const sessionInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: SessionInputExtra = {},
): SessionInputConfig => ({ kind: "session", name, displayName, defaultValue, ...extra });

export type ResolutionInputExtra = Omit<
  ResolutionInputConfig,
  "kind" | "name" | "displayName" | "defaultValue"
>;
export const resolutionInput = (
  name: string,
  displayName: string,
  defaultValue: string,
  extra: ResolutionInputExtra = {},
): ResolutionInputConfig => ({ kind: "resolution", name, displayName, defaultValue, ...extra });

// ---------- plot factories ----------

export interface PlotOptions {
  readonly color?: string;
  readonly linewidth?: number;
  readonly style?: "solid" | "dashed" | "dotted" | "arrowed";
  readonly display?: "none" | "all" | "data_window" | "status_line" | "legend";
  readonly axis?: "left" | "right";
  readonly pane?: PlotPane;
  readonly fillBetween?: readonly [string, string];
  readonly displayName?: string;
}

const normalizePlotOptions = (
  id: string,
  kind: PlotKind,
  displayName: string | undefined,
  opts: PlotOptions = {},
): PlotConfig => {
  const plot: Writable<PlotConfig> = {
    id,
    kind,
    pane: opts.pane ?? "main",
  };
  if (displayName !== undefined) plot.displayName = displayName;
  if (opts.color !== undefined) plot.color = opts.color;
  if (opts.linewidth !== undefined) plot.linewidth = opts.linewidth;
  if (opts.style !== undefined) plot.style = opts.style;
  if (opts.display !== undefined) plot.display = opts.display;
  if (opts.axis !== undefined) plot.axis = opts.axis;
  if (opts.fillBetween !== undefined) plot.fillBetween = opts.fillBetween;
  return plot;
};

export const linePlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "line", displayName, opts);

export const histogramPlot = (
  id: string,
  displayName?: string,
  opts: PlotOptions = {},
): PlotConfig => normalizePlotOptions(id, "histogram", displayName, opts);

export const markerPlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "marker", displayName, opts);

export const hlinePlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "hline", displayName, opts);

export const fillBandPlot = (
  id: string,
  fillBetween: readonly [string, string],
  displayName?: string,
  opts: PlotOptions = {},
): PlotConfig => normalizePlotOptions(id, "fill_band", displayName, { ...opts, fillBetween });

export const bgcolorPlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "bgcolor", displayName, opts);

export const barcolorPlot = (
  id: string,
  displayName?: string,
  opts: PlotOptions = {},
): PlotConfig => normalizePlotOptions(id, "barcolor", displayName, opts);

export const candlePlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "candle", displayName, opts);

export const barPlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "bar", displayName, opts);

export const areaPlot = (id: string, displayName?: string, opts: PlotOptions = {}): PlotConfig =>
  normalizePlotOptions(id, "area", displayName, opts);

// ---------- indicator factory ----------

/**
 * Defines an indicator from declarative metadata + a `calculate` function.
 * The `overlay` flag is computed from `category` (oscillator/volume → sub pane,
 * overlay/trend/bands/momentum/volatility → main pane) but can be overridden.
 */
export const defineIndicator = (
  spec: {
    id: string;
    name: string;
    category: IndicatorMetadata["category"];
    description?: string;
    version?: string;
    author?: string;
    tags?: readonly string[];
    inputs: readonly InputConfig[];
    plots: readonly PlotConfig[];
    overlay?: boolean;
    screenshot?: string;
  } & Pick<Indicator, "calculate">,
): Indicator => {
  const overlay = spec.overlay ?? defaultOverlayForCategory(spec.category);
  // Build a writable metadata first, then narrow to IndicatorMetadata after
  // the optional fields are populated (avoids `exactOptionalPropertyTypes`
  // mismatches when fields are `string | undefined`).
  const metadata: Writable<IndicatorMetadata> = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    overlay,
    inputs: spec.inputs,
    plots: spec.plots,
  };
  if (spec.description !== undefined) metadata.description = spec.description;
  if (spec.version !== undefined) metadata.version = spec.version;
  if (spec.author !== undefined) metadata.author = spec.author;
  if (spec.tags !== undefined) metadata.tags = spec.tags;
  if (spec.screenshot !== undefined) metadata.screenshot = spec.screenshot;
  return { metadata, calculate: spec.calculate };
};

/** Internal helper type that strips `readonly` for incremental population. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Returns the default `overlay` flag for a category:
 * - `oscillator` / `volume` → `false` (sub pane).
 * - everything else → `true` (overlay on the price pane).
 */
const defaultOverlayForCategory = (category: IndicatorMetadata["category"]): boolean =>
  category === "oscillator" || category === "volume" ? false : true;
