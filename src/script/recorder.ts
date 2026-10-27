/**
 * Per-execution recorder for the concise authoring layer: resolves `input.*`
 * declarations against host overrides and collects `plot()` / `hline()`
 * output per bar. One recorder belongs to exactly one script execution, so
 * no input or plot state is shared between runtimes.
 */

import type { PineContext } from "../core/context.js";
import type { FloatSeries, Series } from "../core/series.js";
import { resolveSource, SOURCE_SELECTORS, type SourceSelector } from "../registry/helpers.js";
import {
  boolInput,
  floatInput,
  hlinePlot,
  intInput,
  sourceInput,
  stringInput,
  areaPlot,
  histogramPlot,
  linePlot,
  markerPlot,
} from "../registry/define.js";
import type { InputConfig, InputsBag, PlotConfig, PlotPane } from "../registry/types.js";
import { getAlertEvents, type AlertEvent } from "../global/index.js";
import { collectDrawings, type RecordedDrawing, type ScriptDrawings } from "./draw.js";

export interface NumberInputOptions {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly tooltip?: string;
  readonly group?: string;
}

export interface StringInputOptions {
  readonly options?: readonly string[];
  readonly tooltip?: string;
  readonly group?: string;
}

export interface FlagInputOptions {
  readonly tooltip?: string;
  readonly group?: string;
}

/** Pine-style `input.*` declarations. `title` is the override key. */
export interface ScriptInputs {
  int(defval: number, title: string, options?: NumberInputOptions): number;
  float(defval: number, title: string, options?: NumberInputOptions): number;
  bool(defval: boolean, title: string, options?: FlagInputOptions): boolean;
  string(defval: string, title: string, options?: StringInputOptions): string;
  source(defval: SourceSelector, title: string, options?: FlagInputOptions): FloatSeries;
}

/** A value plot() accepts: a series (current bar is read), a number, or `na`. */
export type PlotValue = Series<number> | number | undefined;

export interface ScriptPlotOptions {
  readonly color?: string;
  readonly linewidth?: number;
  readonly style?: "line" | "histogram" | "area" | "marker";
  readonly display?: "none" | "all" | "data_window" | "status_line" | "legend";
}

export interface ScriptHlineOptions {
  readonly color?: string;
  readonly linewidth?: number;
  readonly linestyle?: "solid" | "dashed" | "dotted";
}

export interface ScriptOutput {
  readonly inputs: readonly InputConfig[];
  readonly plots: readonly PlotConfig[];
  /** Plot id → value per bar, aligned with `bar_index`; `undefined` is `na`. */
  readonly values: Readonly<Record<string, readonly (number | undefined)[]>>;
  readonly drawings: ScriptDrawings;
  readonly alerts?: readonly AlertEvent[];
}

interface PlotSlot {
  readonly title: string | undefined;
  readonly config: PlotConfig;
}

export class ScriptRecorder {
  private readonly declaredInputs = new Map<string, { config: InputConfig; value: unknown }>();
  private readonly slots: PlotSlot[] = [];
  private readonly values = new Map<string, (number | undefined)[]>();
  private readonly drawingsByBar = new Map<number, RecordedDrawing[]>();
  private layoutFrozen = false;
  private callIndex = 0;
  private barIndex = 0;

  public constructor(
    private readonly overrides: InputsBag,
    private readonly pane: PlotPane,
  ) {}

  public beginBar(barIndex: number): void {
    this.barIndex = barIndex;
    this.callIndex = 0;
    // A realtime tick re-executes the open bar: its drawings start over.
    this.drawingsByBar.delete(barIndex);
  }

  public recordDrawing(drawing: RecordedDrawing): void {
    const recorded = this.drawingsByBar.get(this.barIndex) ?? [];
    recorded.push(drawing);
    this.drawingsByBar.set(this.barIndex, recorded);
  }

  /**
   * Pine only allows `plot()` / `hline()` in the global scope, so every bar
   * must make the same calls in the same order; the first completed bar
   * fixes that layout.
   */
  public endBar(): void {
    if (this.layoutFrozen && this.callIndex !== this.slots.length) {
      throw new Error(
        `plot()/hline() must be called unconditionally on every bar: expected ${this.slots.length} calls, got ${this.callIndex}`,
      );
    }
    this.layoutFrozen = true;
  }

  public inputs(ctx: () => PineContext): ScriptInputs {
    return {
      int: (defval, title, options = {}) =>
        this.declare(title, intInput(title, title, defval, options), (raw) =>
          validateNumber(title, raw, options, true),
        ),
      float: (defval, title, options = {}) =>
        this.declare(title, floatInput(title, title, defval, options), (raw) =>
          validateNumber(title, raw, options, false),
        ),
      bool: (defval, title, options = {}) =>
        this.declare(title, boolInput(title, title, defval, options), (raw) => {
          if (typeof raw !== "boolean") throw new TypeError(`Input "${title}" must be a boolean`);
          return raw;
        }),
      string: (defval, title, options = {}) =>
        this.declare(title, stringInput(title, title, defval, options), (raw) =>
          validateString(title, raw, options.options),
        ),
      source: (defval, title, options = {}) => {
        const selector = this.declare(
          title,
          sourceInput(title, title, defval, { ...options, options: SOURCE_SELECTORS }),
          (raw) => validateString(title, raw, undefined),
        );
        return resolveSource(ctx(), selector);
      },
    };
  }

