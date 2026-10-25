/**
 * Bollinger Bands indicator.
 *
 * - Source: any of the Pine selectors (default: `close`).
 * - Length: integer ≥ 1 (default: 20).
 * - Mult: float ≥ 0 (default: 2.0).
 *
 * Three plots (overlay):
 * - `middle`: SMA basis (color: `#1e88e5`).
 * - `upper`: middle + mult * stdev (color: `#7e57c2`).
 * - `lower`: middle - mult * stdev (color: `#7e57c2`).
 * - `bg`: the band fill (between upper and lower, low-opacity).
 *
 * Composed from `ta.bb` (which composes `ta.sma` + `ta.stdev`).
 */

import { ta } from "../../index.js";
import {
  defineIndicator,
  floatInput,
  intInput,
  linePlot,
  fillBandPlot,
  sourceInput,
} from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const bb: Indicator = defineIndicator({
  id: "bb",
  name: "Bollinger Bands",
  category: "bands",
  description:
    "Bollinger Bands: SMA(source, length) basis with `mult` standard-deviation bands. " +
    "Default 20 / 2.0.",
  version: "1.0.0",
  tags: ["volatility", "bands"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 20, { min: 1, max: 5000 }),
    floatInput("mult", "Std Dev Multiplier", 2.0, { min: 0, max: 50, step: 0.1 }),
  ],
  plots: [
    linePlot("middle", "Basis", { color: "#1e88e5", linewidth: 1, pane: "main" }),
    linePlot("upper", "Upper Band", { color: "#7e57c2", linewidth: 1, pane: "main" }),
    linePlot("lower", "Lower Band", { color: "#7e57c2", linewidth: 1, pane: "main" }),
    fillBandPlot("bg", ["upper", "lower"], "Background", {
      color: "#7e57c2",
      pane: "main",
    }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    const mult = readNumber(inputs, "mult");
    const result = ctx.scope("bb", () => ta.bb(source, length, mult));
    return {
      middle: result.middle.at(0),
      upper: result.upper.at(0),
      lower: result.lower.at(0),
    };
  },
});
