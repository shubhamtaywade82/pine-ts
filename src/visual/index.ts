/**
 * Pine Script v6 visual runtime — `plot*`, `hline`, `fill`, `bgcolor`,
 * `barcolor`, `alertcondition`, and drawing objects (`line`, `label`, `box`,
 * `table`, `linefill`, `polyline`, `chart.point`).
 *
 * The runtime emits renderer-neutral events into a `VisualEventStream` that
 * the host wires to a concrete charting adapter (or buffers for offline
 * analysis). Drawing objects keep a `id` so re-renders on realtime updates
 * can be diffed; the runtime owns garbage collection up to the
 * `max_*_count` caps declared on the script.
 */

import { getCurrentSession } from "../core/execution-context.js";
import type { Color } from "../color/index.js";

// ---------- event stream ----------

export type VisualEventKind =
  | "plot"
  | "plotshape"
  | "plotchar"
  | "plotarrow"
  | "plotbar"
  | "plotcandle"
  | "hline"
  | "fill"
  | "bgcolor"
  | "barcolor"
  | "alertcondition"
  | "drawing.create"
  | "drawing.update"
  | "drawing.delete";

export interface VisualEvent {
  readonly kind: VisualEventKind;
  readonly seriesId: string;
  readonly barIndex: number;
  readonly barTime: number | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
}

type EventSink = (event: VisualEvent) => void;

let activeSink: EventSink | undefined;
let counter = 0;

/** Installs the active visual event sink for the current script invocation. */
export const setVisualSink = (sink: EventSink | undefined): void => {
  activeSink = sink;
};

/** Resets the per-invocation state (counter, drawing registry). */
export const resetVisualState = (): void => {
  counter = 0;
  drawings.clear();
};

const emit = (kind: VisualEventKind, seriesId: string, payload: Record<string, unknown>): void => {
  if (activeSink === undefined) return;
  const session = getCurrentSession();
  activeSink({
    kind,
    seriesId,
    barIndex: session?.barIndex ?? Number.NaN,
    barTime: session?.sources.time.at(0) ?? undefined,
    payload,
  });
};

const nextId = (prefix: string): string => {
  counter += 1;
  return `${prefix}_${counter}`;
};

// ---------- plot* family ----------

export interface PlotOptions {
  readonly color?: Color | undefined;
  readonly linewidth?: number;
  readonly style?: PlotStyle;
  readonly trackprice?: boolean;
  readonly display?: DisplayMode;
  readonly title?: string;
}

export type PlotStyle =
  "line" | "circles" | "columns" | "histogram" | "area" | "stepline" | "cross" | "shading";

export type DisplayMode = "none" | "data_window" | "all";

/**
 * `plot(series, title?, color?, linewidth?, display?)`. Emits a `plot`
 * event with the value and styling for the current bar.
 */
export const plot = (value: number, title?: string, options: PlotOptions = {}): void => {
  emit("plot", title ?? nextId("plot"), {
    value,
    title: title ?? "",
    color: options.color,
    linewidth: options.linewidth ?? 1,
    style: options.style ?? "line",
    trackprice: options.trackprice ?? false,
    display: options.display ?? "all",
  });
};

export interface PlotShapeOptions {
  readonly series?: number;
  readonly title?: string;
  readonly location?: ShapeLocation;
  readonly color?: Color;
  readonly style?: ShapeStyle;
  readonly text?: string;
  readonly textcolor?: Color;
  readonly size?: ShapeSize;
}

export type ShapeLocation =
  "abovebar" | "belowbar" | "top" | "bottom" | "absolute" | "left" | "right";

export type ShapeStyle =
  | "shapecircle"
  | "shapexcross"
  | "shapetriangleup"
  | "shapetriangledown"
  | "shapeflag"
  | "shapecross"
  | "shapearrowup"
  | "shapearrowdown"
  | "shapediamond"
  | "shapesquare";

export type ShapeSize = "tiny" | "small" | "normal" | "large" | "huge" | "auto";

/** `plotshape(series, title?, style?, location?, color?, ...)`. */
export const plotshape = (condition: boolean, options: PlotShapeOptions = {}): void => {
  if (!condition) return;
  emit("plotshape", options.title ?? nextId("plotshape"), {
    value: options.series,
    title: options.title ?? "",
    location: options.location ?? "abovebar",
    color: options.color,
    style: options.style ?? "shapecircle",
    text: options.text ?? "",
    textcolor: options.textcolor,
    size: options.size ?? "auto",
  });
};

/** `plotchar(series, title?, char?, location?, color?, ...)`. */
export const plotchar = (
  condition: boolean,
  options: {
    title?: string;
    char?: string;
    location?: ShapeLocation;
    color?: Color;
    text?: string;
  } = {},
): void => {
  if (!condition) return;
  emit("plotchar", options.title ?? nextId("plotchar"), {
    title: options.title ?? "",
    char: options.char ?? "•",
    location: options.location ?? "abovebar",
    color: options.color,
    text: options.text ?? "",
  });
};

