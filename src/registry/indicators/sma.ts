/**
 * Simple Moving Average indicator.
 *
 * - Source: any of `open` / `high` / `low` / `close` / `hl2` / `hlc3` / `ohlc4` (default: `close`).
 * - Length: integer ≥ 1 (default: 14).
 *
 * One plot: `main` (line, overlay on the price pane).
 */

import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const sma: Indicator = defineIndicator({
  id: "sma",
  name: "Simple Moving Average",
  category: "overlay",
  description:
    "The simple moving average of `source` over the last `length` bars. " +
    "Returns na during warm-up until `length` non-na values have been received.",
  version: "1.0.0",
  tags: ["trend", "moving-average"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 14, { min: 1, max: 5000 }),
  ],
  plots: [
    linePlot("main", "SMA", { color: "#1e88e5", linewidth: 2, pane: "main" }),
  ],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return { main: ta.sma(source, length).at(0) };
  },
});
