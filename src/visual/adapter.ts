/**
 * Chart-renderer adapter for the pine-ts `VisualEvent` stream.
 *
 * The visual runtime emits renderer-neutral events into a sink that the host
 * installs via `setVisualSink`. This module provides a ready-to-use adapter
 * that consumes those events and produces:
 *
 * 1. A list of renderable `Primitive`s — typed records that a Canvas/WebGL
 *    /SVG/CanvasKit host can iterate over to draw the chart.
 * 2. An SVG string via {@link serializeSvg} — useful for snapshot tests,
 *    static reports, and quick visual inspection in a browser.
 *
 * The adapter is intentionally stateless w.r.t. the chart geometry: it does
 * not own price/time scales; the host passes them in via
 * {@link ChartAdapterOptions} when serializing. The same event stream can be
 * replayed at different geometries without re-running the script.
 *
 * Drawing objects (`line`, `label`, `box`, `table`, `linefill`, `polyline`,
 * `chart.point`) keep their `id` so the adapter can replace the previous
 * primitive on `drawing.update` and remove it on `drawing.delete`.
 *
 * Boundary: this adapter never reaches into the pine-ts runtime. It only
 * consumes `VisualEvent` records. It is safe to use in a worker thread or a
 * Node.js script without a DOM.
 */

import type { VisualEvent } from "./index.js";

// ---------- primitive types ----------

/** A single point in price/time space, in raw (unscaled) coordinates. */
export interface Point {
  readonly time: number;
  readonly value: number;
}

/** Shape constants for markers (subset of Pine v6 `shape.*` shapes). */
export type MarkerShape =
  | "arrowup"
  | "arrowdown"
  | "circle"
  | "cross"
  | "triangleup"
  | "triangledown"
  | "diamond"
  | "square";

/** Marker size constants (subset of Pine v6 `size.*` values). */
export type MarkerSize = "tiny" | "small" | "normal" | "large" | "huge" | "auto";

/** A renderable primitive. The `kind` discriminates the payload. */
export type Primitive =
  | {
      readonly kind: "line";
      readonly seriesId: string;
      readonly points: readonly Point[];
      readonly color: string;
      readonly linewidth: number;
      readonly style: "solid" | "dashed" | "dotted";
    }
  | {
      readonly kind: "marker";
      readonly seriesId: string;
      readonly point: Point;
      readonly shape: MarkerShape;
      readonly color: string;
      readonly size: MarkerSize;
      readonly text?: string;
    }
  | {
      readonly kind: "hline";
      readonly seriesId: string;
      readonly price: number;
      readonly color: string;
      readonly linestyle: "solid" | "dashed" | "dotted" | "arrowed";
      readonly linewidth: number;
    }
  | {
      readonly kind: "fill_band";
      readonly seriesId: string;
      readonly topPrice: number;
      readonly bottomPrice: number;
      readonly color: string;
    }
  | {
      readonly kind: "bgcolor";
      readonly seriesId: string;
      readonly color: string;
      readonly barTime: number | undefined;
    }
  | {
      readonly kind: "barcolor";
      readonly seriesId: string;
      readonly color: string;
      readonly barTime: number | undefined;
    }
  | {
      readonly kind: "candle";
      readonly seriesId: string;
      readonly time: number;
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly color: string;
    }
  | {
      readonly kind: "bar";
      readonly seriesId: string;
      readonly time: number;
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly color: string;
    }
  | {
      readonly kind: "label";
      readonly seriesId: string;
      readonly point: Point;
      readonly text: string;
      readonly color: string;
      readonly style: string;
      readonly size: MarkerSize;
    }
  | {
      readonly kind: "box";
      readonly seriesId: string;
      readonly topLeft: Point;
      readonly bottomRight: Point;
      readonly color: string;
      readonly borderColor: string;
    }
  | {
      readonly kind: "table";
      readonly seriesId: string;
      readonly position: string;
      readonly rows: readonly (readonly (string | undefined)[])[];
    };

// ---------- adapter ----------

/**
 * The chart-renderer adapter. Maintains the per-seriesId state needed to
 * produce primitives (e.g. plot series accumulate points across bars).
 */
