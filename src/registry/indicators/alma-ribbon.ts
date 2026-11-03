import { ta } from "../../index.js";
import { defineIndicator, floatInput, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const almaRibbon: Indicator = defineIndicator({
  id: "alma_ribbon",
  name: "ALMA Trend Ribbon",
  category: "overlay",
  description:
    "Multi-ALMA trend ribbon featuring Fast, Signal, Trend, and Macro Arnaud Legoux Moving Averages.",
  version: "1.0.0",
  tags: ["trend", "moving-average", "overlay", "ribbon"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("fastLength", "Fast Length", 9, { min: 1, max: 1000 }),
    intInput("signalLength", "Signal Length", 21, { min: 1, max: 1000 }),
    intInput("trendLength", "Trend Length", 50, { min: 1, max: 2000 }),
    intInput("macroLength", "Macro Length", 150, { min: 1, max: 5000 }),
    floatInput("offset", "Offset", 0.85, { min: 0, max: 1, step: 0.05 }),
    floatInput("sigma", "Sigma", 6, { min: 0.1, max: 100, step: 0.5 }),
  ],
  plots: [
    linePlot("fast", "ALMA Fast", { color: "#facc15", linewidth: 2, pane: "main" }),
    linePlot("signal", "ALMA Signal", { color: "#3b82f6", linewidth: 2, pane: "main" }),
    linePlot("trend", "ALMA Trend", { color: "#a855f7", linewidth: 2, pane: "main" }),
    linePlot("macro", "ALMA Macro", { color: "#ef4444", linewidth: 2, pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const fastLen = readNumber(inputs, "fastLength");
    const signalLen = readNumber(inputs, "signalLength");
    const trendLen = readNumber(inputs, "trendLength");
    const macroLen = readNumber(inputs, "macroLength");
    const offset = readNumber(inputs, "offset");
    const sigma = readNumber(inputs, "sigma");

    return {
      fast: ta.alma(source, fastLen, offset, sigma).at(0),
      signal: ta.alma(source, signalLen, offset, sigma).at(0),
      trend: ta.alma(source, trendLen, offset, sigma).at(0),
      macro: ta.alma(source, macroLen, offset, sigma).at(0),
    };
  },
});
