import { smc } from "../../index.js";
import { defineIndicator, floatInput } from "../define.js";
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
  plots: [],
  calculate: ({ ctx, inputs, draw }) => {
    const tolerancePercent = readNumber(inputs, "tolerancePercent");
    const struct = ctx.scope("smcStructure", () => smc.structure({ swingLength: 5 }));
    const res = ctx.scope("smcLiquidity", () => smc.liquidity(struct, { tolerancePercent }));
    draw?.liquidity(res, struct);
    return {};
  },
});