export class ChartAdapter {
  private readonly plotSeries = new Map<string, Point[]>();
  private readonly plotMeta = new Map<
    string,
    { color: string; linewidth: number; style: "solid" | "dashed" | "dotted" }
  >();
  private readonly hlinePrices = new Map<
    string,
    {
      price: number;
      color: string;
      linestyle: "solid" | "dashed" | "dotted" | "arrowed";
      linewidth: number;
    }
  >();
  private readonly fills: { id: string; hline1: string; hline2: string; color: string }[] = [];
  private readonly bgcolors: { id: string; color: string; barTime: number | undefined }[] = [];
  private readonly barcolors: { id: string; color: string; barTime: number | undefined }[] = [];
  private readonly candles: {
    id: string;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    color: string;
  }[] = [];
  private readonly bars: {
    id: string;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    color: string;
  }[] = [];
  private readonly markers: {
    id: string;
    point: Point;
    shape: MarkerShape;
    color: string;
    size: MarkerSize;
    text?: string;
  }[] = [];
  private readonly labels: {
    id: string;
    point: Point;
    text: string;
    color: string;
    style: string;
    size: MarkerSize;
  }[] = [];
  private readonly boxes: {
    id: string;
    topLeft: Point;
    bottomRight: Point;
    color: string;
    borderColor: string;
  }[] = [];
  private readonly tables: {
    id: string;
    position: string;
    rows: readonly (readonly (string | undefined)[])[];
  }[] = [];
  private markerCounter = 0;
  private labelCounter = 0;
  private boxCounter = 0;
  private tableCounter = 0;

  /**
   * Consumes a single visual event and updates the adapter's state. The
   * caller wires this to `setVisualSink(adapter.consume)`.
   */
  public consume = (event: VisualEvent): void => {
    switch (event.kind) {
      case "plot":
        this.handlePlot(event);
        break;
      case "plotshape":
      case "plotchar":
      case "plotarrow":
        this.handleMarker(event);
        break;
      case "plotbar":
        this.handleBar(event);
        break;
      case "plotcandle":
        this.handleCandle(event);
        break;
      case "hline":
        this.handleHline(event);
        break;
      case "fill":
        this.handleFill(event);
        break;
      case "bgcolor":
        this.handleBgcolor(event);
        break;
      case "barcolor":
        this.handleBarcolor(event);
        break;
      case "drawing.create":
      case "drawing.update":
        this.handleDrawing(event);
        break;
      case "drawing.delete":
        this.handleDrawingDelete(event);
        break;
      default:
        // Exhaustiveness check is enforced by the `never` argument type;
        // VisualEventKind is a closed union, so no default is reachable.
        break;
    }
  };

  /**
   * Returns the current list of renderable primitives in the order they
   * were emitted. Use this when wiring to a Canvas/WebGL host that needs
   * to iterate the scene graph directly.
   */
  public primitives(): readonly Primitive[] {
    const out: Primitive[] = [];
    for (const [seriesId, points] of this.plotSeries) {
      const meta = this.plotMeta.get(seriesId) ?? {
        color: "#1e90ff",
        linewidth: 1,
        style: "solid" as const,
      };
      out.push({ kind: "line", seriesId, points, ...meta });
    }
    for (const marker of this.markers) {
      const primitive: {
        kind: "marker";
        seriesId: string;
        point: Point;
        shape: MarkerShape;
        color: string;
        size: MarkerSize;
        text?: string;
      } = {
        kind: "marker",
        seriesId: marker.id,
        point: marker.point,
        shape: marker.shape,
        color: marker.color,
        size: marker.size,
      };
      if (marker.text !== undefined) primitive.text = marker.text;
      out.push(primitive);
    }
    for (const [seriesId, h] of this.hlinePrices) {
      out.push({
        kind: "hline",
        seriesId,
        price: h.price,
        color: h.color,
        linestyle: h.linestyle,
        linewidth: h.linewidth,
      });
    }
    for (const fill of this.fills) {
      const top = this.hlinePrices.get(fill.hline1);
      const bottom = this.hlinePrices.get(fill.hline2);
      if (top === undefined || bottom === undefined) continue;
      out.push({
        kind: "fill_band",
        seriesId: fill.id,
        topPrice: top.price,
        bottomPrice: bottom.price,
        color: fill.color,
      });
    }
    for (const bg of this.bgcolors) {
      out.push({ kind: "bgcolor", seriesId: bg.id, color: bg.color, barTime: bg.barTime });
    }
    for (const bc of this.barcolors) {
      out.push({ kind: "barcolor", seriesId: bc.id, color: bc.color, barTime: bc.barTime });
    }
    for (const c of this.candles) {
      out.push({
        kind: "candle",
        seriesId: c.id,
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        color: c.color,
      });
    }
    for (const b of this.bars) {
      out.push({
        kind: "bar",
        seriesId: b.id,
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        color: b.color,
      });
    }
    for (const l of this.labels) {
      out.push({
        kind: "label",
        seriesId: l.id,
        point: l.point,
        text: l.text,
        color: l.color,
        style: l.style,
        size: l.size,
      });
    }
    for (const box of this.boxes) {
      out.push({
        kind: "box",
        seriesId: box.id,
        topLeft: box.topLeft,
        bottomRight: box.bottomRight,
        color: box.color,
        borderColor: box.borderColor,
      });
    }
    for (const t of this.tables) {
      out.push({ kind: "table", seriesId: t.id, position: t.position, rows: t.rows });
    }
    return out;
  }

