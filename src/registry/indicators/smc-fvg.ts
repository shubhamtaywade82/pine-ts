import { smc } from "../../index.js";
import { defineIndicator, floatInput } from "../define.js";
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
  plots: [],
  calculate: ({ ctx, inputs, draw }) => {
    const minSizePercent = readNumber(inputs, "minSizePercent");
    const res = ctx.scope("smcFvg", () => smc.fairValueGaps({ minSizePercent }));
    draw?.fvg(res);
    return {};
  },
});
