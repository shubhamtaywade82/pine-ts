import { smc } from "../../index.js";
import { defineIndicator, floatInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const smcLiquidity: Indicator = defineIndicator({
  id: "smc_liquidity",
  name: "SMC Liquidity Sweeps",
  category: "overlay",
  description: "Smart Money Concepts swing high/low liquidity runs and wick sweeps.",
  version: "1.0.0",
  tags: ["smc", "liquidity", "sweeps", "overlay"],
  inputs: [
    floatInput("tolerancePercent", "Equal High/Low %", 0.1, { min: 0.01, max: 2, step: 0.05 }),
  ],
  plots: [
    linePlot("sweptLevel", "Swept Level", {
      color: "#d500f9",
      linewidth: 2,
      style: "dotted",
      pane: "main",
    }),
  ],
  calculate: ({ ctx, inputs }) => {
    const tolerancePercent = readNumber(inputs, "tolerancePercent");
    const res = ctx.scope("smcLiquidity", () => {
      const struct = smc.structure({ swingLength: 5 });
      return smc.liquidity(struct, { tolerancePercent });
    });
    return {
      sweptLevel: res.sweptLevel.at(0),
    };
  },
});
