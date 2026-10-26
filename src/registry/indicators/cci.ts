import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const cci: Indicator = defineIndicator({
  id: "cci",
  name: "Commodity Channel Index",
  category: "oscillator",
  description: "Measures the variation of price relative to its statistical moving average.",
  version: "1.0.0",
  tags: ["momentum", "oscillator"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 20, { min: 1, max: 100000 }),
  ],
  plots: [
    linePlot("main", "CCI", { color: "#e91e63", linewidth: 2, pane: "sub" }),
    linePlot("upper", "Upper Band", { color: "#888888", style: "dotted", pane: "sub" }),
    linePlot("lower", "Lower Band", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return {
      main: ta.cci(source, length).at(0),
      upper: 100,
      lower: -100,
    };
  },
});