  public plot(value: PlotValue, title?: string, options: ScriptPlotOptions = {}): void {
    const { style = "line", ...rest } = options;
    const factory = PLOT_FACTORIES[style];
    const id = this.slotId(title, (slotId) => factory(slotId, title, { ...rest, pane: this.pane }));
    this.record(id, readPlotValue(value));
  }

  public hline(price: number, title?: string, options: ScriptHlineOptions = {}): void {
    const { linestyle, ...rest } = options;
    const id = this.slotId(title, (slotId) =>
      hlinePlot(slotId, title, {
        ...rest,
        ...(linestyle === undefined ? {} : { style: linestyle }),
        pane: this.pane,
      }),
    );
    this.record(id, Number.isFinite(price) ? price : undefined);
  }

  /** Throws when the host supplied an override for an input the script never declared. */
  public assertOverridesDeclared(): void {
    const unknown = Object.keys(this.overrides).filter((key) => !this.declaredInputs.has(key));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown input override(s): ${unknown.join(", ")}. Declared: ${[...this.declaredInputs.keys()].join(", ") || "none"}`,
      );
    }
  }

  public output(): ScriptOutput {
    return {
      inputs: [...this.declaredInputs.values()].map((entry) => entry.config),
      plots: this.slots.map((slot) => slot.config),
      values: Object.fromEntries(this.values),
      drawings: collectDrawings(
        [...this.drawingsByBar.entries()].sort(([a], [b]) => a - b).flatMap(([, d]) => d),
      ),
      alerts: getAlertEvents(),
    };
  }

  private declare<T>(title: string, config: InputConfig, validate: (raw: unknown) => T): T {
    const existing = this.declaredInputs.get(title);
    if (existing !== undefined) {
      if (existing.config.kind !== config.kind) {
        throw new Error(
          `Input "${title}" is declared as both ${existing.config.kind} and ${config.kind}`,
        );
      }
      return existing.value as T;
    }
    const override = this.overrides[title];
    const value = validate(override === undefined ? config.defaultValue : override);
    this.declaredInputs.set(title, { config, value });
    return value;
  }

  private slotId(title: string | undefined, build: (id: string) => PlotConfig): string {
    const index = this.callIndex;
    this.callIndex += 1;
    const slot = this.slots[index];
    if (slot !== undefined) {
      if (slot.title !== title) {
        throw new Error(
          `plot()/hline() must be called unconditionally on every bar: call #${index} was "${slot.title ?? "untitled"}", now "${title ?? "untitled"}"`,
        );
      }
      return slot.config.id;
    }
    if (this.layoutFrozen) {
      throw new Error(
        `plot()/hline() must be called unconditionally on every bar: unexpected call #${index} ("${title ?? "untitled"}")`,
      );
    }
    const config = build(this.uniqueId(title ?? `plot_${index}`));
    this.slots.push({ title, config });
    return config.id;
  }

  private uniqueId(base: string): string {
    const taken = new Set(this.slots.map((slot) => slot.config.id));
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base} (${suffix})`)) suffix += 1;
    return `${base} (${suffix})`;
  }

  private record(id: string, value: number | undefined): void {
    let series = this.values.get(id);
    if (series === undefined) {
      series = [];
      this.values.set(id, series);
    }
    // Indexed by bar: a realtime tick re-executing the open bar overwrites it.
    series[this.barIndex] = value;
  }
}

const PLOT_FACTORIES = {
  line: linePlot,
  histogram: histogramPlot,
  area: areaPlot,
  marker: markerPlot,
} as const;

const readPlotValue = (value: PlotValue): number | undefined => {
  const raw = typeof value === "object" ? value.at(0) : value;
  return raw === undefined || Number.isNaN(raw) ? undefined : raw;
};

const validateNumber = (
  title: string,
  raw: unknown,
  options: NumberInputOptions,
  integer: boolean,
): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new TypeError(`Input "${title}" must be a finite number; got ${String(raw)}`);
  }
  if (integer && !Number.isInteger(raw)) {
    throw new TypeError(`Input "${title}" must be an integer; got ${raw}`);
  }
  if (options.min !== undefined && raw < options.min) {
    throw new RangeError(`Input "${title}" must be >= ${options.min}; got ${raw}`);
  }
  if (options.max !== undefined && raw > options.max) {
    throw new RangeError(`Input "${title}" must be <= ${options.max}; got ${raw}`);
  }
  return raw;
};

const validateString = (
  title: string,
  raw: unknown,
  allowed: readonly string[] | undefined,
): string => {
  if (typeof raw !== "string") {
    throw new TypeError(`Input "${title}" must be a string; got ${String(raw)}`);
  }
  if (allowed !== undefined && !allowed.includes(raw)) {
    throw new RangeError(`Input "${title}" must be one of ${allowed.join(", ")}; got "${raw}"`);
  }
  return raw;
};