/** `plotarrow(series, title?, colorup?, colordown?, ...)`. */
export const plotarrow = (
  value: number,
  options: {
    title?: string;
    colorup?: Color;
    colordown?: Color;
    minheight?: number;
    maxheight?: number;
  } = {},
): void => {
  emit("plotarrow", options.title ?? nextId("plotarrow"), {
    value,
    title: options.title ?? "",
    colorup: options.colorup,
    colordown: options.colordown,
    minheight: options.minheight ?? 1,
    maxheight: options.maxheight ?? 100,
  });
};

/** `plotbar(open, high, low, close, title?, color?, ...)`. */
export const plotbar = (
  o: number,
  h: number,
  l: number,
  c: number,
  options: { title?: string; color?: Color } = {},
): void => {
  emit("plotbar", options.title ?? nextId("plotbar"), {
    open: o,
    high: h,
    low: l,
    close: c,
    color: options.color,
  });
};

/** `plotcandle(open, high, low, close, title?, color?, wickcolor?, bordercolor?, ...)`. */
export const plotcandle = (
  o: number,
  h: number,
  l: number,
  c: number,
  options: {
    title?: string;
    color?: Color;
    wickcolor?: Color;
    bordercolor?: Color;
  } = {},
): void => {
  emit("plotcandle", options.title ?? nextId("plotcandle"), {
    open: o,
    high: h,
    low: l,
    close: c,
    color: options.color,
    wickcolor: options.wickcolor,
    bordercolor: options.bordercolor,
  });
};

// ---------- hline / fill / bgcolor / barcolor ----------

export type HlineStyle = "solid" | "dashed" | "dotted" | "arrowed";

/** `hline(price, title?, color?, linestyle?, linewidth?, ...)`. */
export const hline = (
  price: number,
  title?: string,
  options: { color?: Color; linestyle?: HlineStyle; linewidth?: number } = {},
): string => {
  const id = nextId("hline");
  emit("hline", id, {
    price,
    title: title ?? "",
    color: options.color,
    linestyle: options.linestyle ?? "solid",
    linewidth: options.linewidth ?? 1,
  });
  return id;
};

/** `fill(hline1, hline2, color?, title?, ...)`. */
export const fill = (
  hline1Id: string,
  hline2Id: string,
  options: { color?: Color; title?: string; transparent?: boolean } = {},
): void => {
  emit("fill", nextId("fill"), {
    hline1: hline1Id,
    hline2: hline2Id,
    color: options.color,
    title: options.title ?? "",
    transparent: options.transparent ?? false,
  });
};

/** `bgcolor(color, offset?, title?, ...)`. */
export const bgcolor = (color: Color, options: { offset?: number; title?: string } = {}): void => {
  emit("bgcolor", nextId("bgcolor"), {
    color,
    offset: options.offset ?? 0,
    title: options.title ?? "",
  });
};

/** `barcolor(color, offset?, editable?, title?, ...)`. */
export const barcolor = (
  color: Color,
  options: { offset?: number; title?: string; editable?: boolean } = {},
): void => {
  emit("barcolor", nextId("barcolor"), {
    color,
    offset: options.offset ?? 0,
    title: options.title ?? "",
    editable: options.editable ?? false,
  });
};

// ---------- drawing objects ----------

interface Drawing<T> {
  readonly id: string;
  readonly kind: string;
  payload: T;
}

const drawings = new Map<string, Drawing<unknown>>();

/** `chart.point.from_time(time, price)`. A point used by `line.*` and `polyline`. */
export const chartPoint = {
  from_time: (
    time: number,
    price: number,
  ): { time: number; price: number; index: number | undefined } => ({
    time,
    price,
    index: undefined,
  }),
  from_index: (
    index: number,
    price: number,
  ): { time: number | undefined; price: number; index: number } => ({
    time: undefined,
    price,
    index,
  }),
};

export interface LineAttrs {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  xloc?: "bar_time" | "bar_index";
  extend?: "none" | "left" | "right" | "both";
  color?: Color;
  style?: HlineStyle;
  width?: number;
}

