/**
 * Tests for `ticker.*` — non-standard chart types.
 * Each builder takes regular Bar[] and produces synthetic Bar[].
 */
import { describe, expect, it } from "vitest";
import { ticker } from "../src/index.js";
import type { Bar } from "../src/index.js";

const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
  isClosed: true,
});

describe("ticker.*", () => {
  describe("ticker.standard", () => {
    it("passes through regular bars unchanged", () => {
      const bars = [bar(1, 10, 11, 9, 10), bar(2, 10, 12, 8, 11)];
      const t = ticker.standard("TEST");
      expect(t.symbol).toBe("TEST");
      expect(t.kind).toBe("standard");
      const result = t.buildBars(bars);
      expect(result).toEqual(bars);
    });
  });

  describe("ticker.heikinashi", () => {
    it("computes Heikin-Ashi candles correctly", () => {
      const bars = [
        bar(1, 10, 15, 5, 12), // HA close = (10+15+5+12)/4 = 10.5; HA open = (10+12)/2 = 11
        bar(2, 12, 14, 8, 10), // HA close = (12+14+8+10)/4 = 11; HA open = (11+10.5)/2 = 10.75
      ];
      const t = ticker.heikinashi("TEST");
      const result = t.buildBars(bars);
      expect(result).toHaveLength(2);
      // Bar 0: HA close = 10.5, HA open = 11
      expect(result[0]!.close).toBeCloseTo(10.5, 5);
      expect(result[0]!.open).toBeCloseTo(11, 5);
      expect(result[0]!.high).toBe(Math.max(15, 11, 10.5)); // 15
      expect(result[0]!.low).toBe(Math.min(5, 11, 10.5)); // 5
      // Bar 1: HA close = 11, HA open = (11+10.5)/2 = 10.75
      expect(result[1]!.close).toBeCloseTo(11, 5);
      expect(result[1]!.open).toBeCloseTo(10.75, 5);
    });
  });

  describe("ticker.renko", () => {
    it("produces bricks when price moves by brickSize", () => {
      const bars = [
        bar(1, 100, 105, 95, 100),
        bar(2, 100, 110, 99, 110), // +10 from 100 → 1 brick of size 10
        bar(3, 110, 120, 109, 120), // +10 → another brick
      ];
      const t = ticker.renko("TEST", { brickSize: 10 });
      const result = t.buildBars(bars);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // Each brick's close = open ± brickSize
      for (const brick of result) {
        const diff = Math.abs(brick.close - brick.open);
        expect(diff).toBeCloseTo(10, 5);
      }
    });
  });

  describe("ticker.linebreak", () => {
    it("produces a new line on a breakout above the lookback high", () => {
      const bars = [
        bar(1, 10, 11, 9, 10),
        bar(2, 10, 12, 8, 11),
        bar(3, 11, 13, 9, 12),
        bar(4, 12, 16, 11, 15), // breakout above prior 3 highs (11, 12, 13) → new line up to 15
      ];
      const t = ticker.linebreak("TEST", { lookback: 3 });
      const result = t.buildBars(bars);
      // First 3 bars seed the initial 3 lines; bar 4 produces a 4th.
      expect(result.length).toBeGreaterThanOrEqual(4);
      const lastLine = result.at(-1)!;
      expect(lastLine.close).toBe(15);
    });
  });

  describe("ticker.kagi", () => {
    it("produces a line reversal when the threshold is met", () => {
      const bars = [
        bar(1, 100, 105, 95, 100),
        bar(2, 100, 108, 99, 108), // up move
        bar(3, 108, 109, 90, 90), // down move beyond 1% reversal → reversal
      ];
      const t = ticker.kagi("TEST", { reversalAmount: 1, reversalType: "percent" });
      const result = t.buildBars(bars);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ticker.pointfigure", () => {
    it("produces X/O columns with box-size reversals", () => {
      const bars = [
        bar(1, 100, 105, 95, 100),
        bar(2, 100, 110, 99, 110), // +10 → X column extends
        bar(3, 110, 111, 80, 80), // -30 → reversal (>= 3 boxes * 10 = 30)
      ];
      const t = ticker.pointfigure("TEST", { boxSize: 10, reversalBoxes: 3 });
      const result = t.buildBars(bars);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ticker.new / modify / inherit", () => {
    it("ticker.new returns a passthrough ticker with adjustments", () => {
      const t = ticker.new_("TEST", { adjustment: "splits" });
      expect(t.symbol).toBe("TEST");
      expect(t.kind).toBe("standard");
      expect(t.adjustments.adjustment).toBe("splits");
      const bars = [bar(1, 10, 11, 9, 10)];
      expect(t.buildBars(bars)).toEqual(bars);
    });

    it("ticker.modify layers adjustments on an existing ticker", () => {
      const base = ticker.heikinashi("TEST");
      const modified = ticker.modify(base, { session: "0930-1600" });
      expect(modified.kind).toBe("heikinashi");
      expect(modified.adjustments.session).toBe("0930-1600");
      // Bar builder is preserved.
      const bars = [bar(1, 10, 15, 5, 12)];
      const result = modified.buildBars(bars);
      expect(result[0]!.close).toBeCloseTo(10.5, 5);
    });

    it("ticker.inherit returns a standard ticker", () => {
      const t = ticker.inherit("TEST");
      expect(t.kind).toBe("standard");
      expect(t.symbol).toBe("TEST");
    });
  });
});
