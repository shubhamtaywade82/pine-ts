import { ta } from "../../index.js";
import { defineIndicator, floatInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const sar: Indicator = defineIndicator({
  id: "sar",
  name: "Parabolic SAR",
  category: "overlay",
  description:
    "Parabolic Stop and Reverse highlights trailing price stops and potential turning points.",
  version: "1.0.0",
  tags: ["trend", "overlay"],
  inputs: [
    floatInput("start", "Start", 0.02, { min: 0.001, max: 1, step: 0.005 }),
    floatInput("increment", "Increment", 0.02, { min: 0.001, max: 1, step: 0.005 }),
    floatInput("maximum", "Maximum", 0.2, { min: 0.01, max: 1, step: 0.01 }),
  ],
  plots: [
    linePlot("main", "SAR", { color: "#2962ff", linewidth: 1, style: "dotted", pane: "main" }),
  ],
  calculate: ({ inputs }) => {
    const start = readNumber(inputs, "start");
    const inc = readNumber(inputs, "increment");
    const max = readNumber(inputs, "maximum");
    return { main: ta.sar(start, inc, max).at(0) };
  },
});
