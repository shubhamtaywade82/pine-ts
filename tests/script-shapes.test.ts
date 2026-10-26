import { describe, expect, it } from "vitest";
import { indicator, PineRuntime } from "../src/index.js";
import type { Bar } from "../src/index.js";
import { asRealtimeTicks, Provider } from "./smc-reference.js";

const bars = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: (i + 1) * 60_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10,
    isClosed: true,
  }));

describe("generic draw shapes", () => {
  it("keeps one-off shapes from every bar and only the latest shape per id", async () => {
    const script = indicator("Shapes", { overlay: true }, ({ draw, bar_index, close }) => {
      const index = bar_index.value ?? 0;
      if (index % 2 === 0)
        draw.label({ x: index, y: close.value, text: `L${index}`, position: "above" });
      draw.line({
        id: "last",
        x1: index - 1,
        y1: close.value - 1,
        x2: index + 5,
        y2: close.value,
        style: "dashed",
      });
      draw.box({
        id: "zone",
        left: index - 2,
        top: close.value + 1,
        right: index + 3,
        bottom: close.value - 1,
        fill: "#00c4ff33",
      });
    });
    const { drawings } = await script.run(bars(6));
    expect(drawings.shapes.filter((s) => s.kind === "label").map((s) => s.text)).toEqual([
      "L0",
      "L2",
      "L4",
    ]);
    const lines = drawings.shapes.filter((s) => s.kind === "line");
    expect(lines).toEqual([{ kind: "line", x1: 4, y1: 104.5, x2: 10, y2: 105.5, style: "dashed" }]);
    expect(drawings.shapes.filter((s) => s.kind === "box")).toHaveLength(1);
  });

  it("removes an id's shape when it is deleted later", async () => {
    const script = indicator("Delete", ({ draw, bar_index }) => {
      if (bar_index.value === 0) draw.label({ id: "tag", x: 0, y: 1, text: "gone" });
      if (bar_index.value === 2) draw.remove("tag");
    });
    const { drawings } = await script.run(bars(4));
    expect(drawings.shapes).toEqual([]);
  });

  it("records per-bar background and bar colours and the latest table", async () => {
    const script = indicator("Colors", { overlay: true }, ({ draw, bar_index }) => {
      const index = bar_index.value ?? 0;
      if (index > 0) draw.bgcolor("#00ff0010");
      if (index === 1) draw.barcolor("#ff0000");
      draw.table({
        position: "top_right",
        rows: [[{ text: "bar" }, { text: String(index), bg: "#123456" }]],
      });
    });
    const { drawings } = await script.run(bars(3));
    expect(drawings.bgcolors).toEqual([
      { bar: 1, color: "#00ff0010" },
      { bar: 2, color: "#00ff0010" },
    ]);
    expect(drawings.barcolors).toEqual([{ bar: 1, color: "#ff0000" }]);
    expect(drawings.table?.rows[0]?.[1]).toEqual({ text: "2", bg: "#123456" });
  });

  it("does not duplicate shapes when the open bar is recalculated by realtime ticks", async () => {
    const script = () =>
      indicator("Ticks", { overlay: true }, ({ draw, bar_index, close }) => {
        draw.label({ x: bar_index.value ?? 0, y: close.value, text: "x" });
        draw.line({
          id: "level",
          x1: 0,
          y1: close.value,
          x2: bar_index.value ?? 0,
          y2: close.value,
        });
      });
    const sample = bars(5);
    const historical = await script().run(sample);
    const execution = script().bind();
    await new PineRuntime({
      provider: new Provider(asRealtimeTicks(sample)),
      symbol: "T",
      timeframe: "1",
    }).runRealtime(execution.script);
    expect(execution.output().drawings.shapes).toEqual(historical.drawings.shapes);
    expect(historical.drawings.shapes).toHaveLength(6);
  });
});