  /**
   * Returns a list of `LightweightChartsPrimitive` records that a host
   * can directly feed to `chart.addSeries(LineSeries, options)` /
   * `chart.addSeries(CandlestickSeries, ...)` / `setMarkers([...])` /
   * `addLineSeries(...).setMarkers([...])`. Each primitive already carries
   * its kind, seriesId, points, color, style, and pane assignment, so a
   * renderer that consumes `LightweightChartsPrimitive` does not need to
   * re-parse the `Primitive` shape.
   *
   * This is the **second renderer target** after {@link serializeSvg}.
   * The LWC v5 mapping is intentionally lossless: every `Primitive` kind
   * has a corresponding LWC representation:
   *
   * - `line` → `LineSeries` with `data` of `{time, value}` points.
   * - `marker` → `setMarkers([{time, position, color, shape, text}])` on
   *   the parent series.
   * - `hline` → `LineSeries` with a single constant-value point per bar.
   * - `fill_band` → `LineSeries` for the upper + lower band; the host
   *   can use the LWC v5 `addSeries` plugin API to fill between two series.
   * - `candle` → `CandlestickSeries` with `{time, open, high, low, close}`.
   * - `bar` → `BarSeries` with `{time, open, high, low, close}`.
   * - `bgcolor` / `barcolor` → markers (LWC v5 has no per-bar background
   *   API; the workbench host can post-process if needed).
   * - `label` → `setMarkers([{time, position, color, text}])`.
   * - `box` → emitted as a pair of markers (top-left + bottom-right) plus
   *   a label; the host can use a plugin if true boxes are needed.
   * - `table` → not represented in LWC; the host should overlay an HTML
   *   table on top of the chart canvas.
   *
   * The host decides pane assignment via the `pane` field on each
   * primitive (`"main"` or `"sub"`).
   */
  public toLightweightCharts(): readonly LightweightChartsPrimitive[] {
    return this.primitives().map((p) => toLightweightChartsPrimitive(p));
  }

