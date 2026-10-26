import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const atr: Indicator = defineIndicator({
  id: "atr",
  name: "Average True Range",
  category: "oscillator",
  description:
    "Wilder's Average True Range measures market volatility through smoothed true range.",
  version: "1.0.0",
  tags: ["volatility", "oscillator"],
  inputs: [intInput("length", "Length", 14, { min: 1, max: 100000 })],
  plots: [linePlot("main", "ATR", { color: "#b388ff", linewidth: 2, pane: "sub" })],
  calculate: ({ inputs }) => {
    const length = readNumber(inputs, "length");
    return { main: ta.atr(length).at(0) };
  },
});
