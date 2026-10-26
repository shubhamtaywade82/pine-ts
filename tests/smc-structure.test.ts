import { describe, expect, it } from "vitest";
import { defineStrategy, PineRuntime, smc } from "../src/index.js";
import type { Bar, PineContext } from "../src/index.js";
import {
  asRealtimeTicks,
  Provider,
  structureReference as pineReference,
  walkBars,
  type StructureRow as Row,
} from "./smc-reference.js";

const observe = (
  options: Parameters<typeof smc.structure>[0],
): { readonly script: (ctx: PineContext) => void; readonly rows: Row[] } => {
  const rows: Row[] = [];
  return {
    rows,
    script: (ctx) => {
      const result = smc.structure(options);
      if (!ctx.barstate.isconfirmed) return;
      rows.push({
        swingHigh: result.swingHigh.value,
        swingHighBar: result.swingHighBar.value ?? Number.NaN,
        swingLow: result.swingLow.value,
        swingLowBar: result.swingLowBar.value ?? Number.NaN,
        bias: result.bias.value ?? Number.NaN,
        bullishBOS: result.bullishBOS.value === true,
        bearishBOS: result.bearishBOS.value === true,
        bullishCHoCH: result.bullishCHoCH.value === true,
        bearishCHoCH: result.bearishCHoCH.value === true,
      });
    },
  };
};

const runHistorical = async (
  bars: readonly Bar[],
  options: Parameters<typeof smc.structure>[0],
): Promise<Row[]> => {
  const observed = observe(options);
  await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(
    observed.script,
    bars,
  );
  return observed.rows;
};

const countEvents = (rows: readonly Row[], key: keyof Row): number =>
  rows.filter((row) => row[key] === true).length;

describe("smc.structure", () => {
  const bars = walkBars(600);

  it("matches a literal transcription of the Pine structure block bar for bar", async () => {
    const rows = await runHistorical(bars, { swingLength: 5 });
    const reference = pineReference(bars, 5);
    expect(rows).toEqual(reference);
    for (const key of ["bullishBOS", "bearishBOS", "bullishCHoCH", "bearishCHoCH"] as const) {
      expect(countEvents(reference, key), key).toBeGreaterThan(0);
    }
  });

  it("stops breaking a swing once it is older than swingExpiry bars", async () => {
    const rows = await runHistorical(bars, { swingLength: 3, swingExpiry: 8 });
    const reference = pineReference(bars, 3, 8);
    expect(rows).toEqual(reference);
    expect(reference).not.toEqual(pineReference(bars, 3));
  });

  it("reports BOS for a continuation break and CHoCH for a break against the bias", async () => {
    // With length 2 the swing high 105 (bar 2) confirms on bar 4 and the
    // swing low 99 (bar 11) on bar 13. Bar 9 closes above 105 (first break:
    // BOS); bar 14 closes below 99 against the bullish bias (CHoCH).
    const closes = [102, 102, 103, 101, 98, 96, 97, 101, 104, 107, 103, 101, 100, 101, 98];
    const highs = [102.5, 103, 105, 102, 99, 97, 98, 102, 105, 108, 104, 102, 101, 102, 99];
    const lows = [101.5, 101, 102, 100, 97, 95, 96, 100, 103, 104, 102, 99, 99.5, 100, 97];
    const shaped = closes.map((close, i): Bar => ({
      time: i + 1,
      open: close,
      high: highs[i] as number,
      low: lows[i] as number,
      close,
      volume: 1,
      isClosed: true,
    }));
    const rows = await runHistorical(shaped, { swingLength: 2 });
    expect(rows).toEqual(pineReference(shaped, 2));
    expect(rows.map((row, i) => (row.bullishBOS ? i : -1)).filter((i) => i >= 0)).toEqual([9]);
    expect(rows.map((row, i) => (row.bearishCHoCH ? i : -1)).filter((i) => i >= 0)).toEqual([14]);
    expect(rows[9]?.swingHighBar).toBe(2);
    expect(rows[14]?.swingLowBar).toBe(11);
    expect(rows[14]?.bias).toBe(-1);
  });

  it("commits the same history when the bars arrive as realtime ticks", async () => {
    const sample = bars.slice(0, 200);
    const ticks = asRealtimeTicks(sample);
    const historical = await runHistorical(sample, { swingLength: 4 });
    const realtime = observe({ swingLength: 4 });
    await new PineRuntime({
      provider: new Provider(ticks),
      symbol: "TEST",
      timeframe: "1",
    }).runRealtime(realtime.script);
    expect(realtime.rows).toEqual(historical);
  });

  it("drives concise strategy orders through when conditions", async () => {
    const script = defineStrategy("Structure", { default_qty_value: 1 }, ({ strategy }) => {
      const s = smc.structure({ swingLength: 5 });
      strategy.entry("Long", "long", { when: s.bullishCHoCH });
      strategy.close("Long", { when: s.bearishCHoCH });
    });
    const { trades } = await script.backtest(bars);
    const reference = pineReference(bars, 5);
    // Orders fill on the bar after the signal.
    const firstEntry = reference.findIndex((row) => row.bullishCHoCH) + 1;
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]?.entryTime).toBe(bars[firstEntry]?.time);
  });

  it("rejects invalid options", async () => {
    await expect(runHistorical(bars.slice(0, 5), { swingLength: 0 })).rejects.toThrow(
      /swingLength/,
    );
    await expect(
      runHistorical(bars.slice(0, 5), { swingLength: 3, swingExpiry: -1 }),
    ).rejects.toThrow(/swingExpiry/);
  });
});