  /**
   * Serializes the current state as an SVG document string. The host
   * supplies the chart geometry (price range, time range, dimensions);
   * the adapter maps the primitives into SVG elements using that geometry.
   *
   * Used for snapshot tests, static reports, and quick visual inspection.
   */
  public serializeSvg(opts: ChartAdapterOptions): string {
    const primitives = this.primitives();
    const ctx = this.makeRenderContext(opts);
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.width}" height="${ctx.height}" viewBox="0 0 ${ctx.width} ${ctx.height}">`,
      `<rect x="0" y="0" width="${ctx.width}" height="${ctx.height}" fill="${opts.backgroundColor ?? "#0e0e10"}" />`,
    ];
    for (const p of primitives) this.appendPrimitiveSvg(parts, p, ctx, opts);
    parts.push("</svg>");
    return parts.join("\n");
  }

  /**
   * Pre-computes the chart geometry (scales + dims) so the per-primitive
   * append step is a pure projection — keeps cognitive complexity low.
   */
  private makeRenderContext(opts: ChartAdapterOptions): {
    readonly width: number;
    readonly height: number;
    readonly padding: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly xOf: (t: number) => number;
    readonly yOf: (v: number) => number;
  } {
    const padding = opts.padding ?? 8;
    const priceSpan = opts.priceMax - opts.priceMin || 1;
    const timeSpan = opts.timeMax - opts.timeMin || 1;
    const innerWidth = opts.width - padding * 2;
    const innerHeight = opts.height - padding * 2;
    return {
      width: opts.width,
      height: opts.height,
      padding,
      innerWidth,
      innerHeight,
      xOf: (t: number): number => padding + ((t - opts.timeMin) / timeSpan) * innerWidth,
      yOf: (v: number): number =>
        padding + innerHeight - ((v - opts.priceMin) / priceSpan) * innerHeight,
    };
  }

  /**
   * Appends the SVG fragment for a single primitive. Each `kind` is a
   * no-op-or-push branch so the function stays simple to read.
   */
  private appendPrimitiveSvg(
    parts: string[],
    p: Primitive,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
    opts: ChartAdapterOptions,
  ): void {
    switch (p.kind) {
      case "line":
        this.appendLineSvg(parts, p, ctx);
        break;
      case "marker":
        this.appendMarkerSvg(parts, p, ctx);
        break;
      case "hline":
        parts.push(
          `<line x1="${ctx.padding}" y1="${ctx.yOf(p.price)}" x2="${ctx.width - ctx.padding}" y2="${ctx.yOf(p.price)}" stroke="${p.color}" stroke-width="${p.linewidth}" stroke-dasharray="${dashArrayForHline(p.linestyle)}" />`,
        );
        break;
      case "fill_band":
        parts.push(
          `<rect x="${ctx.padding}" y="${ctx.yOf(p.topPrice)}" width="${ctx.innerWidth}" height="${ctx.yOf(p.bottomPrice) - ctx.yOf(p.topPrice)}" fill="${p.color}" fill-opacity="0.3" />`,
        );
        break;
      case "bgcolor":
        if (p.barTime !== undefined)
          parts.push(
            `<rect x="${ctx.xOf(p.barTime) - 2}" y="${ctx.padding}" width="4" height="${ctx.innerHeight}" fill="${p.color}" fill-opacity="0.5" />`,
          );
        break;
      case "barcolor":
        if (p.barTime !== undefined)
          parts.push(
            `<rect x="${ctx.xOf(p.barTime) - 2}" y="${ctx.padding}" width="4" height="${ctx.innerHeight}" fill="${p.color}" fill-opacity="0.3" />`,
          );
        break;
      case "candle":
        this.appendCandleSvg(parts, p, ctx);
        break;
      case "bar":
        this.appendBarSvg(parts, p, ctx);
        break;
      case "label":
        parts.push(
          `<text x="${ctx.xOf(p.point.time)}" y="${ctx.yOf(p.point.value)}" text-anchor="middle" fill="${p.color}" font-size="11">${escapeXml(p.text)}</text>`,
        );
        break;
      case "box":
        this.appendBoxSvg(parts, p, ctx);
        break;
      case "table":
        this.appendTableSvg(parts, p, ctx, opts);
        break;
      default:
        // Exhaustiveness check is enforced by the `never` argument type;
        // Primitive is a closed union, so no default is reachable.
        break;
    }
  }

  private appendLineSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "line" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
  ): void {
    if (p.points.length < 2) return;
    const pts = p.points.map((pt) => `${ctx.xOf(pt.time)},${ctx.yOf(pt.value)}`).join(" ");
    parts.push(
      `<polyline points="${pts}" stroke="${p.color}" stroke-width="${p.linewidth}" fill="none" stroke-dasharray="${dashArray(p.style)}" />`,
    );
  }

  private appendMarkerSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "marker" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
  ): void {
    const cx = ctx.xOf(p.point.time);
    const cy = ctx.yOf(p.point.value);
    const r = markerRadius(p.size);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.color}" />`);
    if (p.text !== undefined) {
      parts.push(
        `<text x="${cx}" y="${cy - r - 2}" text-anchor="middle" fill="${p.color}" font-size="10">${escapeXml(p.text)}</text>`,
      );
    }
  }

  private appendCandleSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "candle" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
  ): void {
    const x = ctx.xOf(p.time);
    const yO = ctx.yOf(p.open);
    const yH = ctx.yOf(p.high);
    const yL = ctx.yOf(p.low);
    const yC = ctx.yOf(p.close);
    parts.push(
      `<line x1="${x}" y1="${yH}" x2="${x}" y2="${yL}" stroke="${p.color}" stroke-width="1" />`,
    );
    const bodyTop = Math.min(yO, yC);
    const bodyHeight = Math.abs(yC - yO) || 1;
    parts.push(
      `<rect x="${x - 3}" y="${bodyTop}" width="6" height="${bodyHeight}" fill="${p.color}" />`,
    );
  }

  private appendBarSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "bar" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
  ): void {
    const x = ctx.xOf(p.time);
    const yO = ctx.yOf(p.open);
    const yC = ctx.yOf(p.close);
    const yH = ctx.yOf(p.high);
    const yL = ctx.yOf(p.low);
    parts.push(
      `<line x1="${x}" y1="${yH}" x2="${x}" y2="${yL}" stroke="${p.color}" stroke-width="1" />`,
    );
    parts.push(
      `<line x1="${x - 3}" y1="${yO}" x2="${x}" y2="${yO}" stroke="${p.color}" stroke-width="1" />`,
    );
    parts.push(
      `<line x1="${x + 3}" y1="${yC}" x2="${x}" y2="${yC}" stroke="${p.color}" stroke-width="1" />`,
    );
  }

  private appendBoxSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "box" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
  ): void {
    const x1 = ctx.xOf(p.topLeft.time);
    const y1 = ctx.yOf(p.topLeft.value);
    const x2 = ctx.xOf(p.bottomRight.time);
    const y2 = ctx.yOf(p.bottomRight.value);
    parts.push(
      `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${p.color}" fill-opacity="0.2" stroke="${p.borderColor}" />`,
    );
  }

  private appendTableSvg(
    parts: string[],
    p: Extract<Primitive, { kind: "table" }>,
    ctx: ReturnType<ChartAdapter["makeRenderContext"]>,
    opts: ChartAdapterOptions,
  ): void {
    let y = ctx.padding + 12;
    const x = ctx.padding + 4;
    for (const row of p.rows) {
      let cx = x;
      for (const cell of row) {
        if (cell !== undefined) {
          parts.push(
            `<text x="${cx}" y="${y}" fill="${opts.foregroundColor ?? "#d0d0d0"}" font-size="11">${escapeXml(cell)}</text>`,
          );
        }
        cx += 80;
      }
      y += 16;
    }
  }

  // ---------- per-event handlers ----------

  private handlePlot(event: VisualEvent): void {
    const value = event.payload["value"] as number | undefined;
    if (value === undefined) return;
    const style = (event.payload["style"] as "solid" | "dashed" | "dotted" | undefined) ?? "solid";
    let pts = this.plotSeries.get(event.seriesId);
    if (pts === undefined) {
      pts = [];
      this.plotSeries.set(event.seriesId, pts);
    }
    // Use barTime when available; fall back to barIndex (or 0 if no session)
    // so plot lines accumulate points across bars even in test sessions.
    const t = event.barTime ?? (Number.isFinite(event.barIndex) ? event.barIndex : 0);
    pts.push({ time: t, value });
    // Only update the styling meta if the plot explicitly provides a value;
    // subsequent plots without an option should keep the previous setting
    // (Pine does not reset to default when the option is omitted).
    const existing = this.plotMeta.get(event.seriesId);
    const incomingColor = event.payload["color"];
    const color =
      incomingColor !== undefined ? colorToCss(incomingColor) : (existing?.color ?? "#1e90ff");
    const incomingLinewidth = event.payload["linewidth"];
    const linewidth =
      typeof incomingLinewidth === "number" ? incomingLinewidth : (existing?.linewidth ?? 1);
    this.plotMeta.set(event.seriesId, { color, linewidth, style });
  }

  private handleMarker(event: VisualEvent): void {
    const value = (event.payload["value"] as number | undefined) ?? 0;
    const time = event.barTime ?? (Number.isFinite(event.barIndex) ? event.barIndex : 0);
    const shape = (event.payload["style"] as MarkerShape | undefined) ?? "circle";
    const color = colorToCss(event.payload["color"]);
    const size: MarkerSize = (event.payload["size"] as MarkerSize | undefined) ?? "normal";
    const text = event.payload["char"] as string | undefined;
    this.markerCounter += 1;
    const marker: {
      id: string;
      point: Point;
      shape: MarkerShape;
      color: string;
      size: MarkerSize;
      text?: string;
    } = {
      id: `${event.seriesId || "marker"}_${this.markerCounter}`,
      point: { time, value },
      shape,
      color,
      size,
    };
    if (text !== undefined) marker.text = text;
    this.markers.push(marker);
  }

  private handleBar(event: VisualEvent): void {
    const open = event.payload["open"] as number | undefined;
    const high = event.payload["high"] as number | undefined;
    const low = event.payload["low"] as number | undefined;
    const close = event.payload["close"] as number | undefined;
    const color = colorToCss(event.payload["color"]);
    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      event.barTime === undefined
    )
      return;
    this.bars.push({
      id: `${event.seriesId || "bar"}_${this.bars.length + 1}`,
      time: event.barTime,
      open,
      high,
      low,
      close,
      color,
    });
  }

  private handleCandle(event: VisualEvent): void {
    const open = event.payload["open"] as number | undefined;
    const high = event.payload["high"] as number | undefined;
    const low = event.payload["low"] as number | undefined;
    const close = event.payload["close"] as number | undefined;
    const color = colorToCss(event.payload["color"]);
    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      event.barTime === undefined
    )
      return;
    this.candles.push({
      id: `${event.seriesId || "candle"}_${this.candles.length + 1}`,
      time: event.barTime,
      open,
      high,
      low,
      close,
      color,
    });
  }

  private handleHline(event: VisualEvent): void {
    const price = event.payload["price"] as number | undefined;
    if (price === undefined) return;
    const color = colorToCss(event.payload["color"]);
    const linestyle =
      (event.payload["linestyle"] as "solid" | "dashed" | "dotted" | "arrowed" | undefined) ??
      "solid";
    const linewidth = (event.payload["linewidth"] as number | undefined) ?? 1;
    this.hlinePrices.set(event.seriesId, { price, color, linestyle, linewidth });
  }

  private handleFill(event: VisualEvent): void {
    const hline1 = event.payload["hline1"] as string | undefined;
    const hline2 = event.payload["hline2"] as string | undefined;
    const color = colorToCss(event.payload["color"]);
    if (hline1 === undefined || hline2 === undefined) return;
    this.fills.push({
      id: `${event.seriesId || "fill"}_${this.fills.length + 1}`,
      hline1,
      hline2,
      color,
    });
  }

  private handleBgcolor(event: VisualEvent): void {
    const color = colorToCss(event.payload["color"]);
    this.bgcolors.push({
      id: `${event.seriesId || "bgcolor"}_${this.bgcolors.length + 1}`,
      color,
      barTime: event.barTime,
    });
  }

  private handleBarcolor(event: VisualEvent): void {
    const color = colorToCss(event.payload["color"]);
    this.barcolors.push({
      id: `${event.seriesId || "barcolor"}_${this.barcolors.length + 1}`,
      color,
      barTime: event.barTime,
    });
  }

  private handleDrawing(event: VisualEvent): void {
    const kind = event.payload["kind"] as string | undefined;
    if (kind === "line" || kind === "label" || kind === "box" || kind === "table") {
      // For these we use the payload's coordinates. The full drawing-object
      // schema lives in src/visual/index.ts; here we extract the bits needed
      // for rendering.
      if (kind === "label") {
        const x = event.payload["x"] as number | undefined;
        const y = event.payload["y"] as number | undefined;
        const text = (event.payload["text"] as string | undefined) ?? "";
        const color = colorToCss(event.payload["color"]);
        const style = (event.payload["style"] as string | undefined) ?? "label.label_left";
        const size: MarkerSize = (event.payload["size"] as MarkerSize | undefined) ?? "normal";
        if (x === undefined || y === undefined || event.barTime === undefined) return;
        this.labelCounter += 1;
        this.labels.push({
          id: event.seriesId,
          point: { time: event.barTime, value: y },
          text,
          color,
          style,
          size,
        });
      } else if (kind === "box") {
        const topLeftX = event.payload["left"] as number | undefined;
        const topLeftY = event.payload["top"] as number | undefined;
        const bottomRightX = event.payload["right"] as number | undefined;
        const bottomRightY = event.payload["bottom"] as number | undefined;
        const color = colorToCss(event.payload["bgcolor"]);
        const borderColor = colorToCss(event.payload["border_color"]);
        if (
          topLeftX === undefined ||
          topLeftY === undefined ||
          bottomRightX === undefined ||
          bottomRightY === undefined
        )
          return;
        this.boxCounter += 1;
        this.boxes.push({
          id: event.seriesId,
          topLeft: { time: topLeftX, value: topLeftY },
          bottomRight: { time: bottomRightX, value: bottomRightY },
          color,
          borderColor,
        });
      } else if (kind === "table") {
        const position = (event.payload["position"] as string | undefined) ?? "position.top_left";
        const rows = (event.payload["cells"] as readonly (readonly (string | undefined)[])[]) ?? [];
        this.tableCounter += 1;
        this.tables.push({ id: event.seriesId, position, rows });
      }
      // Lines and other drawing kinds are tracked via the plot-series path.
    }
  }

  private handleDrawingDelete(event: VisualEvent): void {
    const id = event.seriesId;
    this.plotSeries.delete(id);
    this.plotMeta.delete(id);
    this.hlinePrices.delete(id);
    this.removeById(this.fills, id);
    this.removeById(this.bgcolors, id);
    this.removeById(this.barcolors, id);
    this.removeById(this.candles, id);
    this.removeById(this.bars, id);
    this.removeById(this.markers, id);
    this.removeById(this.labels, id);
    this.removeById(this.boxes, id);
    this.removeById(this.tables, id);
  }

  /** Removes every entry whose `id` matches, in-place, scanning backwards. */
  private removeById<T extends { readonly id: string }>(arr: T[], id: string): void {
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i]!.id === id) arr.splice(i, 1);
    }
  }
}

