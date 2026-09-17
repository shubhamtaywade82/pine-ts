import { describe, expect, it } from "vitest";
import { createSeries } from "../src/index.js";

describe("Series", () => {
  it("supports Pine-style history offsets", () => {
    const series = createSeries([10, 20, 30]);
    expect(series.current).toBe(30);
    expect(series.at(0)).toBe(30);
    expect(series.at(1)).toBe(20);
    expect(series.at(2)).toBe(10);
    expect(series.at(3)).toBeUndefined();
  });

  it("rejects invalid offsets", () => {
    const series = createSeries([1]);
    expect(() => series.at(-1)).toThrow(RangeError);
    expect(() => series.at(1.5)).toThrow(RangeError);
  });
});
