/**
 * Exponential Moving Average indicator.
 *
 * - Source: any of `open` / `high` / `low` / `close` / `hl2` / `hlc3` / `hlcc4` / `ohlc4` (default: `close`).
 * - Length: integer ≥ 1 (default: 12). The `alpha` is `2 / (length + 1)`.
 *
 * One plot: `main` (line, overlay on the price pane).
 *
 * Pine v6 EMA semantics (verified bit-for-bit — see
 * `tests/reference-pine-vectors-running-sum.test.ts`):
 * - `na` until the bar supplying the `length`-th valid source value, then
 *   seeds with `ta.sma` of those first `length` valid values (Kahan order).
 * - From the next bar on: `(value - previous) * alpha + previous`.
 * - `na` / `±Infinity` source values skip the smoothing step (state
 *   preserved across na bars).
 */

import { ta } from "../../index.js";
import { defineIndicator, intInput, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readNumber, readString, resolveSource } from "../helpers.js";

export const ema: Indicator = defineIndicator({
  id: "ema",
  name: "Exponential Moving Average",
  category: "overlay",
  description:
    "The exponential moving average of `source` over `length` bars. " +
    "Seeds with `ta.sma` of the first `length` valid values (Kahan order); " +
    "from the next bar on, applies `alpha * value + (1 - alpha) * previous` " +
    "where `alpha = 2 / (length + 1)`. Verified bit-for-bit against PineScript.",
  version: "1.0.0",
  tags: ["trend", "moving-average"],
  inputs: [
    sourceInput("source", "Source", "close"),
    intInput("length", "Length", 12, { min: 1, max: 100000 }),
  ],
  plots: [linePlot("main", "EMA", { color: "#ff6d00", linewidth: 2, pane: "main" })],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    const length = readNumber(inputs, "length");
    return { main: ta.ema(source, length).at(0) };
  },
});