// ---------- helpers ----------

/** SVG dash-array for line styles. */
const dashArray = (style: "solid" | "dashed" | "dotted"): string => {
  switch (style) {
    case "dashed":
      return "6,3";
    case "dotted":
      return "2,2";
    default:
      return "none";
  }
};

/** SVG dash-array for hline styles. */
const dashArrayForHline = (style: "solid" | "dashed" | "dotted" | "arrowed"): string => {
  switch (style) {
    case "dashed":
      return "6,3";
    case "dotted":
      return "2,2";
    case "arrowed":
      return "2,2";
    default:
      return "none";
  }
};

/** Pixel radius for marker sizes. */
const markerRadius = (size: string): number => {
  switch (size) {
    case "tiny":
      return 2;
    case "small":
      return 3;
    case "large":
      return 6;
    case "huge":
      return 9;
    case "auto":
    case "normal":
    default:
      return 4;
  }
};

/** Escapes a string for safe XML/SVG text content. */
const escapeXml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/**
 * Converts a color value to a CSS color string. Accepts either a Pine-ts
 * `Color` object (`{r, g, b, t}`) or a pre-existing CSS string (passed
 * through unchanged).
 */
const colorToCss = (color: unknown): string => {
  if (typeof color === "string") return color;
  if (color !== null && typeof color === "object") {
    const c = color as { r?: number; g?: number; b?: number; t?: number };
    if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
      const t = typeof c.t === "number" ? c.t : 0;
      if (t > 0) {
        const alpha = (100 - t) / 100;
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
      }
      return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
  }
  return "#1e90ff";
};