/** `line.new(x1, y1, x2, y2, ...)`. Returns the line's id. */
export const line = {
  new: (x1: number, y1: number, x2: number, y2: number, options: LineAttrs = {}): string => {
    const id = nextId("line");
    drawings.set(id, {
      id,
      kind: "line",
      payload: { x1, y1, x2, y2, ...options },
    });
    emit("drawing.create", id, { drawingKind: "line", x1, y1, x2, y2, ...options });
    return id;
  },
  set_x1: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "x1", value });
  },
  set_x2: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "x2", value });
  },
  set_y1: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "y1", value });
  },
  set_y2: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "y2", value });
  },
  set_color: (id: string, value: Color): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "color", value });
  },
  delete: (id: string): void => {
    if (!drawings.has(id)) return;
    drawings.delete(id);
    emit("drawing.delete", id, {});
  },
  get_price: (id: string, x: number): number | undefined => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return undefined;
    const p = drawing.payload as LineAttrs;
    if (p.x1 === undefined || p.y1 === undefined || p.x2 === undefined || p.y2 === undefined)
      return undefined;
    if (p.x2 === p.x1) return p.y1;
    return p.y1 + ((p.y2 - p.y1) * (x - p.x1)) / (p.x2 - p.x1);
  },
};

/** `label.new(x, y, text?, ...)`. Returns the label's id. */
export const label = {
  new: (
    x: number,
    y: number,
    text = "",
    options: { color?: Color; textcolor?: Color; style?: LabelStyle; size?: string } = {},
  ): string => {
    const id = nextId("label");
    drawings.set(id, { id, kind: "label", payload: { x, y, text, ...options } });
    emit("drawing.create", id, { drawingKind: "label", x, y, text, ...options });
    return id;
  },
  set_text: (id: string, text: string): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "text", value: text });
  },
  set_color: (id: string, value: Color): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "color", value });
  },
  delete: (id: string): void => {
    if (!drawings.has(id)) return;
    drawings.delete(id);
    emit("drawing.delete", id, {});
  },
};

export type LabelStyle =
  | "label_left"
  | "label_right"
  | "label_up"
  | "label_down"
  | "label_lower_left"
  | "label_lower_right"
  | "label_upper_left"
  | "label_upper_right"
  | "label_center"
  | "none";

/** `box.new(left, top, right, bottom, ...)`. Returns the box's id. */
export const box = {
  new: (
    left: number,
    top: number,
    right: number,
    bottom: number,
    options: { color?: Color; bordercolor?: Color; border_width?: number; text?: string } = {},
  ): string => {
    const id = nextId("box");
    drawings.set(id, { id, kind: "box", payload: { left, top, right, bottom, ...options } });
    emit("drawing.create", id, { drawingKind: "box", left, top, right, bottom, ...options });
    return id;
  },
  set_left: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "left", value });
  },
  set_right: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "right", value });
  },
  set_top: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "top", value });
  },
  set_bottom: (id: string, value: number): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "bottom", value });
  },
  delete: (id: string): void => {
    if (!drawings.has(id)) return;
    drawings.delete(id);
    emit("drawing.delete", id, {});
  },
};

/** `table.new(position, columns, rows, ...)`. Returns the table's id. */
export const table = {
  new: (
    position: TablePosition,
    columns: number,
    rows: number,
    options: { bgcolor?: Color; border_width?: number; border_color?: Color } = {},
  ): string => {
    const id = nextId("table");
    drawings.set(id, { id, kind: "table", payload: { position, columns, rows, ...options } });
    emit("drawing.create", id, { drawingKind: "table", position, columns, rows, ...options });
    return id;
  },
  cell: (
    id: string,
    column: number,
    row: number,
    text: string,
    options: { color?: Color; text_color?: Color; width?: number; height?: number } = {},
  ): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "cell", column, row, text, ...options });
  },
  delete: (id: string): void => {
    if (!drawings.has(id)) return;
    drawings.delete(id);
    emit("drawing.delete", id, {});
  },
};

export type TablePosition =
  | "top_left"
  | "top_center"
  | "top_right"
  | "middle_left"
  | "middle_center"
  | "middle_right"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right";

/** `linefill.new(line1_id, line2_id, color)`. Returns the linefill's id. */
export const linefill = {
  new: (line1Id: string, line2Id: string, color: Color): string => {
    const id = nextId("linefill");
    drawings.set(id, { id, kind: "linefill", payload: { line1Id, line2Id, color } });
    emit("drawing.create", id, { drawingKind: "linefill", line1Id, line2Id, color });
    return id;
  },
  set_color: (id: string, value: Color): void => {
    const drawing = drawings.get(id);
    if (drawing === undefined) return;
    emit("drawing.update", id, { field: "color", value });
  },
};

/** `polyline.new(points, ...)`. Returns the polyline's id. */
export const polyline = {
  new: (
    points: readonly { time?: number; index?: number; price: number }[],
    options: { color?: Color; line_width?: number; closed?: boolean } = {},
  ): string => {
    const id = nextId("polyline");
    drawings.set(id, { id, kind: "polyline", payload: { points, ...options } });
    emit("drawing.create", id, { drawingKind: "polyline", points, ...options });
    return id;
  },
};

/** The drawing `*.all` array (subset of v6 surface). */
export const drawings_all = (): readonly string[] => [...drawings.keys()];
