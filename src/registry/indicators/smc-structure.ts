import { smc } from "../../index.js";
import { defineIndicator, intInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const smcStructure: Indicator = defineIndicator({
  id: "smc_structure",
  name: "SMC Market Structure",
  category: "overlay",
  description: "Smart Money Concepts swing highs, swing lows, BOS, and CHoCH structure tracking.",
  version: "1.0.0",
  tags: ["smc", "structure", "overlay"],
  inputs: [intInput("swingLength", "Swing Length", 5, { min: 2, max: 100 })],
  plots: [],
  calculate: ({ ctx, inputs, draw }) => {
    const swingLength = readNumber(inputs, "swingLength");
    const res = ctx.scope("smcStructure", () => smc.structure({ swingLength }));
    draw?.structure(res, { showBOS: true, showCHoCH: true });
    return {};
  },
});
