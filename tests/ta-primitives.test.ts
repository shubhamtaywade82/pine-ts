import { describe, expect, it } from "vitest";
import { createSeries, ta } from "../src/index.js";

describe("ta primitives", () => {
  it("calculates change", () => {
    const source = createSeries([10, 12, 15]);
    expect(ta.change(source)).toBe(3);
    expect(ta.change(source, 2)).toBe(5);
  });

  it("detects both crossover and crossunder", () => {
    const up = createSeries([1, 2, 4]);
    const down = createSeries([3, 2, 1]);
    expect(ta.crossover(up, down)).toBe(true);
    expect(ta.crossunder(down, up)).toBe(true);
  });
});
