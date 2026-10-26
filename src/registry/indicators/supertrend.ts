import { ta } from "../../index.js";
import { defineIndicator, floatInput, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const supertrend: Indicator = defineIndicator({
  id: "supertrend",
  name: "Supertrend",
  category: "overlay",
  description:
    "ATR-based trailing stop tracking trend direction with line breaks on trend reversals.",
  version: "1.0.0",
  tags: ["trend", "overlay", "volatility"],
  inputs: [
    floatInput("factor", "Factor", 3, { min: 0.1, max: 100, step: 0.1 }),
    intInput("atrPeriod", "ATR Period", 10, { min: 1, max: 1000 }),
  ],
  plots: [
    linePlot("upTrend", "Up Trend", { color: "#089981", linewidth: 2, pane: "main" }),
    linePlot("downTrend", "Down Trend", { color: "#f23645", linewidth: 2, pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const factor = readNumber(inputs, "factor");
    const atrPeriod = readNumber(inputs, "atrPeriod");
    const st = ctx.scope("supertrend", () => ta.supertrend(factor, atrPeriod));
    const dir = st.direction.at(0);
    const value = st.supertrend.at(0);
    const isUp = dir !== undefined && dir < 0;
    const isDown = dir !== undefined && dir > 0;
    return {
      upTrend: isUp ? value : Number.NaN,
      downTrend: isDown ? value : Number.NaN,
    };
  },
});
