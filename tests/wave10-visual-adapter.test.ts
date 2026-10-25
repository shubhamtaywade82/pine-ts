/**
 * Tests for the chart-renderer adapter (`src/visual/adapter.ts`).
 *
 * The adapter consumes `VisualEvent`s from the visual runtime and produces:
 * 1. A list of renderable `Primitive`s (for Canvas/WebGL hosts).
 * 2. An SVG string (for snapshot tests and static reports).
 *
 * These tests cover the round-trip: drive the visual runtime with a sink,
 * check the adapter's primitives, then check the serialized SVG.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as visual from "../src/visual/index.js";
import { ChartAdapter } from "../src/visual/adapter.js";
import { color as colorNs } from "../src/index.js";

describe("ChartAdapter", () => {
  beforeEach(() => {
    visual.resetVisualState();
    visual.setVisualSink(undefined);
  });

  it("consumes plot events and produces a 'line' primitive with accumulated points", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    visual.plot(10, "myline", { color: colorNs.rgb(255, 0, 0), linewidth: 2 });
    visual.plot(20, "myline", { color: colorNs.rgb(255, 0, 0), linewidth: 2 });
    visual.plot(30, "myline", { color: colorNs.rgb(255, 0, 0), linewidth: 2 });
    const primitives = adapter.primitives();
    expect(primitives).toHaveLength(1);
    expect(primitives[0]?.kind).toBe("line");
    if (primitives[0]?.kind !== "line") return;
    expect(primitives[0].seriesId).toBe("myline");
    // Three plot events accumulate three points (one per event).
    expect(primitives[0].points).toHaveLength(3);
    expect(primitives[0].color).toBe("rgb(255, 0, 0)");
    expect(primitives[0].linewidth).toBe(2);
  });

  it("serializes plot + hline + fill events to an SVG string", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    // Plot twice so the polyline has ≥2 points.
    visual.plot(10, "p", { color: colorNs.rgb(0, 255, 0), linewidth: 1 });
    visual.plot(20, "p");
    const id1 = visual.hline(50, "top", { linestyle: "dashed" });
    const id2 = visual.hline(40, "bot");
    visual.fill(id1, id2, { color: colorNs.rgb(255, 255, 0) });
    const svg = adapter.serializeSvg({
      width: 400,
      height: 200,
      priceMin: 0,
      priceMax: 100,
      timeMin: 0,
      timeMax: 10,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("polyline");
    expect(svg).toContain("stroke-dasharray=\"6,3\""); // hline dashed
    expect(svg).toContain("rect"); // fill band
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("serializes a marker (plotshape) as a circle in SVG", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    visual.plotshape(true, { title: "arrow", style: "shapearrowup", color: colorNs.rgb(0, 128, 255) });
    const svg = adapter.serializeSvg({
      width: 200,
      height: 100,
      priceMin: 0,
      priceMax: 1,
      timeMin: 0,
      timeMax: 1,
    });
    expect(svg).toContain("circle");
    const primitives = adapter.primitives();
    expect(primitives[0]?.kind).toBe("marker");
  });

  it("serializes a candle as a vertical line + body rect", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    visual.plotcandle(1, 2, 0.5, 1.5, { color: colorNs.rgb(255, 0, 0) });
    const svg = adapter.serializeSvg({
      width: 200,
      height: 100,
      priceMin: 0,
      priceMax: 3,
      timeMin: 0,
      timeMax: 2,
    });
    expect(svg).toContain("rect");
  });

  it("handles bgcolor and barcolor as vertical strips", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    visual.bgcolor(colorNs.rgb(255, 255, 0));
    visual.barcolor(colorNs.rgb(0, 255, 0));
    const primitives = adapter.primitives();
    expect(primitives).toHaveLength(2);
    expect(primitives[0]?.kind).toBe("bgcolor");
    expect(primitives[1]?.kind).toBe("barcolor");
  });

  it("escaping XML special chars in label text", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    // Inject a label directly via the consume sink with a malicious text.
    adapter.consume({
      kind: "drawing.create",
      seriesId: "lbl1",
      barIndex: 0,
      barTime: 1,
      payload: { kind: "label", x: 1, y: 50, text: "<script>alert('xss')</script>", color: "#fff", style: "label.style_label_left", size: "normal" },
    });
    const svg = adapter.serializeSvg({
      width: 200,
      height: 100,
      priceMin: 0,
      priceMax: 100,
      timeMin: 0,
      timeMax: 10,
    });
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>alert");
  });

  it("drawing.delete removes the primitive from the adapter", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    visual.plot(10, "p1");
    expect(adapter.primitives()).toHaveLength(1);
    adapter.consume({
      kind: "drawing.delete",
      seriesId: "p1",
      barIndex: 0,
      barTime: undefined,
      payload: {},
    });
    expect(adapter.primitives()).toHaveLength(0);
  });

  it("line and hline style produce different SVG dash-arrays", () => {
    const adapter = new ChartAdapter();
    visual.setVisualSink(adapter.consume);
    const idSolid = visual.hline(10, "solidline", { linestyle: "solid" });
    const idDashed = visual.hline(20, "dashedline", { linestyle: "dashed" });
    const idDotted = visual.hline(30, "dottedline", { linestyle: "dotted" });
    // hline returns an auto-generated id like "hline_1"; titles are metadata.
    expect(idSolid.startsWith("hline_")).toBe(true);
    expect(idDashed.startsWith("hline_")).toBe(true);
    expect(idDotted.startsWith("hline_")).toBe(true);
    const svg = adapter.serializeSvg({
      width: 200,
      height: 100,
      priceMin: 0,
      priceMax: 50,
      timeMin: 0,
      timeMax: 10,
    });
    expect(svg).toContain('stroke-dasharray="none"');
    expect(svg).toContain('stroke-dasharray="6,3"');
    expect(svg).toContain('stroke-dasharray="2,2"');
  });

  it("primitives() returns an empty array when no events have been consumed", () => {
    const adapter = new ChartAdapter();
    expect(adapter.primitives()).toEqual([]);
  });

  it("serializeSvg produces a valid empty SVG when no events", () => {
    const adapter = new ChartAdapter();
    const svg = adapter.serializeSvg({
      width: 100,
      height: 50,
      priceMin: 0,
      priceMax: 1,
      timeMin: 0,
      timeMax: 1,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<rect");
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
