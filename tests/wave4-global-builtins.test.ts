/**
 * Tests for Wave 4 global built-ins (time, timestamp, alert, alertcondition,
 * type casts, max_bars_back).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as global_ from "../src/global/index.js";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

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

const makeBars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({
    time: (i + 1) * 60_000, // 1-minute bars starting at 1970-01-01 00:01:00 UTC
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    isClosed: true,
  }));

const runScript = async (
  closes: number[],
  script: (ctx: import("../src/index.js").PineContext) => void,
): Promise<void> => {
  const bars = makeBars(closes);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

describe("global built-ins", () => {
  beforeEach(() => {
    global_.resetGlobalState();
  });

  // ---------- alert / alertcondition ----------

  describe("alert", () => {
    it("captures alert events with the bar index and time", async () => {
      await runScript([1, 2, 3], (ctx) => {
        if (ctx.bar_index.at(0) === 1) global_.alert("hello", "once_per_bar");
      });
      const events = global_.getAlertEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.message).toBe("hello");
      expect(events[0]?.freq).toBe("once_per_bar");
      expect(events[0]?.barIndex).toBe(1);
    });

    it("defaults frequency to once_per_bar_close", async () => {
      await runScript([1, 2, 3], (ctx) => {
        if (ctx.bar_index.at(0) === 0) global_.alert("default");
      });
      expect(global_.getAlertEvents()[0]?.freq).toBe("once_per_bar_close");
    });
  });

  describe("alertcondition", () => {
    it("records and updates conditions on each bar", async () => {
      await runScript([1, 2, 3, 4], (ctx) => {
        global_.alertcondition(ctx.close.at(0)! > 2, "above_2", "close crossed 2");
      });
      const conditions = global_.getAlertConditions();
      expect(conditions).toHaveLength(1);
      expect(conditions[0]?.id).toBe("above_2");
      expect(conditions[0]?.condition).toBe(true); // last bar close=4 > 2
    });

    it("supports multiple alert conditions with distinct titles", async () => {
      await runScript([1, 2, 3], (ctx) => {
        global_.alertcondition(ctx.close.at(0)! > 1, "cond_a");
        global_.alertcondition(ctx.close.at(0)! > 2, "cond_b");
      });
      const ids = global_.getAlertConditions().map((c) => c.id);
      expect(ids).toEqual(["cond_a", "cond_b"]);
    });
  });

  // ---------- max_bars_back ----------

  describe("max_bars_back", () => {
    it("accepts a positive integer and clamps to 5000", () => {
      global_.max_bars_back(100);
      expect(global_.getRequestedMaxBarsBack()).toBe(100);
      global_.max_bars_back(99999);
      expect(global_.getRequestedMaxBarsBack()).toBe(5000);
    });

    it("rejects non-positive integers", () => {
      expect(() => global_.max_bars_back(0)).toThrow(RangeError);
      expect(() => global_.max_bars_back(-1)).toThrow(RangeError);
      expect(() => global_.max_bars_back(1.5)).toThrow(RangeError);
    });
  });

  // ---------- time / time_close / timenow / time_tradingday ----------

  describe("time helpers", () => {
    it("time() returns the current bar's open time on the script's timeframe", async () => {
      let captured: number | undefined;
      await runScript([1, 2, 3], (ctx) => {
        if (ctx.bar_index.at(0) === 1) captured = global_.time();
      });
      expect(captured).toBe(120_000);
    });

    it("time_close() returns open + timeframe seconds * 1000", async () => {
      let captured: number | undefined;
      await runScript([1, 2, 3], (ctx) => {
        if (ctx.bar_index.at(0) === 1) captured = global_.time_close();
      });
      // 1-minute bar at time 120_000 → close at 180_000
      expect(captured).toBe(180_000);
    });

    it("timenow returns a finite positive timestamp", () => {
      const t = global_.timenow();
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    });

    it("time_tradingday returns UTC midnight of the calendar date", () => {
      // 2026-01-15 13:45:30 UTC
      const t = Date.UTC(2026, 0, 15, 13, 45, 30, 0);
      const day = global_.time_tradingday(t, "UTC");
      expect(day).toBe(Date.UTC(2026, 0, 15, 0, 0, 0, 0));
    });
  });

  // ---------- timestamp constructor ----------

  describe("timestamp", () => {
    it("builds a UTC timestamp from calendar fields in UTC", () => {
      const t = global_.timestamp(2026, 1, 15, 13, 45, 30, "UTC");
      expect(t).toBe(Date.UTC(2026, 0, 15, 13, 45, 30, 0));
    });

    it("shifts by the timezone offset for non-UTC timezones", () => {
      // 2026-01-15 13:45:30 in Asia/Kolkata (UTC+5:30) is 2026-01-15 08:15:30 UTC.
      const t = global_.timestamp(2026, 1, 15, 13, 45, 30, "Asia/Kolkata");
      expect(t).toBe(Date.UTC(2026, 0, 15, 8, 15, 30, 0));
    });
  });

  // ---------- type casts ----------

  describe("type casts", () => {
    it("bool: numbers, strings, and na", () => {
      expect(global_.bool(1)).toBe(true);
      expect(global_.bool(0)).toBe(false);
      expect(global_.bool(Number.NaN)).toBeUndefined();
      expect(global_.bool("true")).toBe(true);
      expect(global_.bool("FALSE")).toBe(false);
      expect(global_.bool("hello")).toBe(true);
      expect(global_.bool("")).toBe(false);
      expect(global_.bool(undefined)).toBeUndefined();
    });

    it("int: truncates floats, parses strings, propagates na", () => {
      expect(global_.int(3.7)).toBe(3);
      expect(global_.int(-3.7)).toBe(-3);
      expect(global_.int(Number.NaN)).toBeUndefined();
      expect(global_.int("42")).toBe(42);
      expect(global_.int("3.5")).toBe(3);
      expect(global_.int("abc")).toBeUndefined();
      expect(global_.int(undefined)).toBeUndefined();
    });

    it("float: parses strings, propagates na", () => {
      expect(global_.float("3.14")).toBeCloseTo(3.14, 10);
      expect(global_.float(Number.NaN)).toBeUndefined();
      expect(global_.float(42)).toBe(42);
      expect(global_.float("abc")).toBeUndefined();
    });

    it("string: formats numbers, booleans, na", () => {
      expect(global_.string(42)).toBe("42");
      expect(global_.string(true)).toBe("true");
      expect(global_.string(false)).toBe("false");
      expect(global_.string("hello")).toBe("hello");
      expect(global_.string(Number.NaN)).toBeUndefined();
      expect(global_.string(undefined)).toBeUndefined();
    });

    it("colorCast: returns the color unchanged, na for undefined", () => {
      const c = { r: 255, g: 0, b: 0, t: 0 };
      expect(global_.colorCast(c)).toBe(c);
      expect(global_.colorCast(undefined)).toBeUndefined();
    });
  });
});
