/**
 * Tests for `ta.pivot_point_levels` — the last `planned` ta.* function
 * now shipped as `draft`. Returns a PineArray of 11 levels per the
 * documented chart style.
 *
 * NOTE: Pine semantics — a function's state advances only on bars where
 * the function runs. These tests call `pivot_point_levels` on every bar
 * (the typical Pine usage pattern), so the state's `lastAnchorBar` and
 * running H/L/C are correctly initialized on bar 0 before the anchor fires
 * on bar 1.
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";
import type { PineArray } from "../src/array/pine-array.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  minTick: 0.01,
  timezone: "UTC",
};

class StaticProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const makeBars = (rows: ReadonlyArray<{ o: number; h: number; l: number; c: number }>): Bar[] =>
  rows.map((r, i) => ({
    time: (i + 1) * 86_400_000, // 1-day bars so the daily anchor fires on every bar
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: 1,
    isClosed: true,
  }));

const runScript = async (
  rows: ReadonlyArray<{ o: number; h: number; l: number; c: number }>,
  script: (ctx: import("../src/index.js").PineContext) => void,
): Promise<void> => {
  const bars = makeBars(rows);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1D",
  });
  await runtime.run(script, bars);
};

describe("ta.pivot_point_levels", () => {
  it("returns 11 levels (PP, R1..R5, S1..S5) per the TRADITIONAL style", async () => {
    const captured: Array<PineArray<number>> = [];
    await runScript(
      [
        { o: 95, h: 110, l: 90, c: 100 }, // period 1
        { o: 100, h: 120, l: 95, c: 115 }, // period 2 (anchor fires; levels computed from period 1's H/L/C)
      ],
      (ctx) => {
        // Call pivot_point_levels on every bar so its state advances.
        const levels = ta.pivot_point_levels("TRADITIONAL");
        if (ctx.bar_index.at(0) === 1) captured.push(levels);
      },
    );
    expect(captured).toHaveLength(1);
    const levels = captured[0]!;
    expect(levels.size()).toBe(11);
    // PP = (110 + 90 + 100) / 3 = 100
    expect(levels.get(0)).toBeCloseTo(100, 5);
    // R1 = 2*PP - L = 2*100 - 90 = 110
    expect(levels.get(1)).toBeCloseTo(110, 5);
    // S1 = 2*PP - H = 2*100 - 110 = 90
    expect(levels.get(2)).toBeCloseTo(90, 5);
    // R2 = PP + (H-L) = 100 + 20 = 120
    expect(levels.get(3)).toBeCloseTo(120, 5);
    // S2 = PP - (H-L) = 100 - 20 = 80
    expect(levels.get(4)).toBeCloseTo(80, 5);
    // R3 = H + 2*(PP-L) = 110 + 2*(100-90) = 130
    expect(levels.get(5)).toBeCloseTo(130, 5);
    // S3 = L - 2*(H-PP) = 90 - 2*(110-100) = 70
    expect(levels.get(6)).toBeCloseTo(70, 5);
  });

  it("returns 0-filled levels on the first bar (no previous anchor period)", async () => {
    const captured: Array<PineArray<number>> = [];
    await runScript([{ o: 95, h: 110, l: 90, c: 100 }], (ctx) => {
      if (ctx.bar_index.at(0) === 0) {
        captured.push(ta.pivot_point_levels("TRADITIONAL"));
      }
    });
    expect(captured[0]?.size()).toBe(11);
    for (let i = 0; i < 11; i += 1) {
      expect(captured[0]?.get(i)).toBe(0);
    }
  });

  it("FIBONACCI style applies 0.382/0.618/1.0/1.382/1.618 ratios", async () => {
    const captured: Array<PineArray<number>> = [];
    await runScript(
      [
        { o: 95, h: 110, l: 90, c: 100 },
        { o: 100, h: 120, l: 95, c: 115 },
      ],
      (ctx) => {
        const levels = ta.pivot_point_levels("FIBONACCI");
        if (ctx.bar_index.at(0) === 1) captured.push(levels);
      },
    );
    const levels = captured[0]!;
    // PP = (110+90+100)/3 = 100; range = 20
    expect(levels.get(0)).toBeCloseTo(100, 5);
    // R1 = PP + 0.382*range = 100 + 7.64 = 107.64
    expect(levels.get(1)).toBeCloseTo(107.64, 2);
    // S1 = PP - 0.382*range = 100 - 7.64 = 92.36
    expect(levels.get(2)).toBeCloseTo(92.36, 2);
  });

  it("WOODIE style uses (2*C + H + L) / 4 for PP", async () => {
    const captured: Array<PineArray<number>> = [];
    await runScript(
      [
        { o: 95, h: 110, l: 90, c: 100 },
        { o: 100, h: 120, l: 95, c: 115 },
      ],
      (ctx) => {
        const levels = ta.pivot_point_levels("WOODIE");
        if (ctx.bar_index.at(0) === 1) captured.push(levels);
      },
    );
    const levels = captured[0]!;
    // PP = (2*100 + 110 + 90) / 4 = 400/4 = 100
    expect(levels.get(0)).toBeCloseTo(100, 5);
  });

  it("CAMARILLA style uses the 1.1 multiplier on the range", async () => {
    const captured: Array<PineArray<number>> = [];
    await runScript(
      [
        { o: 95, h: 110, l: 90, c: 100 },
        { o: 100, h: 120, l: 95, c: 115 },
      ],
      (ctx) => {
        const levels = ta.pivot_point_levels("CAMARILLA");
        if (ctx.bar_index.at(0) === 1) captured.push(levels);
      },
    );
    const levels = captured[0]!;
    // PP = (110+90+100)/3 = 100; range = 20
    expect(levels.get(0)).toBeCloseTo(100, 5);
    // R1 = C + range*1.1/12 = 100 + 20*1.1/12 = 100 + 1.833... = 101.833...
    expect(levels.get(1)).toBeCloseTo(100 + (20 * 1.1) / 12, 5);
  });
});
