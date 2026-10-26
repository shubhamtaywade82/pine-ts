import { describe, expect, it } from "vitest";
import { indicator, PineRuntime, smc } from "../src/index.js";
import type { ScriptBox, ScriptLine } from "../src/index.js";
import {
  asRealtimeTicks,
  orderBlockReference,
  Provider,
  structureReference,
  walkBars,
} from "./smc-reference.js";

const SWING = 5;
const BODY = 0.3;

const smcScript = (showBOS = true) =>
  indicator("SMC drawings", { overlay: true }, ({ draw }) => {
    const structure = smc.structure({ swingLength: SWING });
    draw.structure(structure, { showBOS });
    draw.orderBlocks(smc.orderBlocks(structure, { minBodyPercent: BODY }));
  });

const bars = walkBars(600);
const structureRows = structureReference(bars, SWING);

/** Every break in the reference, as the line it should draw. */
const expectedLines = (showBOS: boolean): ScriptLine[] =>
  structureRows.flatMap((row, i) => {
    const lines: ScriptLine[] = [];
    const high = { fromBar: row.swingHighBar, toBar: i, price: row.swingHigh };
    const low = { fromBar: row.swingLowBar, toBar: i, price: row.swingLow };
    if (showBOS && row.bullishBOS) lines.push({ ...high, text: "BOS", direction: "bullish" });
    if (showBOS && row.bearishBOS) lines.push({ ...low, text: "BOS", direction: "bearish" });
    if (row.bullishCHoCH) lines.push({ ...high, text: "CHoCH", direction: "bullish" });
    if (row.bearishCHoCH) lines.push({ ...low, text: "CHoCH", direction: "bearish" });
    return lines;
  });

/** One box per zone, from its candle to the last bar it was valid on. */
const expectedBoxes = (): ScriptBox[] => {
  const boxes = new Map<string, ScriptBox>();
  orderBlockReference(bars, structureRows, { minBodyPercent: BODY }).forEach((row, i) => {
    const sides = [
      {
        valid: row.bullishValid,
        fromBar: row.bullishBar,
        top: row.bullishTop,
        bottom: row.bullishBottom,
        direction: "bullish" as const,
      },
      {
        valid: row.bearishValid,
        fromBar: row.bearishBar,
        top: row.bearishTop,
        bottom: row.bearishBottom,
        direction: "bearish" as const,
      },
    ];
    for (const { valid, ...zone } of sides) {
      if (!valid) continue;
      boxes.set(`${zone.direction}:${zone.fromBar}:${zone.top}:${zone.bottom}`, {
        ...zone,
        toBar: i,
      });
    }
  });
  return [...boxes.values()];
};

describe("concise draw helpers", () => {
  it("draws one line per BOS/CHoCH, from the swing's pivot bar to the breaking bar", async () => {
    const { drawings } = await smcScript().run(bars);
    expect(drawings.lines).toEqual(expectedLines(true));
    expect(drawings.lines.some((line) => line.text === "CHoCH")).toBe(true);
  });

  it("hides BOS lines when showBOS is false", async () => {
    const { drawings } = await smcScript(false).run(bars);
    expect(drawings.lines).toEqual(expectedLines(false));
    expect(drawings.lines.every((line) => line.text === "CHoCH")).toBe(true);
  });

  it("draws one box per order block, extended to its last valid bar", async () => {
    const { drawings } = await smcScript().run(bars);
    expect(drawings.boxes).toEqual(expectedBoxes());
    expect(drawings.boxes.length).toBeGreaterThan(1);
  });

  it("does not duplicate drawings when the open bar is recalculated by realtime ticks", async () => {
    const sample = bars.slice(0, 250);
    const historical = await smcScript().run(sample);
    const execution = smcScript().bind();
    await new PineRuntime({
      provider: new Provider(asRealtimeTicks(sample)),
      symbol: "TEST",
      timeframe: "1",
    }).runRealtime(execution.script);
    expect(execution.output().drawings).toEqual(historical.drawings);
    expect(historical.drawings.lines.length).toBeGreaterThan(0);
  });
});
