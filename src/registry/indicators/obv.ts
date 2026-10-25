/**
 * On-Balance Volume indicator.
 *
 * - No inputs (reads `close` + `volume` from the bar context).
 *
 * One plot (sub-pane):
 * - `main`: cumulative volume signed by `sign(change(close))`.
 *
 * Composed from `ta.obv`. The first bar contributes nothing.
 */

import { ta } from "../../index.js";
import { defineIndicator, linePlot } from "../define.js";
import { type Indicator } from "../types.js";

export const obv: Indicator = defineIndicator({
  id: "obv",
  name: "On-Balance Volume",
  category: "volume",
  description:
    "Cumulative volume signed by `sign(change(close))`: positive when close rises, " +
    "negative when close falls, zero when close is unchanged. The first bar contributes nothing.",
  version: "1.0.0",
  tags: ["volume", "momentum"],
  inputs: [],
  plots: [
    linePlot("main", "OBV", { color: "#26a69a", linewidth: 2, pane: "sub" }),
  ],
  calculate: () => ({
    main: ta.obv().at(0),
  }),
});
