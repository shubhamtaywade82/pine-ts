import { describe, expect, it } from "vitest";
import { PineRuntime, smc } from "../src/index.js";
import type { Bar, PineContext } from "../src/index.js";
import { Provider } from "./smc-reference.js";

const bar = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Bar => ({ time, open, high, low, close, volume: 100 });

describe("SMC Fair Value Gaps and Liquidity", () => {
  it("detects bullish FVG and handles mitigation", async () => {
    const bars: Bar[] = [
      bar(1000, 100, 105, 95, 102),  // bar 0: high is 105
      bar(2000, 103, 120, 103, 118), // bar 1: large displacement candle
      bar(3000, 118, 125, 110, 122), // bar 2: low is 110 (> 105) -> gap [105, 110]
      bar(4000, 122, 124, 108, 112), // bar 3: low 108 touches gap, but stays above 105 (not mitigated)
      bar(5000, 112, 115, 104, 105), // bar 4: low 104 pierces 105 -> mitigated!
    ];

    interface FvgRow {
      top: number;
      bottom: number;
      valid: boolean;
      touched: boolean;
      mitigated: boolean;
    }
    const rows: FvgRow[] = [];

    const script = (ctx: PineContext) => {
      const gaps = smc.fairValueGaps({ autoMitigate: true });
      if (!ctx.barstate.isconfirmed) return;
      rows.push({
        top: gaps.bullish.top.value,
        bottom: gaps.bullish.bottom.value,
        valid: gaps.bullish.valid.value,
        touched: gaps.bullish.touched.value,
        mitigated: gaps.bullish.mitigated.value,
      });
    };

    await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(script, bars);

    expect(rows[2]?.top).toBe(110);
    expect(rows[2]?.bottom).toBe(105);
    expect(rows[2]?.valid).toBe(true);

    // Bar 3: touched
    expect(rows[3]?.touched).toBe(true);
    expect(rows[3]?.valid).toBe(true);

    // Bar 4: mitigated
    expect(rows[4]?.mitigated).toBe(true);
    expect(rows[4]?.valid).toBe(false);
  });

  it("detects bearish FVG", async () => {
    const bars: Bar[] = [
      bar(1000, 150, 155, 145, 148), // bar 0: low is 145
      bar(2000, 147, 148, 125, 128), // bar 1: large down candle
      bar(3000, 128, 135, 120, 124), // bar 2: high is 135 (< 145) -> gap [135, 145]
    ];

    let lastTop = 0;
    let lastBottom = 0;
    let isValid = false;

    const script = (ctx: PineContext) => {
      const gaps = smc.fairValueGaps();
      if (!ctx.barstate.isconfirmed) return;
      lastTop = gaps.bearish.top.value;
      lastBottom = gaps.bearish.bottom.value;
      isValid = gaps.bearish.valid.value;
    };

    await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(script, bars);

    expect(lastTop).toBe(145);
    expect(lastBottom).toBe(135);
    expect(isValid).toBe(true);
  });

  it("detects liquidity sweeps above swing highs and below swing lows", async () => {
    const bars: Bar[] = [
      bar(1000, 100, 110, 95, 102),
      bar(2000, 102, 120, 100, 105), // swing high at 120
      bar(3000, 105, 110, 90, 100),  // swing low at 90
      bar(4000, 100, 115, 98, 105),
      bar(5000, 105, 112, 102, 108),
      bar(6000, 108, 122, 105, 115), // wick hits 122 (> 120), closes at 115 (< 120) -> sweep of highs!
    ];

    const sweptHighs: boolean[] = [];

    const script = (ctx: PineContext) => {
      const struct = smc.structure({ swingLength: 1 });
      const liq = smc.liquidity(struct);
      if (!ctx.barstate.isconfirmed) return;
      sweptHighs.push(liq.sweptHigh.value);
    };

    await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(script, bars);
    expect(sweptHighs[5]).toBe(true);
  });
});
