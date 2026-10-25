/**
 * Moving Average Convergence Divergence (MACD) indicator.
 *
 * - Source: any of the Pine selectors (default: `close`).
 * - Fast Length: integer ≥ 1 (default: 12).
 * - Slow Length: integer ≥ 1 (default: 26).
 * - Signal Length: integer ≥ 1 (default: 9).
 *
 * Four plots (sub-pane):
 * - `macd`: MACD line = `ema(source, fast) - ema(source, slow)`.
 * - `signal`: signal line = `ema(macd, signal)`.
 * - `histogram`: histogram = `macd - signal`.
 * - `zero`: zero baseline (for orientation).
 *
 * The MACD line, signal line, and histogram are composed from pine-ts's
 * `ta.macd` node (which is itself composed from `ta.ema`).
 */

import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, histogramPlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const macd: Indicator = defineIndicator({
  id: "macd",
  name: "Moving Average Convergence Divergence",
  category: "oscillator",
  description:
    "MACD = EMA(source, fast) - EMA(source, slow); Signal = EMA(MACD, signal); " +
    "Histogram = MACD - Signal. Default 12/26/9.",
  version: "1.0.0",
  tags: ["momentum", "oscillator", "trend"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("fastLength", "Fast Length", 12, { min: 1, max: 100000 }),
    intInput("slowLength", "Slow Length", 26, { min: 1, max: 100000 }),
    intInput("signalLength", "Signal Length", 9, { min: 1, max: 100000 }),
  ],
  plots: [
    linePlot("macd", "MACD", { color: "#1e88e5", linewidth: 2, pane: "sub" }),
    linePlot("signal", "Signal", { color: "#ff6d00", linewidth: 1, pane: "sub" }),
    histogramPlot("histogram", "Histogram", { color: "#888888", pane: "sub" }),
    linePlot("zero", "Zero", { color: "#444444", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const fastLength = readNumber(inputs, "fastLength");
    const slowLength = readNumber(inputs, "slowLength");
    const signalLength = readNumber(inputs, "signalLength");
    // `ta.macd` returns a MacdResult; we cache it in `ctx.scope` so the node
    // is reused across bars (otherwise we'd create a new MACD graph each bar).
    const result = ctx.scope("macd", () =>
      ta.macd(source, fastLength, slowLength, signalLength),
    );
    return {
      macd: result.macdLine.at(0),
      signal: result.signalLine.at(0),
      histogram: result.histLine.at(0),
      zero: 0,
    };
  },
});
