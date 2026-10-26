import { smc } from "../../index.js";
import { defineIndicator, fillBandPlot, floatInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const smcFvg: Indicator = defineIndicator({
  id: "smc_fvg",
  name: "SMC Fair Value Gaps",
  category: "bands",
  description: "Smart Money Concepts bullish and bearish Fair Value Gap (FVG) imbalance zones.",
  version: "1.0.0",
  tags: ["smc", "imbalance", "fvg", "overlay"],
  inputs: [floatInput("minSizePercent", "Min Gap Size %", 0, { min: 0, max: 10, step: 0.05 })],
  plots: [
    linePlot("bullishTop", "Bullish FVG Top", { color: "#089981", linewidth: 1, pane: "main" }),
    linePlot("bullishBottom", "Bullish FVG Bottom", {
      color: "#089981",
      linewidth: 1,
      pane: "main",
    }),
    linePlot("bearishTop", "Bearish FVG Top", { color: "#f23645", linewidth: 1, pane: "main" }),
    linePlot("bearishBottom", "Bearish FVG Bottom", {
      color: "#f23645",
      linewidth: 1,
      pane: "main",
    }),
    fillBandPlot("bullishBg", ["bullishTop", "bullishBottom"], "Bullish FVG Zone", {
      color: "#089981",
      pane: "main",
    }),
    fillBandPlot("bearishBg", ["bearishTop", "bearishBottom"], "Bearish FVG Zone", {
      color: "#f23645",
      pane: "main",
    }),
  ],
  calculate: ({ ctx, inputs }) => {
    const minSizePercent = readNumber(inputs, "minSizePercent");
    const res = ctx.scope("smcFvg", () => smc.fairValueGaps({ minSizePercent }));
    const bullValid = res.bullish.valid.at(0) === true;
    const bearValid = res.bearish.valid.at(0) === true;
    return {
      bullishTop: bullValid ? res.bullish.top.at(0) : Number.NaN,
      bullishBottom: bullValid ? res.bullish.bottom.at(0) : Number.NaN,
      bearishTop: bearValid ? res.bearish.top.at(0) : Number.NaN,
      bearishBottom: bearValid ? res.bearish.bottom.at(0) : Number.NaN,
    };
  },
});
