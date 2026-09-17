import { describe, expect, it } from "vitest";
import { createSeries, ta } from "../src/index.js";

describe("ta core", () => {
  it("calculates SMA", () => {
    expect(ta.sma(createSeries([1, 2, 3, 4, 5]), 3)).toBe(4);
  });

  it("calculates EMA with an SMA seed", () => {
    expect(ta.ema(createSeries([1, 2, 3, 4, 5]), 3)).toBeCloseTo(4.0625, 10);
  });

  it("finds rolling highest and lowest values", () => {
    const source = createSeries([5, 2, 8, 4]);
    expect(ta.highest(source, 3)).toBe(8);
    expect(ta.lowest(source, 3)).toBe(2);
  });

  it("detects crossovers and crossunders", () => {
    const a = createSeries([1, 2, 4]);
    const b = createSeries([2, 2, 3]);
    expect(ta.crossover(a, b)).toBe(true);
    expect(ta.crossunder(a, b)).toBe(false);
  });
});
