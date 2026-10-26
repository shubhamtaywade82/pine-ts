import { describe, expect, it } from "vitest";
import { defineStrategy } from "../src/script/index.js";
import { StrategyEngine } from "../src/strategy/index.js";
import type { Bar } from "../src/index.js";

const bar = (time: number, open: number, high: number, low: number, close: number): Bar => ({
  time,
  open,
  high,
  low,
  close,
  volume: 100,
});

describe("trade excursions (MFE / MAE) and margin", () => {
  it("tracks max runup and max drawdown on a long trade", () => {
    const engine = new StrategyEngine();
    engine.configure({ title: "Excursion Test", initial_capital: 10000 });

    // Bar 1: Entry order submitted
    engine.entry("long1", "long", 1);
    engine.processBar(bar(1000, 100, 100, 100, 100));

    // Bar 2: Market entry fills at open 100.
    // Intrabar goes up to 120 (favorable +20), down to 90 (adverse -10), closes at 115.
    engine.processBar(bar(2000, 100, 120, 90, 115));
    const [openTrade] = engine.getOpenTrades();
    expect(openTrade?.runUp).toBe(20);
    expect(openTrade?.drawDown).toBe(10);

    // Bar 3: Extends higher to 130 (runUp -> 30), low only drops to 110, close 125.
    engine.processBar(bar(3000, 115, 130, 110, 125));
    expect(engine.getOpenTrades()[0]?.runUp).toBe(30);
    expect(engine.getOpenTrades()[0]?.drawDown).toBe(10);

    // Bar 4: Exits at close 125.
    engine.close("long1");
    engine.processBar(bar(4000, 125, 128, 124, 125));

    const [closedTrade] = engine.getClosedTrades();
    expect(closedTrade?.runUp).toBe(30);
    expect(closedTrade?.drawDown).toBe(10);
    expect(closedTrade?.profit).toBe(25);
  });

  it("tracks max runup and max drawdown on a short trade", () => {
    const engine = new StrategyEngine();
    engine.configure({ title: "Excursion Short", initial_capital: 10000 });

    engine.entry("short1", "short", 2);
    engine.processBar(bar(1000, 100, 100, 100, 100));

    // Entry at 100 for 2 units.
    // Price drops to 80 (favorable by 20 * 2 = 40), spikes to 110 (adverse by 10 * 2 = 20).
    engine.processBar(bar(2000, 100, 110, 80, 85));
    const [openTrade] = engine.getOpenTrades();
    expect(openTrade?.runUp).toBe(40);
    expect(openTrade?.drawDown).toBe(20);

    engine.close("short1");
    engine.processBar(bar(3000, 85, 90, 80, 85));

    const [closedTrade] = engine.getClosedTrades();
    expect(closedTrade?.runUp).toBe(40);
    expect(closedTrade?.drawDown).toBe(20);
    expect(closedTrade?.profit).toBe((100 - 85) * 2);
  });

  it("records margin usage across bars in backtest()", async () => {
    const marginStrategy = defineStrategy("Margin Strategy", { margin_long: 50 }, (api) => {
      if (api.bar_index.value === 1) api.strategy.entry("long", "long", { qty: 2 });
      if (api.bar_index.value === 3) api.strategy.close("long");
    });

    const bars: Bar[] = [
      bar(1000, 100, 105, 95, 100),
      bar(2000, 100, 105, 95, 100), // enters at next bar open 100
      bar(3000, 100, 110, 90, 105), // position open: qty 2, price 105, margin 50% = 2 * 105 * 0.5 = 105
      bar(4000, 105, 115, 100, 110), // position closed at open 105
      bar(5000, 110, 115, 105, 110),
    ];

    const result = await marginStrategy.backtest(bars);
    expect(result.margin[2]).toBe(105);
    expect(result.margin[4]).toBe(0);
  });
});
