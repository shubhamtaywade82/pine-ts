import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const hma: Indicator = defineIndicator({
  id: "hma",
  name: "Hull Moving Average",
  category: "overlay",
  description: "Hull Moving Average combines responsiveness with smoothing to reduce lag.",
  version: "1.0.0",
  tags: ["trend", "moving-average"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 9, { min: 1, max: 100000 }),
  ],
  plots: [linePlot("main", "HMA", { color: "#00bcd4", linewidth: 2, pane: "main" })],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return { main: ta.hma(source, length).at(0) };
  },
});
