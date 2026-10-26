import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const mtfTrend: Indicator = defineIndicator({
  id: "mtf_trend",
  name: "Multi-Timeframe Trend Ribbon",
  category: "overlay",
  description:
    "Multi-Timeframe EMA trend ribbon showing short-, medium-, and long-term trend alignment.",
  version: "1.0.0",
  tags: ["trend", "overlay", "moving-average", "mtf"],
  inputs: [
    intInput("fastLength", "Fast Length", 20, { min: 1, max: 1000 }),
    intInput("mediumLength", "Medium Length", 50, { min: 1, max: 1000 }),
    intInput("slowLength", "Slow Length", 200, { min: 1, max: 5000 }),
  ],
  plots: [
    linePlot("fast", "Fast EMA", { color: "#00e5ff", linewidth: 1, pane: "main" }),
    linePlot("medium", "Medium EMA", { color: "#ffd600", linewidth: 1, pane: "main" }),
    linePlot("slow", "Slow EMA", { color: "#ff3d00", linewidth: 2, pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const fastLength = readNumber(inputs, "fastLength");
    const mediumLength = readNumber(inputs, "mediumLength");
    const slowLength = readNumber(inputs, "slowLength");
    return {
      fast: ta.ema(ctx.close, fastLength).at(0),
      medium: ta.ema(ctx.close, mediumLength).at(0),
      slow: ta.ema(ctx.close, slowLength).at(0),
    };
  },
});
