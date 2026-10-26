/**
 * `strategy.exit` bracket semantics (Pine v6, TradingView strategies manual):
 *
 * - `limit`/`stop` are prices; `profit`/`loss` are ticks from the entry price.
 *   When both forms are given for a leg, only the level expected to trigger
 *   first is used.
 * - `limit` + `stop` are two exit orders in the `oca.reduce` group: the first
 *   fill cancels the other.
 * - Without `qty`, the exit closes 100% of the entry.
 * - Exits apply to entries created on or before the call bar, so an exit
 *   placed while its entry is pending activates once the entry fills.
 * - Intrabar path: open→high→low→close when the open is closer to the high,
 *   otherwise open→low→high→close; a level gapped through fills at the open.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { StrategyEngine, type Bar } from "../src/index.js";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  isClosed: true,
});

describe("strategy.exit brackets (emulator)", () => {
  let engine: StrategyEngine;

  const openLong = (qty = 10): void => {
    engine.entry("L", "long", qty);
    engine.processBar(bar(1, 100, 101, 99, 100));
  };

  const openShort = (qty = 10): void => {
    engine.entry("S", "short", qty);
    engine.processBar(bar(1, 100, 101, 99, 100));
  };

  beforeEach(() => {
    engine = new StrategyEngine();
    engine.configure({ title: "Exit", initial_capital: 10_000 });
  });

  describe("long trades", () => {
    it("does not stop out when only the bar high reaches the stop level", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 100, 105, 97, 103));
      expect(engine.position_size).toBe(10);
      expect(engine.getClosedTrades()).toHaveLength(0);
    });

    it("stops out at the stop price when the low reaches it", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 100, 102, 94, 96));
      expect(engine.position_size).toBe(0);
      const [closed] = engine.getClosedTrades();
      expect(closed?.exitPrice).toBe(95);
      expect(closed?.profit).toBeCloseTo(-50, 10);
    });

    it("takes profit at the limit price when the high reaches it", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 104, 111, 103, 108));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(110);
      expect(engine.position_size).toBe(0);
    });

    it("fills a gapped-through stop at the bar open", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.processBar(bar(2, 90, 92, 88, 91));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(90);
    });

    it("fills a gapped-through limit at the bar open", () => {
      openLong();
      engine.exit("X", "L", undefined, { limit: 110 });
      engine.processBar(bar(2, 115, 116, 112, 113));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(115);
    });
  });

  describe("short trades", () => {
    it("stops out when the high reaches the stop above entry", () => {
      openShort();
      engine.exit("X", "S", undefined, { stop: 105, limit: 90 });
      engine.processBar(bar(2, 100, 104, 96, 98));
      expect(engine.position_size).toBe(-10);
      engine.processBar(bar(3, 100, 106, 99, 104));
      const [closed] = engine.getClosedTrades();
      expect(closed?.exitPrice).toBe(105);
      expect(closed?.profit).toBeCloseTo(-50, 10);
      expect(engine.position_size).toBe(0);
    });

    it("takes profit when the low reaches the limit below entry", () => {
      openShort();
      engine.exit("X", "S", undefined, { stop: 105, limit: 90 });
      engine.processBar(bar(2, 95, 96, 89, 92));
      const [closed] = engine.getClosedTrades();
      expect(closed?.exitPrice).toBe(90);
      expect(closed?.profit).toBeCloseTo(100, 10);
    });
  });

  describe("both legs inside one bar", () => {
    it("assumes open→high→low→close when the open is closer to the high", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 108, 112, 93, 100));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(110);
    });

    it("assumes open→low→high→close when the open is closer to the low", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 96, 112, 93, 100));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(95);
    });
  });

  describe("oca.reduce and lifecycle", () => {
    it("cancels the stop leg once the limit leg fills", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      engine.processBar(bar(2, 104, 111, 103, 108));
      engine.entry("L", "long", 10);
      engine.processBar(bar(3, 100, 101, 99, 100));
      engine.processBar(bar(4, 99, 100, 80, 85));
      expect(engine.getClosedTrades()).toHaveLength(1);
      expect(engine.position_size).toBe(10);
    });

    it("activates an exit placed while its entry is still pending", () => {
      engine.entry("L", "long", 10);
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.processBar(bar(1, 100, 101, 99, 100));
      expect(engine.position_size).toBe(10);
      engine.processBar(bar(2, 98, 99, 94, 96));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(95);
    });

    it("stops out on the entry bar when the stop is reached after the entry fill", () => {
      engine.entry("L", "long", 10);
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.processBar(bar(1, 100, 101, 94, 96));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(95);
      expect(engine.position_size).toBe(0);
    });

    it("only checks the price path after a mid-bar entry fill", () => {
      // open→low→high→close (tie goes to the low path): 100→94→106→104.
      // The stop entry fills at 105 on the low→high leg, after the low of 94.
      engine.entry("L", "long", 10, { stop: 105 });
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.processBar(bar(1, 100, 106, 94, 104));
      expect(engine.position_size).toBe(10);
      expect(engine.getClosedTrades()).toHaveLength(0);
    });

    it("stops out after a mid-bar limit entry when the remaining path reaches the stop", () => {
      // open→high→low→close: 100→101→90→99. Limit entry at 95 on the high→low
      // leg; the rest of that leg reaches the stop at 92.
      engine.entry("L", "long", 10, { limit: 95 });
      engine.exit("X", "L", undefined, { stop: 92 });
      engine.processBar(bar(1, 100, 101, 90, 99));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(92);
    });

    it("does not evaluate exits on the entry bar when orders fill on close", () => {
      engine.configure({ title: "Exit", initial_capital: 10_000, process_orders_on_close: true });
      engine.entry("L", "long", 10);
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.processBar(bar(1, 100, 101, 90, 100));
      expect(engine.position_size).toBe(10);
      engine.processBar(bar(2, 100, 101, 94, 96));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(95);
    });

    it("replaces a pending exit when called again with the same id", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.exit("X", "L", undefined, { stop: 98 });
      engine.processBar(bar(2, 100, 101, 97, 99));
      expect(engine.getClosedTrades()).toHaveLength(1);
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(98);
    });

    it("drops exits when their trade is closed elsewhere", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.close("L");
      engine.processBar(bar(2, 100, 101, 99, 100));
      engine.entry("L", "long", 10);
      engine.processBar(bar(3, 100, 101, 99, 100));
      engine.processBar(bar(4, 99, 100, 80, 85));
      expect(engine.getClosedTrades()).toHaveLength(1);
      expect(engine.position_size).toBe(10);
    });

    it("drops exits whose pending entry was cancelled", () => {
      engine.entry("L", "long", 10, { limit: 50 });
      engine.exit("X", "L", undefined, { stop: 45 });
      engine.cancel("L");
      engine.processBar(bar(1, 100, 101, 99, 100));
      engine.entry("L", "long", 10);
      engine.processBar(bar(2, 100, 101, 99, 100));
      engine.processBar(bar(3, 50, 51, 40, 45));
      expect(engine.getClosedTrades()).toHaveLength(0);
    });

    it("cancel(id) removes a pending exit", () => {
      openLong();
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.cancel("X");
      engine.processBar(bar(2, 100, 101, 90, 92));
      expect(engine.position_size).toBe(10);
    });
  });

  describe("quantity", () => {
    it("closes only qty and leaves the remainder open", () => {
      openLong(10);
      engine.exit("X", "L", 4, { stop: 95 });
      engine.processBar(bar(2, 100, 101, 94, 96));
      expect(engine.getClosedTrades()[0]?.qty).toBe(4);
      expect(engine.position_size).toBe(6);
    });

    it("rejects a non-positive qty", () => {
      openLong();
      expect(() => engine.exit("X", "L", 0, { stop: 95 })).toThrow(/qty/);
    });
  });

  describe("profit / loss in ticks", () => {
    it("converts ticks to prices from the entry price using mintick", () => {
      engine.setMintick(0.5);
      openLong();
      engine.exit("X", "L", undefined, { loss: 10, profit: 20 });
      engine.processBar(bar(2, 100, 101, 94, 96));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(95);
    });

    it("uses whichever take-profit level triggers first when limit and profit are both set", () => {
      engine.setMintick(1);
      openLong();
      engine.exit("X", "L", undefined, { limit: 120, profit: 5 });
      engine.processBar(bar(2, 101, 106, 100, 104));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(105);
    });

    it("uses whichever stop level triggers first for shorts", () => {
      engine.setMintick(1);
      openShort();
      engine.exit("X", "S", undefined, { stop: 110, loss: 3 });
      engine.processBar(bar(2, 101, 104, 100, 102));
      expect(engine.getClosedTrades()[0]?.exitPrice).toBe(103);
    });

    it("requires mintick for tick-based levels", () => {
      openLong();
      expect(() => engine.exit("X", "L", undefined, { loss: 10 })).toThrow(/mintick/);
    });

    it("rejects an exit with no price levels", () => {
      openLong();
      expect(() => engine.exit("X", "L", undefined, {})).toThrow(/limit, stop, profit or loss/);
    });
  });
});
