/**
 * Relative Strength Index indicator (Wilder).
 *
 * - Source: any of the Pine selectors (default: `close`).
 * - Length: integer ≥ 1 (default: 14).
 *
 * Three plots (sub-pane):
 * - `main`: the RSI line (color: `#7e57c2`).
 * - `upper`: the overbought band at 70 (dotted).
 * - `lower`: the oversold band at 30 (dotted).
 *
 * Pine v6 RSI semantics: Wilder smoothing, first value on the length-th
 * change bar. Verified `draft` (deterministic unit coverage; pinned via the
 * EMA kernel it composes from).
 */

import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const rsi: Indicator = defineIndicator({
  id: "rsi",
  name: "Relative Strength Index",
  category: "oscillator",
  description:
    "Wilder's Relative Strength Index. Returns a value in [0, 100]. " +
    "70 = overbought, 30 = oversold.",
  version: "1.0.0",
  tags: ["momentum", "oscillator"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 14, { min: 1, max: 100000 }),
  ],
  plots: [
    linePlot("main", "RSI", { color: "#7e57c2", linewidth: 2, pane: "sub" }),
    linePlot("upper", "Upper Band", { color: "#888888", style: "dotted", pane: "sub" }),
    linePlot("lower", "Lower Band", { color: "#888888", style: "dotted", pane: "sub" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return {
      main: ta.rsi(source, length).at(0),
      upper: 70,
      lower: 30,
    };
  },
});
