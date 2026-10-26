import { smc } from "../../index.js";
import { defineIndicator, floatInput } from "../define.js";
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
  plots: [],
  calculate: ({ ctx, inputs, draw }) => {
    const minBodyPercent = readNumber(inputs, "minBodyPercent");
    const res = ctx.scope("smcOb", () => {
      const struct = smc.structure({ swingLength: 5 });
      return smc.orderBlocks(struct, { minBodyPercent });
    });
    draw?.orderBlocks(res, { text: "OB" });
    return {};
  },
});
