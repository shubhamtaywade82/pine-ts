import { community } from "../../index.js";
import { defineIndicator, floatInput, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const mlSupertrend: Indicator = defineIndicator({
  id: "ml_supertrend",
  name: "ML Adaptive Supertrend [AlgoAlpha]",
  category: "overlay",
  description: "Machine Learning Adaptive Supertrend using K-Means volatility clustering.",
  version: "1.0.0",
  tags: ["machine-learning", "trend", "overlay", "volatility"],
  inputs: [
    floatInput("factor", "Factor", 3, { min: 0.1, max: 100, step: 0.1 }),
    intInput("atrLength", "ATR Length", 10, { min: 1, max: 1000 }),
    intInput("trainingPeriod", "Training Window", 100, { min: 20, max: 5000 }),
  ],
  plots: [
    linePlot("upTrend", "ML Up Trend", { color: "#00e676", linewidth: 2, pane: "main" }),
    linePlot("downTrend", "ML Down Trend", { color: "#ff1744", linewidth: 2, pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const factor = readNumber(inputs, "factor");
    const atrLength = readNumber(inputs, "atrLength");
    const trainingPeriod = readNumber(inputs, "trainingPeriod");
    const res = ctx.scope("mlSupertrend", () =>
      community.mlAdaptiveSupertrend({ factor, atrLength, trainingPeriod }),
    );
    const dir = res.direction.at(0);
    const val = res.supertrend.at(0);
    const isUp = dir !== undefined && dir < 0;
    const isDown = dir !== undefined && dir > 0;
    return {
      upTrend: isUp ? val : Number.NaN,
      downTrend: isDown ? val : Number.NaN,
    };
  },
});
