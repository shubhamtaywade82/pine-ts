import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const wpr: Indicator = defineIndicator({
  id: "wpr",
  name: "Williams %R",
  category: "oscillator",
  description: "Momentum indicator measuring overbought and oversold levels between 0 and -100.",
  version: "1.0.0",
  tags: ["momentum", "oscillator"],
  inputs: [intInput("length", "Length", 14, { min: 1, max: 100000 })],
  plots: [
    linePlot("main", "%R", { color: "#009688", linewidth: 2, pane: "sub" }),
    linePlot("upper", "Upper Band", { color: "#888888", style: "dotted", pane: "sub" }),
    linePlot("lower", "Lower Band", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ inputs }) => {
    const length = readNumber(inputs, "length");
    return {
      main: ta.wpr(length).at(0),
      upper: -20,
      lower: -80,
    };
  },
});
