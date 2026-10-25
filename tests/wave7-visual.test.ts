/**
 * Tests for Wave 7 visual runtime: plot*, hline, fill, bgcolor, barcolor,
 * alertcondition (already covered in Wave 4), drawing objects.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as visual from "../src/visual/index.js";
import { color as colorNs } from "../src/index.js";

describe("visual runtime", () => {
  beforeEach(() => {
    visual.resetVisualState();
    visual.setVisualSink(undefined);
  });

  // ---------- plot / plotshape / plotchar / plotarrow ----------

  describe("plot family", () => {
    it("plot emits a 'plot' event with the value and styling", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.plot(42.5, "myplot", { color: colorNs.rgb(255, 0, 0), linewidth: 2 });
      visual.plot(43.0, "myplot"); // same seriesId — should append a second event
      expect(events).toHaveLength(2);
      expect(events[0]?.kind).toBe("plot");
      expect(events[0]?.seriesId).toBe("myplot");
      expect(events[0]?.payload["value"]).toBe(42.5);
      expect(events[0]?.payload["linewidth"]).toBe(2);
      expect(events[1]?.payload["value"]).toBe(43.0);
      // Default linewidth is 1 when not supplied.
      expect(events[1]?.payload["linewidth"]).toBe(1);
    });

    it("plotshape does not emit when condition is false", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.plotshape(false);
      expect(events).toHaveLength(0);
    });

    it("plotshape emits when condition is true, with shape defaults", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.plotshape(true, { title: "arrow", style: "shapearrowup" });
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("plotshape");
      expect(events[0]?.seriesId).toBe("arrow");
      expect(events[0]?.payload["style"]).toBe("shapearrowup");
      expect(events[0]?.payload["location"]).toBe("abovebar");
    });

    it("plotchar emits the documented char default", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.plotchar(true, { char: "X" });
      expect(events[0]?.kind).toBe("plotchar");
      expect(events[0]?.payload["char"]).toBe("X");
    });

    it("plotbar and plotcandle emit OHLC payloads", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.plotbar(1, 2, 0.5, 1.5);
      visual.plotcandle(1, 2, 0.5, 1.5);
      expect(events).toHaveLength(2);
      expect(events[0]?.payload["open"]).toBe(1);
      expect(events[0]?.payload["high"]).toBe(2);
      expect(events[1]?.payload["close"]).toBe(1.5);
    });
  });

  // ---------- hline / fill / bgcolor / barcolor ----------

  describe("hline family", () => {
    it("hline returns an id and emits the price + style", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.hline(50, "midline", { linestyle: "dashed" });
      expect(typeof id).toBe("string");
      expect(events[0]?.kind).toBe("hline");
      expect(events[0]?.seriesId).toBe(id);
      expect(events[0]?.payload["price"]).toBe(50);
      expect(events[0]?.payload["linestyle"]).toBe("dashed");
    });

    it("fill emits the two hline ids + a color", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id1 = visual.hline(50);
      const id2 = visual.hline(60);
      visual.fill(id1, id2, { color: colorNs.rgb(0, 255, 0) });
      expect(events.at(-1)?.kind).toBe("fill");
      expect(events.at(-1)?.payload["hline1"]).toBe(id1);
      expect(events.at(-1)?.payload["hline2"]).toBe(id2);
    });

    it("bgcolor emits the color", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.bgcolor(colorNs.rgb(255, 255, 0));
      expect(events[0]?.kind).toBe("bgcolor");
      expect(events[0]?.payload["color"]).toEqual({ r: 255, g: 255, b: 0, t: 0 });
    });

    it("barcolor emits the color", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.barcolor(colorNs.rgb(255, 0, 0));
      expect(events[0]?.kind).toBe("barcolor");
    });
  });

  // ---------- drawing objects ----------

  describe("drawing objects", () => {
    it("line.new returns an id and emits a create event", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.line.new(1, 100, 10, 110);
      expect(typeof id).toBe("string");
      expect(events[0]?.kind).toBe("drawing.create");
      expect(events[0]?.payload["drawingKind"]).toBe("line");
      expect(events[0]?.payload["x1"]).toBe(1);
    });

    it("line.set_x1 emits an update event", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.line.new(1, 100, 10, 110);
      visual.line.set_x1(id, 5);
      expect(events.at(-1)?.kind).toBe("drawing.update");
      expect(events.at(-1)?.payload["field"]).toBe("x1");
      expect(events.at(-1)?.payload["value"]).toBe(5);
    });

    it("line.delete emits a delete event", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.line.new(1, 100, 10, 110);
      visual.line.delete(id);
      expect(events.at(-1)?.kind).toBe("drawing.delete");
      expect(events.at(-1)?.seriesId).toBe(id);
    });

    it("line.get_price linearly interpolates between endpoints", () => {
      visual.line.new(0, 100, 10, 110, {});
      // Need to look up the line by its id; line.new returns an id.
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.line.new(0, 100, 10, 110);
      // At x=5, the line is halfway between y1=100 and y2=110 → 105.
      expect(visual.line.get_price(id, 5)).toBeCloseTo(105, 5);
    });

    it("label.new creates a drawing; set_text emits an update", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.label.new(1, 100, "hello");
      expect(events[0]?.payload["text"]).toBe("hello");
      visual.label.set_text(id, "world");
      expect(events.at(-1)?.kind).toBe("drawing.update");
      expect(events.at(-1)?.payload["value"]).toBe("world");
    });

    it("box.new creates a drawing; setters emit updates", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.box.new(0, 100, 10, 90);
      expect(events[0]?.payload["top"]).toBe(100);
      visual.box.set_top(id, 105);
      expect(events.at(-1)?.payload["field"]).toBe("top");
    });

    it("table.new + table.cell emits create + update", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      const id = visual.table.new("top_left", 3, 2);
      expect(events[0]?.payload["columns"]).toBe(3);
      visual.table.cell(id, 0, 0, "AAPL");
      expect(events.at(-1)?.payload["field"]).toBe("cell");
    });

    it("linefill.new creates a linefill drawing", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.linefill.new("l1", "l2", colorNs.rgb(0, 0, 255));
      expect(events[0]?.kind).toBe("drawing.create");
      expect(events[0]?.payload["drawingKind"]).toBe("linefill");
      expect(events[0]?.payload["color"]).toEqual({ r: 0, g: 0, b: 255, t: 0 });
    });

    it("polyline.new creates a polyline drawing from points", () => {
      const events: visual.VisualEvent[] = [];
      visual.setVisualSink((e) => events.push(e));
      visual.polyline.new(
        [
          { index: 0, price: 100 },
          { index: 1, price: 110 },
          { index: 2, price: 105 },
        ],
        { color: colorNs.rgb(255, 0, 0), line_width: 2 },
      );
      expect(events[0]?.kind).toBe("drawing.create");
      expect(events[0]?.payload["drawingKind"]).toBe("polyline");
      expect(events[0]?.payload["line_width"]).toBe(2);
    });

    it("chartPoint.from_time and from_index return the expected shapes", () => {
      const p1 = visual.chartPoint.from_time(1000, 50.5);
      expect(p1).toEqual({ time: 1000, price: 50.5, index: undefined });
      const p2 = visual.chartPoint.from_index(5, 60);
      expect(p2).toEqual({ time: undefined, price: 60, index: 5 });
    });

    it("drawings_all returns all created drawing ids", () => {
      const id1 = visual.line.new(0, 100, 10, 110);
      const id2 = visual.label.new(1, 100, "hi");
      const all = visual.drawings_all();
      expect(all).toContain(id1);
      expect(all).toContain(id2);
    });

    it("silently no-ops when no sink is installed", () => {
      visual.setVisualSink(undefined);
      expect(() => visual.plot(42)).not.toThrow();
      expect(() => visual.line.new(0, 100, 10, 110)).not.toThrow();
    });
  });
});
