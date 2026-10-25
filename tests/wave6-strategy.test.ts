/**
 * Tests for Wave 6 strategy.* engine: order placement, broker emulator,
 * position state variables, OCA groups, pyramiding, commission/slippage.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  StrategyEngine,
  setActiveStrategyEngine,
  strategy as strategyNs,
  type Bar,
} from "../src/index.js";
import type { Direction } from "../src/strategy/index.js";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  isClosed: true,
});

describe("strategy.* engine", () => {
  let engine: StrategyEngine;

  beforeEach(() => {
    engine = new StrategyEngine();
    engine.configure({ title: "Test", initial_capital: 10_000 });
    setActiveStrategyEngine(engine);
  });

  // ---------- market order fill on next bar's open ----------

  describe("market orders", () => {
    it("fills on the next bar's open by default", () => {
      engine.entry("long1", "long", 10);
      expect(engine.position_size).toBe(0);
      engine.processBar(bar(2, 105, 110, 100, 108));
      expect(engine.position_size).toBe(10);
      expect(engine.getOpenTrades()[0]?.entryPrice).toBe(105);
    });

    it("fills on the same bar's close when process_orders_on_close is set", () => {
      engine.configure({
        title: "Test",
        initial_capital: 10_000,
        process_orders_on_close: true,
      });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 105, 110, 100, 108));
      expect(engine.position_size).toBe(10);
      expect(engine.getOpenTrades()[0]?.entryPrice).toBe(108);
    });
  });

  // ---------- exit & position reversal ----------

  describe("exit orders", () => {
    it("closes a long at the next bar's open and records the closed trade", () => {
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 110, 95, 105));
      engine.close("long1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      expect(engine.position_size).toBe(0);
      expect(engine.getClosedTrades()).toHaveLength(1);
      const closed = engine.getClosedTrades()[0]!;
      expect(closed.direction).toBe("long");
      expect(closed.entryPrice).toBe(100);
      expect(closed.exitPrice).toBe(110);
      expect(closed.qty).toBe(10);
      expect(closed.profit).toBeCloseTo((110 - 100) * 10, 5);
    });

    it("reverses the position when an entry arrives in the opposite direction", () => {
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 110, 95, 105));
      engine.entry("short1", "short", 15);
      engine.processBar(bar(3, 110, 115, 105, 112));
      expect(engine.position_size).toBe(-5);
      expect(engine.getClosedTrades()).toHaveLength(1);
      const closed = engine.getClosedTrades()[0]!;
      expect(closed.direction).toBe("long");
      expect(closed.profit).toBeCloseTo((110 - 100) * 10, 5);
    });
  });

  // ---------- limit / stop orders ----------

  describe("limit orders", () => {
    it("long limit fills when the bar low reaches the limit", () => {
      engine.entry("long1", "long", 10, { limit: 95 });
      engine.processBar(bar(2, 100, 105, 90, 102));
      expect(engine.position_size).toBe(10);
      expect(engine.getOpenTrades()[0]?.entryPrice).toBe(95);
    });

    it("does not fill when the bar low stays above the limit", () => {
      engine.entry("long1", "long", 10, { limit: 95 });
      engine.processBar(bar(2, 100, 105, 96, 102));
      expect(engine.position_size).toBe(0);
    });
  });

  describe("stop orders", () => {
    it("long stop fills when the bar high reaches the stop", () => {
      engine.entry("long1", "long", 10, { stop: 105 });
      engine.processBar(bar(2, 100, 110, 95, 102));
      expect(engine.position_size).toBe(10);
      expect(engine.getOpenTrades()[0]?.entryPrice).toBe(105);
    });
  });

  // ---------- cancel ----------

  describe("cancel", () => {
    it("cancels a pending order by id", () => {
      engine.entry("long1", "long", 10, { limit: 95 });
      engine.cancel("long1");
      engine.processBar(bar(2, 100, 105, 90, 102));
      expect(engine.position_size).toBe(0);
    });

    it("cancel_all clears every pending order", () => {
      engine.entry("long1", "long", 10, { limit: 95 });
      engine.entry("long2", "long", 10, { limit: 96 });
      engine.cancel_all();
      engine.processBar(bar(2, 100, 105, 90, 102));
      expect(engine.position_size).toBe(0);
    });
  });

  // ---------- pyramiding cap ----------

  describe("pyramiding", () => {
    it("rejects an additional entry when pyramiding is 1", () => {
      engine.configure({ title: "Test", initial_capital: 10_000, pyramiding: 1 });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      engine.entry("long2", "long", 10);
      engine.processBar(bar(3, 102, 108, 100, 105));
      expect(engine.position_size).toBe(10);
      expect(engine.getOpenTrades()).toHaveLength(1);
    });

    it("allows up to N pyramid layers when pyramiding is N", () => {
      engine.configure({ title: "Test", initial_capital: 10_000, pyramiding: 3 });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      engine.entry("long2", "long", 10);
      engine.processBar(bar(3, 102, 108, 100, 105));
      engine.entry("long3", "long", 10);
      engine.processBar(bar(4, 105, 110, 102, 108));
      expect(engine.position_size).toBe(30);
      expect(engine.getOpenTrades()).toHaveLength(3);
    });
  });

  // ---------- commission & slippage ----------

  describe("commission and slippage", () => {
    it("applies percent commission and points slippage to fills", () => {
      engine.configure({
        title: "Test",
        initial_capital: 10_000,
        commission_type: "percent",
        commission_value: 0.1,
        slippage: 0.5,
        slippage_unit: "points",
      });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      // Fill price = 100 + 0.5 (slippage) = 100.5
      expect(engine.getOpenTrades()[0]?.entryPrice).toBeCloseTo(100.5, 5);
      engine.close("long1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      const closed = engine.getClosedTrades()[0]!;
      // Exit fill = 110 + 0.5 = 110.5
      expect(closed.exitPrice).toBeCloseTo(110.5, 5);
      // gross = (110.5 - 100.5) * 10 = 100
      // entry commission = 100.5 * 10 * 0.001 = 1.005
      // exit commission = 110.5 * 10 * 0.001 = 1.105
      // net = 100 - 1.005 - 1.105 = 97.89
      expect(closed.profit).toBeCloseTo(97.89, 2);
    });
  });

  // ---------- state variables ----------

  describe("state variables", () => {
    it("position_avg_price is the qty-weighted average of open entries", () => {
      engine.configure({ title: "Test", initial_capital: 10_000, pyramiding: 5 });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      engine.entry("long2", "long", 20);
      engine.processBar(bar(3, 102, 108, 100, 105));
      expect(engine.position_avg_price).toBeCloseTo(3040 / 30, 5);
    });

    it("equity tracks cash + unrealised P&L", () => {
      engine.configure({ title: "Test", initial_capital: 10_000 });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      // Cash unchanged on entry (we track unrealised P&L). Equity = cash + (102-100)*10 = 10020.
      expect(engine.equity).toBeCloseTo(10020, 5);
    });

    it("netprofit tracks realised + unrealised since start", () => {
      engine.configure({ title: "Test", initial_capital: 10_000 });
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      engine.close("long1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      expect(engine.netprofit).toBeCloseTo(100, 5);
    });

    it("grossprofit / grossloss split closed trades by sign", () => {
      engine.configure({ title: "Test", initial_capital: 10_000, pyramiding: 5 });
      engine.entry("t1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      engine.close("t1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      engine.entry("t2", "long", 10);
      engine.processBar(bar(4, 110, 115, 105, 108));
      engine.close("t2");
      engine.processBar(bar(5, 100, 105, 95, 98));
      expect(engine.grossprofit).toBeCloseTo(100, 5);
      expect(engine.grossloss).toBeCloseTo(-100, 5);
      expect(engine.netprofit).toBeCloseTo(0, 5);
    });

    it("closedtrades_number and opentrades_number track counts", () => {
      engine.entry("long1", "long", 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      expect(engine.opentrades_number).toBe(1);
      expect(engine.closedtrades_number).toBe(0);
      engine.close("long1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      expect(engine.opentrades_number).toBe(0);
      expect(engine.closedtrades_number).toBe(1);
    });
  });

  // ---------- module-level strategy.* functions ----------

  describe("module-level strategy.* functions", () => {
    it("entry/close dispatch on the active engine", () => {
      const dir: Direction = "long";
      strategyNs.entry("long1", dir, 10);
      engine.processBar(bar(2, 100, 105, 95, 102));
      expect(engine.position_size).toBe(10);
      strategyNs.close("long1");
      engine.processBar(bar(3, 110, 115, 105, 112));
      expect(engine.position_size).toBe(0);
    });
  });
});
