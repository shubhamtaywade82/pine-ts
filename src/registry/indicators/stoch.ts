import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber } from "../helpers.js";

export const stoch: Indicator = defineIndicator({
  id: "stoch",
  name: "Stochastic",
  category: "oscillator",
  description:
    "Stochastic oscillator compares the closing price to the high-low range over a lookback period.",
  version: "1.0.0",
  tags: ["momentum", "oscillator"],
  inputs: [
    intInput("kLength", "%K Length", 14, { min: 1, max: 5000 }),
    intInput("kSmoothing", "%K Smoothing", 1, { min: 1, max: 5000 }),
    intInput("dSmoothing", "%D Smoothing", 3, { min: 1, max: 5000 }),
  ],
  plots: [
    linePlot("k", "%K", { color: "#2196f3", linewidth: 2, pane: "sub" }),
    linePlot("d", "%D", { color: "#ff6d00", linewidth: 1, pane: "sub" }),
    linePlot("upper", "Upper Band", { color: "#888888", style: "dotted", pane: "sub" }),
    linePlot("lower", "Lower Band", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const kLength = readNumber(inputs, "kLength");
    const kSmoothing = readNumber(inputs, "kSmoothing");
    const dSmoothing = readNumber(inputs, "dSmoothing");
    const rawK = ctx.scope("stochRaw", () => ta.stoch(ctx.close, ctx.high, ctx.low, kLength));
    const k = ctx.scope("stochK", () => (kSmoothing > 1 ? ta.sma(rawK, kSmoothing) : rawK));
    const d = ctx.scope("stochD", () => ta.sma(k, dSmoothing));
    return {
      k: k.at(0),
      d: d.at(0),
      upper: 80,
      lower: 20,
    };
  },
});
