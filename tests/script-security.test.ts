import { describe, expect, it } from "vitest";
import { indicator } from "../src/index.js";
import type { Bar } from "../src/index.js";
import { resampleBars, timeframeMs } from "../src/script/security.js";

const MINUTE = 60_000;

/** 15-minute bars starting at 00:00 UTC; close rises by 1 each bar. */
const quarterHours = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: i * 15 * MINUTE,
    open: 100 + i - 0.5,
    high: 100 + i + 1,
    low: 100 + i - 1,
    close: 100 + i,
    volume: 1,
    isClosed: true,
  }));

describe("timeframes and resampling", () => {
  it("parses Pine timeframe strings", () => {
    expect(timeframeMs("15")).toBe(15 * MINUTE);
    expect(timeframeMs("240")).toBe(240 * MINUTE);
    expect(timeframeMs("D")).toBe(1440 * MINUTE);
    expect(timeframeMs("1W")).toBe(7 * 1440 * MINUTE);
    expect(() => timeframeMs("M")).toThrow(/Unsupported timeframe/);
  });

  it("aggregates OHLCV into UTC-aligned buckets", () => {
    const hourly = resampleBars(quarterHours(6), 60 * MINUTE);
    expect(hourly).toHaveLength(2);
    expect(hourly[0]).toMatchObject({
      time: 0,
      open: 99.5,
      high: 104,
      low: 99,
      close: 103,
      volume: 4,
      isClosed: true,
    });
    expect(hourly[1]).toMatchObject({ time: 60 * MINUTE, close: 105, volume: 2 });
  });
});

describe("security()", () => {
  it("returns the previous closed higher-timeframe bar's value, never the forming one", async () => {
    const script = indicator("HTF close", ({ security, plot }) => {
      plot(
        security("60", ({ close }) => close.value),
        "H1 close",
      );
    });
    const { values } = await script.run(quarterHours(12));
    const h1 = values["H1 close"]!;
    // Hour 0 has no previous hour; hour 1 sees hour 0's close (103); hour 2 sees hour 1's (107).
    expect(h1.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
    expect(h1.slice(4, 8)).toEqual([103, 103, 103, 103]);
    expect(h1.slice(8, 12)).toEqual([107, 107, 107, 107]);
  });

  it("runs ta.* on the higher timeframe's own history", async () => {
    const bars = quarterHours(40);
    const script = indicator("HTF SMA", ({ security, plot }) => {
      plot(
        security("60", ({ ta, close }) => ta.sma(close, 2).value),
        "H1 SMA",
      );
    });
    const { values } = await script.run(bars);
    const hourlyCloses = resampleBars(bars, 60 * MINUTE).map((b) => b.close);
    // Chart bar 12 is in hour 3; the previous closed hour is 2, whose SMA(2) averages hours 1 and 2.
    expect(values["H1 SMA"]![12]).toBe((hourlyCloses[1]! + hourlyCloses[2]!) / 2);
  });

  it("keeps separate call sites apart", async () => {
    const script = indicator("Two TFs", ({ security, plot }) => {
      plot(
        security("60", ({ close }) => close.value),
        "H1",
      );
      plot(
        security("120", ({ close }) => close.value),
        "H2",
      );
    });
    const { values } = await script.run(quarterHours(24));
    expect(values["H1"]![20]).toBe(119);
    expect(values["H2"]![20]).toBe(115);
  });
});
