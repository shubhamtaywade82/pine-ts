import { ta } from "../../index.js";
import {
  boolInput,
  defineIndicator,
  fillBandPlot,
  floatInput,
  intInput,
  linePlot,
} from "../define.js";
import { type Indicator } from "../types.js";
import { readBoolean, readNumber } from "../helpers.js";

export const kc: Indicator = defineIndicator({
  id: "kc",
  name: "Keltner Channels",
  category: "bands",
  description: "Volatility channels based on an EMA basis with ATR-derived upper and lower bands.",
  version: "1.0.0",
  tags: ["volatility", "bands"],
  inputs: [
    intInput("length", "Length", 20, { min: 1, max: 5000 }),
    floatInput("mult", "Multiplier", 2.0, { min: 0.1, max: 50, step: 0.1 }),
    boolInput("useTrueRange", "Use True Range", true),
  ],
  plots: [
    linePlot("middle", "Basis", { color: "#2196f3", linewidth: 1, pane: "main" }),
    linePlot("upper", "Upper Channel", { color: "#26a69a", linewidth: 1, pane: "main" }),
    linePlot("lower", "Lower Channel", { color: "#ef5350", linewidth: 1, pane: "main" }),
    fillBandPlot("bg", ["upper", "lower"], "Background", { color: "#2196f3", pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const length = readNumber(inputs, "length");
    const mult = readNumber(inputs, "mult");
    const useTrueRange = readBoolean(inputs, "useTrueRange");
    const result = ctx.scope("kc", () => ta.kc(ctx.close, length, mult, useTrueRange));
    return {
      middle: result.middle.at(0),
      upper: result.upper.at(0),
      lower: result.lower.at(0),
    };
  },
});
