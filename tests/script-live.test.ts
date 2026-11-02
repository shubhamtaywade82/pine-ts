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

/** Emits an alert on the last bar; used to pin the realtime rollback contract. */
const alertingScript = indicator("Alerts", ({ close, alert, plot }) => {
  alert(`close=${close.value}`);
  plot(close.value, "close");
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

describe("live() alert events", () => {
  it("replaces the open bar's alert on a tick instead of duplicating it", async () => {
    const bars = history(10);
    const live = await alertingScript.live(bars);
    const initial = await live.update(bars);
    expect(initial.alerts).toHaveLength(10);

    const ticked = [...bars.slice(0, -1), { ...bars[9]!, close: 111, high: 112 }];
    const output = await live.update(ticked);
    // One event per bar: the forming bar's earlier alert is discarded, and
    // only the re-executed bar's alert survives with the ticked close.
    expect(output.alerts).toHaveLength(10);
    expect(output.alerts?.at(-1)?.message).toBe("close=111");
    expect(output).toEqual(await alertingScript.run(ticked));
  });

  it("keeps historical alerts and appends the new bar's alert when a bar closes", async () => {
    const bars = history(10);
    const live = await alertingScript.live(bars);
    await live.update(bars);
    const next = [
      ...bars.slice(0, -1),
      { ...bars[9]!, close: 120, isClosed: true },
      bar(10, 121, false),
    ];
    const output = await live.update(next);
    expect(output.alerts).toHaveLength(11);
    expect(output).toEqual(await alertingScript.run(next));
  });
});
