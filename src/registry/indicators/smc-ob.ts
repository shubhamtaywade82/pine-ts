import { smc } from "../../index.js";
import { defineIndicator, fillBandPlot, floatInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const smcOb: Indicator = defineIndicator({
  id: "smc_ob",
  name: "SMC Order Blocks",
  category: "bands",
  description: "Smart Money Concepts institutional Order Block supply and demand zones.",
  version: "1.0.0",
  tags: ["smc", "order-blocks", "supply-demand", "overlay"],
  inputs: [floatInput("minBodyPercent", "Min Body %", 0, { min: 0, max: 10, step: 0.1 })],
  plots: [
    linePlot("bullishTop", "Bullish OB Top", { color: "#00b0ff", linewidth: 1, pane: "main" }),
    linePlot("bullishBottom", "Bullish OB Bottom", {
      color: "#00b0ff",
      linewidth: 1,
      pane: "main",
    }),
    linePlot("bearishTop", "Bearish OB Top", { color: "#ff5252", linewidth: 1, pane: "main" }),
    linePlot("bearishBottom", "Bearish OB Bottom", {
      color: "#ff5252",
      linewidth: 1,
      pane: "main",
    }),
    fillBandPlot("bullishBg", ["bullishTop", "bullishBottom"], "Bullish OB Zone", {
      color: "#00b0ff",
      pane: "main",
    }),
    fillBandPlot("bearishBg", ["bearishTop", "bearishBottom"], "Bearish OB Zone", {
      color: "#ff5252",
      pane: "main",
    }),
  ],
  calculate: ({ ctx, inputs }) => {
    const minBodyPercent = readNumber(inputs, "minBodyPercent");
    const res = ctx.scope("smcOb", () => {
      const struct = smc.structure({ swingLength: 5 });
      return smc.orderBlocks(struct, { minBodyPercent });
    });
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
