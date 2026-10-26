import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const dmi: Indicator = defineIndicator({
  id: "dmi",
  name: "Directional Movement Index",
  category: "oscillator",
  description: "DMI and Average Directional Index (ADX) quantifying trend strength and direction.",
  version: "1.0.0",
  tags: ["trend", "momentum", "oscillator"],
  inputs: [
    intInput("diLength", "DI Length", 14, { min: 1, max: 5000 }),
    intInput("adxSmoothing", "ADX Smoothing", 14, { min: 1, max: 5000 }),
  ],
  plots: [
    linePlot("adx", "ADX", { color: "#ff007f", linewidth: 2, pane: "sub" }),
    linePlot("plusDI", "+DI", { color: "#22c55e", linewidth: 1, pane: "sub" }),
    linePlot("minusDI", "-DI", { color: "#ef4444", linewidth: 1, pane: "sub" }),
    linePlot("keyLevel", "Key Level", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const diLength = readNumber(inputs, "diLength");
    const adxSmoothing = readNumber(inputs, "adxSmoothing");
    const result = ctx.scope("dmi", () => ta.dmi(diLength, adxSmoothing));
    return {
      adx: result.adx.at(0),
      plusDI: result.plusDI.at(0),
      minusDI: result.minusDI.at(0),
      keyLevel: 20,
    };
  },
});
