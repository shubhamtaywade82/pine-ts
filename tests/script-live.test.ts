import { describe, expect, it } from "vitest";
import { indicator, ta } from "../src/index.js";
import type { Bar } from "../src/index.js";

const MINUTE = 60_000;

const bar = (i: number, close: number, isClosed = true): Bar => ({
  time: i * 15 * MINUTE,
  open: close - 0.5,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
  isClosed,
});

/** 15m bars with a wavy close, the last one still forming. */
const history = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => bar(i, 100 + Math.sin(i / 3) * 5, i < count - 1));

const script = indicator("Live", ({ close, plot, security, draw, bar_index }) => {
  plot(ta.sma(close, 3), "SMA");
  plot(
    security("60", ({ close: h }) => h.value),
    "H1",
  );
  if ((bar_index.value ?? 0) % 5 === 0)
    draw.label({ x: bar_index.value ?? 0, y: close.value ?? 0, text: "x" });
});

describe("live()", () => {
  it("matches a full run after ticks on the forming bar", async () => {
    const bars = history(10);
    const live = await script.live(bars);
    const ticked = [...bars.slice(0, -1), { ...bars[9]!, close: 111, high: 112 }];
    const output = await live.update(ticked);
    expect(output).toEqual(await script.run(ticked));
  });

  it("confirms the closed bar with its final values when the next bar opens", async () => {
    const bars = history(10);
    const live = await script.live(bars);
    // The closing values of bar 9 were never ticked: the snapshot jumps straight to bar 10.
    const next = [
      ...bars.slice(0, -1),
      { ...bars[9]!, close: 120, isClosed: true },
      bar(10, 121, false),
    ];
    const output = await live.update(next);
    expect(output).toEqual(await script.run(next));
  });

  it("reruns when a new higher-timeframe bar opens, so security() sees the hour that just closed", async () => {
    const bars = history(12); // bars 0–11: hours 0–2, bar 11 forming
    const live = await script.live(bars);
    const next = [...bars.slice(0, -1), { ...bars[11]!, isClosed: true }, bar(12, 130, false)];
    const output = await live.update(next);
    expect(output).toEqual(await script.run(next));
    expect(output.values["H1"]!.at(-1)).toBe(bars[11]!.close);
  });

  it("reruns everything when older history is prepended", async () => {
    const bars = history(10);
    const live = await script.live(bars.slice(3));
    expect(await live.update(bars)).toEqual(await script.run(bars));
  });
});