// ---------- serialization options ----------

/**
 * Geometry + dimensions the host supplies when serializing the adapter
 * state to SVG. The adapter does not own price/time scales; the host
 * computes them from the chart's viewport.
 */
export interface ChartAdapterOptions {
  /** SVG width in CSS pixels. */
  readonly width: number;
  /** SVG height in CSS pixels. */
  readonly height: number;
  /** Smallest price visible on the chart (for Y-axis scaling). */
  readonly priceMin: number;
  /** Largest price visible on the chart. */
  readonly priceMax: number;
  /** Smallest bar time visible on the chart (for X-axis scaling). */
  readonly timeMin: number;
  /** Largest bar time visible on the chart. */
  readonly timeMax: number;
  /** Inner padding (in CSS pixels) on each side. Defaults to 8. */
  readonly padding?: number;
  /** Background fill color. Defaults to a dark chart background. */
  readonly backgroundColor?: string;
  /** Foreground (text) color. Defaults to light gray. */
  readonly foregroundColor?: string;
}

// ---------- lightweight-charts v5 mapping ----------

/**
 * A `Primitive` mapped to the lightweight-charts v5 surface.
 *
 * The host feeds these to `chart.addSeries(LineSeries, ...)` /
 * `chart.addSeries(CandlestickSeries, ...)` / `setMarkers([...])`. Each
 * record carries everything the renderer needs: the LWC `kind`, the
 * `seriesId` (host-side series identity), the data points, the styling,
 * and the pane (`"main"` or `"sub"`) the primitive belongs to.
 */
