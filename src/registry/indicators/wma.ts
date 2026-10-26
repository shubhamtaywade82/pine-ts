import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const wma: Indicator = defineIndicator({
  id: "wma",
  name: "Weighted Moving Average",
  category: "overlay",
  description: "Linearly weighted moving average giving higher weight to recent prices.",
  version: "1.0.0",
  tags: ["trend", "moving-average"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 9, { min: 1, max: 100000 }),
  ],
  plots: [linePlot("main", "WMA", { color: "#9c27b0", linewidth: 2, pane: "main" })],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return { main: ta.wma(source, length).at(0) };
  },
});
