import { describe, expect, it } from "vitest";
import { PineRuntime, smc } from "../src/index.js";
import type { Bar, PineContext } from "../src/index.js";
import {
  asRealtimeTicks,
  orderBlockReference,
  Provider,
  structureReference,
  walkBars,
  type OrderBlockReferenceOptions,
  type OrderBlockRow,
} from "./smc-reference.js";

interface Options extends OrderBlockReferenceOptions {
  readonly swingLength: number;
}

const observe = (
  options: Options,
): { readonly script: (ctx: PineContext) => void; readonly rows: OrderBlockRow[] } => {
  const rows: OrderBlockRow[] = [];
  const { swingLength, ...blockOptions } = options;
  return {
    rows,
    script: (ctx) => {
      const blocks = smc.orderBlocks(smc.structure({ swingLength }), blockOptions);
      if (!ctx.barstate.isconfirmed) return;
      rows.push({
        bullishTop: blocks.bullish.top.value,
        bullishBottom: blocks.bullish.bottom.value,
        bullishBar: blocks.bullish.bar.value,
        bullishValid: blocks.bullish.valid.value === true,
        inBullish: blocks.bullish.touched.value === true,
        bearishTop: blocks.bearish.top.value,
        bearishBottom: blocks.bearish.bottom.value,
        bearishBar: blocks.bearish.bar.value,
        bearishValid: blocks.bearish.valid.value === true,
        inBearish: blocks.bearish.touched.value === true,
      });
    },
  };
};

const runHistorical = async (bars: readonly Bar[], options: Options): Promise<OrderBlockRow[]> => {
  const observed = observe(options);
  await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(
    observed.script,
    bars,
  );
  return observed.rows;
};

const reference = (bars: readonly Bar[], options: Options): OrderBlockRow[] =>
  orderBlockReference(bars, structureReference(bars, options.swingLength), options);

describe("smc.orderBlocks", () => {
  const bars = walkBars(600);

  it("matches a literal transcription of the Pine order-block block bar for bar", async () => {
    const options = { swingLength: 5, minBodyPercent: 0.3 };
    const expected = reference(bars, options);
    expect(await runHistorical(bars, options)).toEqual(expected);
    for (const key of ["inBullish", "inBearish"] as const) {
      expect(
        expected.some((row) => row[key]),
        key,
      ).toBe(true);
    }
    // Invalidation must actually occur for the comparison to cover it.
    expect(expected.some((row) => !Number.isNaN(row.bullishTop) && !row.bullishValid)).toBe(true);
  });

  it("honors expiry and the invalidation tolerance", async () => {
    const options = { swingLength: 4, minBodyPercent: 0.5, expiry: 12, tolerancePercent: 0 };
    const expected = reference(bars, options);
    expect(await runHistorical(bars, options)).toEqual(expected);
    expect(expected).not.toEqual(reference(bars, { swingLength: 4, minBodyPercent: 0.5 }));
  });

  it("takes the last opposite candle before a bullish break as the zone", async () => {
    // Swing high 105 (bar 2) confirms on bar 4. Bar 8 is bearish; bar 9
    // closes above 105 with a large body, so bar 8's range is the zone.
    const ohlc: ReadonlyArray<readonly [number, number, number, number]> = [
      [101, 102.5, 101, 102],
      [102, 103, 101, 102],
      [102, 105, 102, 103],
      [103, 103, 100, 101],
      [101, 101, 97, 98],
      [98, 98, 95, 96],
      [96, 98, 96, 97],
      [97, 103, 97, 102],
      [104, 104.5, 101.5, 102],
      [102, 108, 102, 107],
      [107, 107, 101, 103],
    ];
    const shaped = ohlc.map(([open, high, low, close], i): Bar => ({
      time: i + 1,
      open,
      high,
      low,
      close,
      volume: 1,
      isClosed: true,
    }));
    const options = { swingLength: 2, minBodyPercent: 0.3 };
    const rows = await runHistorical(shaped, options);
    expect(rows).toEqual(reference(shaped, options));
    expect(rows[9]).toMatchObject({ bullishTop: 104.5, bullishBottom: 101.5, bullishBar: 8 });
    expect(rows[10]?.inBullish).toBe(true);
  });

  it("commits the same history when the bars arrive as realtime ticks", async () => {
    const sample = bars.slice(0, 250);
    const options = { swingLength: 4, minBodyPercent: 0.3 };
    const historical = await runHistorical(sample, options);
    const realtime = observe(options);
    await new PineRuntime({
      provider: new Provider(asRealtimeTicks(sample)),
      symbol: "TEST",
      timeframe: "1",
    }).runRealtime(realtime.script);
    expect(realtime.rows).toEqual(historical);
  });

  it("rejects invalid options", async () => {
    const sample = bars.slice(0, 5);
    await expect(runHistorical(sample, { swingLength: 3, minBodyPercent: -1 })).rejects.toThrow(
      /minBodyPercent/,
    );
    await expect(
      runHistorical(sample, { swingLength: 3, minBodyPercent: 0.3, expiry: 1.5 }),
    ).rejects.toThrow(/expiry/);
    await expect(
      runHistorical(sample, { swingLength: 3, minBodyPercent: 0.3, tolerancePercent: -0.1 }),
    ).rejects.toThrow(/tolerancePercent/);
  });
});