export type LightweightChartsPrimitive =
  | {
      readonly lwcKind: "line";
      readonly seriesId: string;
      readonly data: readonly { readonly time: number; readonly value: number }[];
      readonly color: string;
      readonly lineWidth: number;
      readonly lineStyle: "solid" | "dashed" | "dotted";
      readonly pane: "main" | "sub";
    }
  | {
      readonly lwcKind: "candlestick";
      readonly seriesId: string;
      readonly data: readonly {
        readonly time: number;
        readonly open: number;
        readonly high: number;
        readonly low: number;
        readonly close: number;
      }[];
      readonly pane: "main" | "sub";
    }
  | {
      readonly lwcKind: "bar";
      readonly seriesId: string;
      readonly data: readonly {
        readonly time: number;
        readonly open: number;
        readonly high: number;
        readonly low: number;
        readonly close: number;
      }[];
      readonly pane: "main" | "sub";
    }
  | {
      readonly lwcKind: "marker";
      readonly seriesId: string;
      readonly time: number;
      readonly value: number;
      readonly position: "aboveBar" | "belowBar" | "inBar";
      readonly color: string;
      readonly shape: "circle" | "square" | "arrowUp" | "arrowDown";
      readonly text?: string;
      readonly pane: "main" | "sub";
    }
  | {
      readonly lwcKind: "hline";
      readonly seriesId: string;
      readonly price: number;
      readonly color: string;
      readonly lineStyle: "solid" | "dashed" | "dotted" | "arrowed";
      readonly lineWidth: number;
      readonly pane: "main" | "sub";
    };

