import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const mfi: Indicator = defineIndicator({
  id: "mfi",
  name: "Money Flow Index",
  category: "volume",
  description: "Volume-weighted oscillator that measures buying and selling momentum.",
  version: "1.0.0",
  tags: ["volume", "oscillator", "momentum"],
  inputs: [
    sourceInput("source", "Source", "hlc3"),
    intInput("length", "Length", 14, { min: 1, max: 100000 }),
  ],
  plots: [
    linePlot("main", "MFI", { color: "#26a69a", linewidth: 2, pane: "sub" }),
    linePlot("upper", "Upper Band", { color: "#888888", style: "dotted", pane: "sub" }),
    linePlot("lower", "Lower Band", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return {
      main: ta.mfi(source, length).at(0),
      upper: 80,
      lower: 20,
    };
  },
});
