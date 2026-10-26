import { ta } from "../../index.js";
import { defineIndicator, linePlot, sourceInput } from "../define.js";
import { type Indicator } from "../types.js";
import { readString, resolveSource } from "../helpers.js";

export const vwap: Indicator = defineIndicator({
  id: "vwap",
  name: "Volume Weighted Average Price",
  category: "overlay",
  description: "Volume Weighted Average Price (VWAP) anchored to the daily session boundary.",
  version: "1.0.0",
  tags: ["volume", "overlay", "trend"],
  inputs: [sourceInput("source", "Source", "hlc3")],
  plots: [linePlot("main", "VWAP", { color: "#eab308", linewidth: 2, pane: "main" })],
  calculate: ({ ctx, inputs }) => {
    const source = resolveSource(ctx, readString(inputs, "source"));
    return { main: ta.vwap(source).at(0) };
  },
});