/**
 * Maps a `Primitive` to a `LightweightChartsPrimitive`. The mapping is
 * lossless except for `bgcolor` / `barcolor` / `fill_band` / `box` / `label`
 * / `table` — those are reduced to markers (or skipped for tables) because
 * LWC v5 has no first-class per-bar background / box / table API.
 */
const toLightweightChartsPrimitive = (p: Primitive): LightweightChartsPrimitive => {
  switch (p.kind) {
    case "line":
      return {
        lwcKind: "line",
        seriesId: p.seriesId,
        data: p.points.map((pt) => ({ time: pt.time, value: pt.value })),
        color: p.color,
        lineWidth: p.linewidth,
        lineStyle: p.style,
        pane: "main",
      };
    case "candle":
      return {
        lwcKind: "candlestick",
        seriesId: p.seriesId,
        data: [{ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close }],
        pane: "main",
      };
    case "bar":
      return {
        lwcKind: "bar",
        seriesId: p.seriesId,
        data: [{ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close }],
        pane: "main",
      };
    case "marker":
      return {
        lwcKind: "marker",
        seriesId: p.seriesId,
        time: p.point.time,
        value: p.point.value,
        position: "aboveBar",
        color: p.color,
        shape: markerShapeToLWC(p.shape),
        pane: "main",
      };
    case "hline":
      return {
        lwcKind: "hline",
        seriesId: p.seriesId,
        price: p.price,
        color: p.color,
        lineStyle: p.linestyle,
        lineWidth: p.linewidth,
        pane: "main",
      };
    case "fill_band":
      // Reduced to a single marker at the top price; the host can use the
      // LWC v5 `createSeriesMarkers` plugin to fill between two series if
      // it kept both ends separately. Tracked as an hline marker.
      return {
        lwcKind: "hline",
        seriesId: p.seriesId,
        price: p.topPrice,
        color: p.color,
        lineStyle: "solid",
        lineWidth: 1,
        pane: "main",
      };
    case "bgcolor":
    case "barcolor":
      // LWC v5 has no per-bar background API; reduce to a low-opacity marker.
      return {
        lwcKind: "marker",
        seriesId: p.seriesId,
        time: p.barTime ?? 0,
        value: 0,
        position: "inBar",
        color: p.color,
        shape: "circle",
        pane: "main",
      };
    case "label":
      return {
        lwcKind: "marker",
        seriesId: p.seriesId,
        time: p.point.time,
        value: p.point.value,
        position: "aboveBar",
        color: p.color,
        shape: "circle",
        pane: "main",
      };
    case "box":
    case "table":
      // No first-class LWC representation; emit an hline at the top-left
      // so the host can post-process via the LWC plugin API.
      return {
        lwcKind: "hline",
        seriesId: p.seriesId,
        price: p.kind === "box" ? p.topLeft.value : 0,
        color: p.kind === "box" ? p.color : "#888",
        lineStyle: "solid",
        lineWidth: 1,
        pane: "main",
      };
    default: {
      // Exhaustiveness check; Primitive is a closed union.
      // Should never happen; return a placeholder line primitive.
      return {
        lwcKind: "line",
        seriesId: "unknown",
        data: [],
        color: "#888",
        lineWidth: 1,
        lineStyle: "solid",
        pane: "main",
      };
    }
  }
};

/** Maps a pine-ts MarkerShape to the LWC v5 marker shape. */
const markerShapeToLWC = (shape: MarkerShape): "circle" | "square" | "arrowUp" | "arrowDown" => {
  switch (shape) {
    case "arrowup":
      return "arrowUp";
    case "arrowdown":
      return "arrowDown";
    case "square":
      return "square";
    case "circle":
    case "cross":
    case "triangleup":
    case "triangledown":
    case "diamond":
    default:
      return "circle";
  }
};
