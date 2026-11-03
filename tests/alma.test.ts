import { describe, expect, it } from "vitest";
import {
  PineRuntime,
  registry,
  ta,
  type Bar,
  type MarketDataProvider,
  type SymbolInfo,
} from "../src/index.js";
import { getAlmaWeights } from "../src/ta/alma.js";
import {
  calculateNormalizedSlope,
  detectAlmaPullback,
  evaluateAlignment,
  evaluateSpreadState,
  findPairwiseCrossovers,
} from "../src/ta/multi-alma.js";

const symbolInfo: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const createMockProvider = (bars: readonly Bar[]): MarketDataProvider => ({
  getHistoricalBars: async () => bars,
  streamBars: () => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  }),
  getSymbolInfo: async () => symbolInfo,
});

describe("ALMA calculation and Pine v6 parity", () => {
  it("computes and caches Gaussian weights deterministically", () => {
    const w1 = getAlmaWeights(9, 0.85, 6, false);
    const w2 = getAlmaWeights(9, 0.85, 6, false);
    expect(w1).toBe(w2); // Exact reference identity from cache
    expect(w1.weights).toHaveLength(9);
    expect(w1.weightSum).toBeGreaterThan(0);
    // Recent weights should be heavier than older weights when offset=0.85
    expect(w1.weights[8]).toBeGreaterThan(w1.weights[0]!);
  });

  it("differentiates floor = true from floor = false", () => {
    // With length=9, offset=0.85: mRaw = 0.85 * 8 = 6.8.
    // Floored m = 6, standard m = 6.8.
    const withoutFloor = getAlmaWeights(9, 0.85, 6, false);
    const floored = getAlmaWeights(9, 0.85, 6, true);
    expect(withoutFloor).not.toBe(floored);
    expect(floored.weights[6]).toBeGreaterThan(floored.weights[7]!);
  });

  it("calculates ALMA with correct warm-up bars", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 12, low: 9, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 10, high: 15, low: 10, close: 14, volume: 110, isClosed: true },
      { time: 3000, open: 14, high: 18, low: 13, close: 18, volume: 120, isClosed: true },
      { time: 4000, open: 18, high: 22, low: 17, close: 20, volume: 130, isClosed: true },
      { time: 5000, open: 20, high: 26, low: 19, close: 25, volume: 140, isClosed: true },
    ];

    const values: number[] = [];
    const runtime = new PineRuntime({
      provider: createMockProvider(bars),
      symbol: "TEST",
      timeframe: "1m",
    });

    await runtime.run((ctx) => {
      values.push(ta.alma(ctx.close, 3, 0.85, 6).value);
    }, bars);

    // Warm-up bars should be NaN (length - 1 = 2)
    expect(Number.isNaN(values[0])).toBe(true);
    expect(Number.isNaN(values[1])).toBe(true);
    // Bar 2 uses [10, 14, 18], weighted towards recent values (18)
    expect(values[2]).toBeDefined();
    expect(values[2]!).toBeGreaterThan(14);
    expect(values[2]!).toBeLessThanOrEqual(18);
  });
});

describe("Multi-ALMA analysis layer", () => {
  it("evaluates bullish, bearish, and mixed alignment", () => {
    const bull = evaluateAlignment([50, 40, 30, 20]);
    expect(bull.state).toBe("bullish");
    expect(bull.score).toBe(100);

    const bear = evaluateAlignment([20, 30, 40, 50]);
    expect(bear.state).toBe("bearish");
    expect(bear.score).toBe(-100);

    const mixed = evaluateAlignment([30, 40, 20, 50]);
    expect(mixed.state).toBe("mixed");
  });

  it("detects pairwise crossovers", () => {
    const configs = [
      { id: "fast", name: "Fast", length: 9 },
      { id: "slow", name: "Slow", length: 21 },
    ];
    // Current: fast (105) > slow (100). Prev: fast (95) <= slow (100) -> Bullish cross
    const crosses = findPairwiseCrossovers([105, 100], [95, 100], configs);
    expect(crosses).toHaveLength(1);
    expect(crosses[0]).toEqual({ fastId: "fast", slowId: "slow", direction: "bullish" });
  });

  it("calculates normalized slope and spread state", () => {
    const slope = calculateNormalizedSlope(105, 100, 2.5);
    expect(slope).toBe(2);

    const compressed = evaluateSpreadState(0.5, 0.6, 2);
    expect(compressed).toBe("compressed");

    const expanding = evaluateSpreadState(5, 4, 2);
    expect(expanding).toBe("expanding");
  });

  it("detects pullbacks to ALMA level", () => {
    const bar = { open: 101, high: 104, low: 99.8, close: 103 };
    const pb = detectAlmaPullback(bar, 100, 2, "trend");
    expect(pb).toBeDefined();
    expect(pb?.direction).toBe("bullish");
  });

  it("registers built-in alma and alma_ribbon indicators", () => {
    const almaMeta = registry.metadata("alma");
    expect(almaMeta).toBeDefined();
    expect(almaMeta?.name).toBe("Arnaud Legoux Moving Average");

    const ribbonMeta = registry.metadata("alma_ribbon");
    expect(ribbonMeta).toBeDefined();
    expect(ribbonMeta?.name).toBe("ALMA Trend Ribbon");
    expect(ribbonMeta?.plots.length).toBe(4);
  });
});
