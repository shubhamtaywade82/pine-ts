import { ta } from "../../index.js";
import {
  boolInput,
  defineIndicator,
  floatInput,
  intInput,
  linePlot,
  sourceInput,
} from "../define.js";
import { type Indicator } from "../types.js";
import { readBoolean, readNumber, readString, resolveSource } from "../helpers.js";

export const alma: Indicator = defineIndicator({
  id: "alma",
  name: "Arnaud Legoux Moving Average",
  category: "overlay",
  description: "Gaussian-weighted moving average reducing lag while retaining smoothness.",
  version: "1.0.0",
  tags: ["trend", "moving-average", "overlay"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 9, { min: 1, max: 10000 }),
    floatInput("offset", "Offset", 0.85, { min: 0, max: 1, step: 0.05 }),
    floatInput("sigma", "Sigma", 6, { min: 0.1, max: 100, step: 0.5 }),
    boolInput("floor", "Floor Offset", false),
  ],
  plots: [linePlot("main", "ALMA", { color: "#00e5ff", linewidth: 2, pane: "main" })],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    const offset = readNumber(inputs, "offset");
    const sigma = readNumber(inputs, "sigma");
    const floor = readBoolean(inputs, "floor");
    return { main: ta.alma(source, length, offset, sigma, floor).at(0) };
  },
});
