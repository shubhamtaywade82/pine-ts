/**
 * Tests for the indicator registry (Wave 13).
 *
 * Verifies:
 *  - register / list / get / metadata / instantiate.
 *  - resolveDefaults fills missing inputs from InputConfig.defaultValue.
 *  - resolveSource maps every selector to the correct bar series.
 *  - The 6 built-in indicators (sma, ema, rsi, macd, bb, obv) self-register
 *    on import and run end-to-end producing correct results.
 *  - Idempotent registration; duplicate-id registration throws.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  defineIndicator,
  getIndicatorRegistry,
  intInput,
  linePlot,
  readBoolean,
  readNumber,
  readString,
  registerIndicator,
  resetIndicatorRegistry,
  resolveDefaults,
  resolveSource,
  sourceInput,
  SOURCE_SELECTORS,
  type InputConfig,
} from "../src/registry/index.js";
import { registerBuiltinIndicators } from "../src/registry/indicators/index.js";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineContext, SymbolInfo } from "../src/index.js";

// ---------- helpers ----------

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  minTick: 0.01,
  timezone: "UTC",
  type: "crypto",
};

class StubProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const closesToBars = (closes: readonly number[]): Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index * 50,
    isClosed: true,
  }));

const runIndicatorAcrossBars = async (
  indicatorId: string,
  closes: readonly number[],
  inputs: Record<string, unknown> = {},
): Promise<Record<string, Array<number | undefined>>> => {
  const instance = getIndicatorRegistry().instantiate(indicatorId, inputs);
  if (instance === undefined) throw new Error(`Indicator ${indicatorId} not registered`);
  const bars = closesToBars(closes);
  const results: Record<string, Array<number | undefined>> = {};
  for await (const result of instance.run(bars)) {
    for (const plotId of Object.keys(result)) {
      if (results[plotId] === undefined) results[plotId] = [];
      results[plotId]!.push(result[plotId]);
    }
  }
  return results;
};

// ---------- tests ----------

describe("Indicator registry", () => {
  beforeEach(() => {
    resetIndicatorRegistry();
    registerBuiltinIndicators();
  });

  describe("register / list / get / metadata / instantiate", () => {
    it("register makes the indicator listable and gettable by id", () => {
      const indicator = defineIndicator({
        id: "test-custom",
        name: "Test Custom Indicator",
        category: "custom",
        inputs: [intInput("length", "Length", 5)],
        plots: [linePlot("main", "Main", { pane: "main" })],
        calculate: () => ({ main: 42 }),
      });
      registerIndicator(indicator);
      const registry = getIndicatorRegistry();
      expect(registry.list().some((m) => m.id === "test-custom")).toBe(true);
      expect(registry.get("test-custom")?.metadata.name).toBe("Test Custom Indicator");
      expect(registry.metadata("test-custom")?.category).toBe("custom");
    });

    it("register is idempotent when registering the same indicator object twice", () => {
      const indicator = defineIndicator({
        id: "test-idempotent",
        name: "Idempotent Test",
        category: "custom",
        inputs: [],
        plots: [linePlot("main", "Main")],
        calculate: () => ({ main: 0 }),
      });
      registerIndicator(indicator);
      expect(() => registerIndicator(indicator)).not.toThrow();
    });

    it("register throws when registering a different indicator under an existing id", () => {
      const a = defineIndicator({
        id: "test-conflict",
        name: "Conflict A",
        category: "custom",
        inputs: [],
        plots: [linePlot("main", "Main")],
        calculate: () => ({ main: 0 }),
      });
      const b = defineIndicator({
        id: "test-conflict",
        name: "Conflict B",
        category: "custom",
        inputs: [],
        plots: [linePlot("main", "Main")],
        calculate: () => ({ main: 1 }),
      });
      registerIndicator(a);
      expect(() => registerIndicator(b)).toThrow(/already registered/);
    });

    it("instantiate returns undefined for an unknown id", () => {
      expect(getIndicatorRegistry().instantiate("does-not-exist")).toBeUndefined();
    });

    it("metadata returns undefined for an unknown id", () => {
      expect(getIndicatorRegistry().metadata("does-not-exist")).toBeUndefined();
    });
  });

  describe("resolveDefaults", () => {
    it("fills in defaults for missing inputs and keeps user overrides", () => {
      const inputs: readonly InputConfig[] = [
        intInput("length", "Length", 14),
        sourceInput("source", "Source", "close"),
      ];
      const resolved = resolveDefaults(inputs, { length: 7 });
      expect(resolved).toEqual({ length: 7, source: "close" });
    });

    it("returns an empty object for an empty inputs list", () => {
      expect(resolveDefaults([], {})).toEqual({});
    });
  });

  describe("resolveSource", () => {
    it("maps every selector to the correct bar series", async () => {
      const bars = closesToBars([10, 20, 30]);
      const captured: Record<string, number> = {};
      const provider = new StubProvider(bars);
      const runtime = new PineRuntime({
        provider,
        symbol: "TEST",
        timeframe: "1",
      });
      await runtime.run((ctx: PineContext) => {
        for (const selector of SOURCE_SELECTORS) {
          const series = resolveSource(ctx, selector);
          const value = series.at(0);
          if (typeof value === "number") captured[selector] = value;
        }
      }, bars);
      // In closesToBars: open=close, high=close+1, low=close-1.
      // So hl2 = (high+low)/2 = close; hlc3 = (high+low+close)/3 = close;
      // ohlc4 = (open+high+low+close)/4 = close. All synthetic sources equal close.
      expect(captured["open"]).toBe(30);
      expect(captured["high"]).toBe(31);
      expect(captured["low"]).toBe(29);
      expect(captured["close"]).toBe(30);
      expect(captured["hl2"]).toBe(30);
      expect(captured["hlc3"]).toBe(30);
      expect(captured["ohlc4"]).toBe(30);
    });

    it("throws RangeError for an unknown selector", async () => {
      const bars = closesToBars([10, 20, 30]);
      const provider = new StubProvider(bars);
      const runtime = new PineRuntime({ provider, symbol: "TEST", timeframe: "1" });
      await runtime.run((ctx: PineContext) => {
        expect(() => resolveSource(ctx, "median" as never)).toThrow(RangeError);
      }, bars);
    });
  });

  describe("readNumber / readBoolean / readString", () => {
    it("readNumber returns a finite number", () => {
      expect(readNumber({ x: 7 }, "x")).toBe(7);
    });
    it("readNumber throws for a non-number", () => {
      expect(() => readNumber({ x: "string" }, "x")).toThrow(TypeError);
    });
    it("readBoolean returns a boolean", () => {
      expect(readBoolean({ flag: true }, "flag")).toBe(true);
    });
    it("readBoolean throws for a non-boolean", () => {
      expect(() => readBoolean({ flag: 1 }, "flag")).toThrow(TypeError);
    });
    it("readString returns a string", () => {
      expect(readString({ s: "hello" }, "s")).toBe("hello");
    });
    it("readString throws for a non-string", () => {
      expect(() => readString({ s: 42 }, "s")).toThrow(TypeError);
    });
  });
});

describe("Built-in indicators", () => {
  beforeEach(() => {
    resetIndicatorRegistry();
    registerBuiltinIndicators();
  });

  const closes = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20];

  describe("sma", () => {
    it("computes SMA over the last `length` closes", async () => {
      const results = await runIndicatorAcrossBars("sma", closes, { length: 3 });
      const main = results["main"]!;
      // Warm-up: 2 NaN.
      expect(main.slice(0, 2).every(Number.isNaN)).toBe(true);
      // Bar 2 (close=12): window [10,11,12] → 11.
      expect(main[2]).toBeCloseTo(11, 10);
      // Bar 3 (close=11): window [11,12,11] → 34/3.
      expect(main[3]).toBeCloseTo(34 / 3, 10);
    });
  });

  describe("ema", () => {
    it("seeds with SMA on the length-th bar and applies the recurrence after", async () => {
      const results = await runIndicatorAcrossBars("ema", closes, { length: 3 });
      const main = results["main"]!;
      expect(main.slice(0, 2).every(Number.isNaN)).toBe(true);
      // Bar 2: SMA seed = (10+11+12)/3 = 11.
      expect(main[2]).toBeCloseTo(11, 10);
      // Bar 3: alpha = 2/4 = 0.5; ema = (11 - 11) * 0.5 + 11 = 11.
      // Wait — pine's recurrence is `(value - prev) * alpha + prev`,
      // so with value=11, prev=11: (11-11)*0.5 + 11 = 11.
      expect(main[3]).toBeCloseTo(11, 10);
    });
  });

  describe("rsi", () => {
    it("returns the RSI line plus the 70/30 bands", async () => {
      const results = await runIndicatorAcrossBars("rsi", closes, { length: 3 });
      const main = results["main"]!;
      // Warm-up: bars 0..2 are NaN (length=3 needs 3 changes).
      expect(main.slice(0, 2).every(Number.isNaN)).toBe(true);
      // The upper/lower bands are constant 70/30 on every bar.
      expect(results["upper"]?.every((v) => v === 70)).toBe(true);
      expect(results["lower"]?.every((v) => v === 30)).toBe(true);
    });
  });

  describe("macd", () => {
    it("computes MACD, signal, histogram, and zero baseline", async () => {
      const results = await runIndicatorAcrossBars("macd", closes, {
        fastLength: 3,
        slowLength: 5,
        signalLength: 3,
      });
      const macdValues = results["macd"]!;
      const signal = results["signal"]!;
      const histogram = results["histogram"]!;
      const zero = results["zero"]!;
      // All four plots are present.
      expect(macdValues).toHaveLength(closes.length);
      expect(signal).toHaveLength(closes.length);
      expect(histogram).toHaveLength(closes.length);
      // Zero baseline is constant 0.
      expect(zero.every((v) => v === 0)).toBe(true);
      // Histogram = macd - signal on every non-NaN bar.
      for (let i = 0; i < closes.length; i += 1) {
        const m = macdValues[i];
        const s = signal[i];
        const h = histogram[i];
        if (m === undefined || s === undefined || h === undefined) continue;
        if (Number.isNaN(m) || Number.isNaN(s)) {
          expect(Number.isNaN(h)).toBe(true);
        } else {
          expect(h).toBeCloseTo(m - s, 10);
        }
      }
    });
  });

  describe("bb", () => {
    it("computes Bollinger Bands middle / upper / lower", async () => {
      const results = await runIndicatorAcrossBars("bb", closes, { length: 5, mult: 2.0 });
      const middle = results["middle"]!;
      const upper = results["upper"]!;
      const lower = results["lower"]!;
      // Warm-up: 4 NaN.
      expect(middle.slice(0, 4).every(Number.isNaN)).toBe(true);
      // On bar 4: SMA of closes[0..4] = (10+11+12+11+13)/5 = 11.4.
      expect(middle[4]).toBeCloseTo(57 / 5, 10);
      // Upper >= middle >= lower on every non-NaN bar.
      for (let i = 0; i < closes.length; i += 1) {
        const m = middle[i];
        const u = upper[i];
        const l = lower[i];
        if (m === undefined || u === undefined || l === undefined) continue;
        if (Number.isNaN(m) || Number.isNaN(u) || Number.isNaN(l)) continue;
        expect(u).toBeGreaterThanOrEqual(m);
        expect(m).toBeGreaterThanOrEqual(l);
      }
    });
  });

  describe("obv", () => {
    it("computes cumulative signed volume", async () => {
      const results = await runIndicatorAcrossBars("obv", closes);
      const main = results["main"]!;
      // First bar contributes 0 (no previous close).
      expect(main[0]).toBe(0);
      // OBV is monotonically non-decreasing on a strictly rising sequence;
      // here closes are mixed so we just check the first non-zero contribution.
      const firstNonZero = main.find((v) => v !== 0 && !Number.isNaN(v));
      expect(firstNonZero).toBeDefined();
    });
  });

  describe("vwap", () => {
    it("computes volume weighted average price", async () => {
      const results = await runIndicatorAcrossBars("vwap", closes);
      const main = results["main"]!;
      expect(main).toHaveLength(closes.length);
      expect(Number.isNaN(main[0])).toBe(false);
    });
  });

  describe("supertrend", () => {
    it("computes supertrend trailing stop line with upTrend and downTrend breaks", async () => {
      const results = await runIndicatorAcrossBars("supertrend", closes, {
        factor: 3,
        atrPeriod: 5,
      });
      const up = results["upTrend"]!;
      const down = results["downTrend"]!;
      expect(up).toHaveLength(closes.length);
      expect(down).toHaveLength(closes.length);
      const hasUpOrDown =
        up.some((v) => v !== undefined && !Number.isNaN(v)) ||
        down.some((v) => v !== undefined && !Number.isNaN(v));
      expect(hasUpOrDown).toBe(true);
    });
  });

  describe("stoch", () => {
    it("computes %K, %D, and bands", async () => {
      const results = await runIndicatorAcrossBars("stoch", closes, {
        kLength: 5,
        kSmoothing: 3,
        dSmoothing: 3,
      });
      expect(results["k"]).toHaveLength(closes.length);
      expect(results["d"]).toHaveLength(closes.length);
      expect(results["upper"]?.every((v) => v === 80)).toBe(true);
      expect(results["lower"]?.every((v) => v === 20)).toBe(true);
    });
  });

  describe("atr", () => {
    it("computes Average True Range", async () => {
      const results = await runIndicatorAcrossBars("atr", closes, { length: 5 });
      const main = results["main"]!;
      expect(main).toHaveLength(closes.length);
      const valid = main.find((v) => v !== undefined && !Number.isNaN(v));
      expect(valid).toBeDefined();
    });
  });

  describe("kc", () => {
    it("computes Keltner Channels middle, upper, and lower", async () => {
      const results = await runIndicatorAcrossBars("kc", closes, { length: 5, mult: 1.5 });
      const middle = results["middle"]!;
      const upper = results["upper"]!;
      const lower = results["lower"]!;
      expect(middle).toHaveLength(closes.length);
      expect(upper).toHaveLength(closes.length);
      expect(lower).toHaveLength(closes.length);
    });
  });

  describe("sar", () => {
    it("computes Parabolic SAR", async () => {
      const results = await runIndicatorAcrossBars("sar", closes);
      const main = results["main"]!;
      expect(main).toHaveLength(closes.length);
      const valid = main.find((v) => v !== undefined && !Number.isNaN(v));
      expect(valid).toBeDefined();
    });
  });

  describe("mfi", () => {
    it("computes Money Flow Index with bands", async () => {
      const results = await runIndicatorAcrossBars("mfi", closes, { length: 5 });
      expect(results["main"]).toHaveLength(closes.length);
      expect(results["upper"]?.every((v) => v === 80)).toBe(true);
      expect(results["lower"]?.every((v) => v === 20)).toBe(true);
    });
  });

  describe("wma and hma", () => {
    it("computes WMA and HMA overlays", async () => {
      const wmaRes = await runIndicatorAcrossBars("wma", closes, { length: 5 });
      const hmaRes = await runIndicatorAcrossBars("hma", closes, { length: 5 });
      expect(wmaRes["main"]).toHaveLength(closes.length);
      expect(hmaRes["main"]).toHaveLength(closes.length);
    });
  });

  describe("cci and wpr", () => {
    it("computes CCI and Williams %R oscillators", async () => {
      const cciRes = await runIndicatorAcrossBars("cci", closes, { length: 5 });
      const wprRes = await runIndicatorAcrossBars("wpr", closes, { length: 5 });
      expect(cciRes["main"]).toHaveLength(closes.length);
      expect(cciRes["upper"]?.every((v) => v === 100)).toBe(true);
      expect(wprRes["main"]).toHaveLength(closes.length);
      expect(wprRes["upper"]?.every((v) => v === -20)).toBe(true);
    });
  });

  describe("dmi", () => {
    it("computes DMI with ADX, +DI, and -DI", async () => {
      const results = await runIndicatorAcrossBars("dmi", closes, { diLength: 5, adxSmoothing: 5 });
      expect(results["adx"]).toHaveLength(closes.length);
      expect(results["plusDI"]).toHaveLength(closes.length);
      expect(results["minusDI"]).toHaveLength(closes.length);
      expect(results["keyLevel"]?.every((v) => v === 20)).toBe(true);
    });
  });

  describe("ml_supertrend", () => {
    it("computes Machine Learning Adaptive Supertrend", async () => {
      const results = await runIndicatorAcrossBars("ml_supertrend", closes, {
        factor: 3,
        atrLength: 5,
        trainingPeriod: 20,
      });
      expect(results["upTrend"]).toHaveLength(closes.length);
      expect(results["downTrend"]).toHaveLength(closes.length);
    });
  });

  describe("smc indicators", () => {
    it("runs structure, fvg, ob, and liquidity end-to-end and produces drawings", async () => {
      const bars = closesToBars(closes);
      const structInst = getIndicatorRegistry().instantiate("smc_structure", { swingLength: 3 })!;
      for await (const _ of structInst.run(bars)) {}
      expect(structInst.drawings).toBeDefined();

      const fvgInst = getIndicatorRegistry().instantiate("smc_fvg")!;
      for await (const _ of fvgInst.run(bars)) {}
      expect(fvgInst.drawings).toBeDefined();

      const obInst = getIndicatorRegistry().instantiate("smc_ob")!;
      for await (const _ of obInst.run(bars)) {}
      expect(obInst.drawings).toBeDefined();

      const liqInst = getIndicatorRegistry().instantiate("smc_liquidity")!;
      for await (const _ of liqInst.run(bars)) {}
      expect(liqInst.drawings).toBeDefined();
    });
  });

  describe("mtf_trend", () => {
    it("computes multi-timeframe trend ribbon EMAs", async () => {
      const results = await runIndicatorAcrossBars("mtf_trend", closes, {
        fastLength: 3,
        mediumLength: 5,
        slowLength: 10,
      });
      expect(results["fast"]).toHaveLength(closes.length);
      expect(results["medium"]).toHaveLength(closes.length);
      expect(results["slow"]).toHaveLength(closes.length);
    });
  });
});
