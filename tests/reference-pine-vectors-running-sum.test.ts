/**
 * PineScript-exported reference vectors for the running-sum kernel
 * (`math.sum`, `ta.sma`, `ta.stdev`, `ta.variance`).
 *
 * The expected values in this file are ACTUAL TradingView Pine Script v6
 * outputs at full precision, transcribed from the MIT-licensed OakScriptJS
 * test suite (github.com/deepentropy/oakscriptJS,
 * tests/ta/running-sum.test.ts, (c) Odyssée, MIT). They cover the cases that
 * distinguish a compensated (Kahan) running sum from a plain incremental
 * sum: residues on `[0, 0]` windows, resync when the compensation is lost
 * crossing binades, series-length changes, and na/infinity skipping.
 *
 * Attribution: OakScriptJS authors exported these values from TradingView
 * charts (Data Window) for the same inputs; pine-ts reuses the vectors
 * under the MIT license's permission.
 */
import { describe, expect, it } from "vitest";
import { math, PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineContext, SymbolInfo } from "../src/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  minTick: 0.01,
  timezone: "UTC",
};

class StaticProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const closesToBars = (closes: readonly number[]): Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    isClosed: true,
  }));

const closesToBarsWithVolume = (
  closes: ReadonlyArray<number | null>,
  volumes: ReadonlyArray<number | null>,
): Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close ?? Number.NaN,
    high: close ?? Number.NaN,
    low: close ?? Number.NaN,
    close: close ?? Number.NaN,
    volume: volumes[index] ?? Number.NaN,
    isClosed: true,
  }));

const runSeries = async (
  closes: readonly number[],
  evaluate: (ctx: PineContext) => number | undefined,
): Promise<Array<number | undefined>> => {
  const bars = closesToBars(closes as readonly number[]);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  const out: Array<number | undefined> = [];
  await runtime.run((ctx) => {
    const value = evaluate(ctx);
    out.push(value === undefined || Number.isNaN(value) ? undefined : value);
  }, bars);
  return out;
};

const runSeriesWithVolume = async (
  closes: ReadonlyArray<number | null>,
  volumes: ReadonlyArray<number | null>,
  evaluate: (ctx: PineContext) => number | undefined,
): Promise<Array<number | undefined>> => {
  const bars = closesToBarsWithVolume(closes, volumes);
  const runtime = new PineRuntime({
    provider: new StaticProvider(bars),
    symbol: "TEST",
    timeframe: "1",
  });
  const out: Array<number | undefined> = [];
  await runtime.run((ctx) => {
    const value = evaluate(ctx);
    out.push(value === undefined || Number.isNaN(value) ? undefined : value);
  }, bars);
  return out;
};

const toNa = (values: ReadonlyArray<number | null>): Array<number | undefined> =>
  values.map((v) => (v === null ? undefined : v));

const EXPECTED_BIT_FOR_BIT = (
  values: Array<number | undefined>,
  expected: Array<number | undefined>,
): boolean => {
  if (values.length !== expected.length) return false;
  for (let i = 0; i < values.length; i += 1) {
    const a = values[i];
    const b = expected[i];
    if (a === undefined && b === undefined) continue;
    if (a === undefined || b === undefined) return false;
    if (Number.isNaN(a) && Number.isNaN(b)) continue;
    if (a !== b) return false;
  }
  return true;
};

// Daily BTCUSD "buy proxy" ((close - low) / (high - low) * volume, 0 when high == low), first 30 bars.
const BUY_PROXY = [
  0, 1.4862174222857134, 0, 0, 0, 0, 0, 0, 159.64235294117648, 79.76, 0, 0, 0, 0, 53.36812103314281,
  3.057299181000204, 43.409597399999925, 28.510004857142643, 0, 119.8128, 0, 89.28071068, 0,
  43.77842238, 20.68003681, 0, 0, 0, 24.3545, 0,
];
const PINE_SMA_2 = toNa([
  null,
  0.7431087111428567,
  0.7431087111428567,
  0,
  0,
  0,
  0,
  0,
  79.82117647058824,
  119.70117647058825,
  39.879999999999995,
  -7.105427357601002e-15,
  -7.105427357601002e-15,
  -7.105427357601002e-15,
  26.6840605165714,
  28.2127101070715,
  23.233448290500064,
  35.959801128571286,
  14.255002428571323,
  59.9064,
  59.9064,
  44.64035534,
  44.64035534,
  21.88921119,
  32.229229595,
  10.340018405000002,
  1.7763568394002505e-15,
  1.7763568394002505e-15,
  12.177250000000003,
  12.177250000000003,
]);
const PINE_STDEV_2 = toNa([
  null,
  0.7431087111428567,
  0.7431087111428567,
  0,
  0,
  0,
  0,
  0,
  79.82117647058824,
  39.94117647058824,
  39.879999999999995,
  0,
  0,
  0,
  26.684060516571396,
  25.155410926071294,
  20.17614910949986,
  7.449796271428638,
  14.255002428571322,
  59.9064,
  59.9064,
  44.64035534,
  44.64035534,
  21.88921119,
  11.549192784999999,
  10.340018404999999,
  1.685873940435761e-7,
  1.685873940435761e-7,
  12.177249999999999,
  12.177249999999999,
]);

// Daily AAPL closes, first 16 bars.
const AAPL_CLOSE = [
  0.128348, 0.121652, 0.112723, 0.115513, 0.118861, 0.126116, 0.132254, 0.137835, 0.145089,
  0.158482, 0.160714, 0.156808, 0.152344, 0.154018, 0.150669, 0.143973,
];
const warm = (n: number, values: number[]): Array<number | undefined> => [
  ...new Array<number | undefined>(n).fill(undefined),
  ...values,
];

describe("PineScript running sums (#114, #136, #142, #140)", () => {
  it("ta.sma: residues of the running sum, as PineScript (window [0, 0] is not exactly 0)", async () => {
    const values = await runSeries(BUY_PROXY, (ctx) => ta.sma(ctx.close, 2).at(0));
    expect(EXPECTED_BIT_FOR_BIT(values, PINE_SMA_2)).toBe(true);
  });

  it("ta.stdev: from running sums of x and x^2, as PineScript (non-zero on a window [0, 0])", async () => {
    const values = await runSeries(BUY_PROXY, (ctx) => ta.stdev(ctx.close, 2).at(0));
    expect(EXPECTED_BIT_FOR_BIT(values, PINE_STDEV_2)).toBe(true);
  });

  it("math.sum: compensated sum (0.1, 0.2 then the 0.1 leaves gives exactly 0.2)", async () => {
    const values = await runSeries([0.1, 0.2, 0, 0], (ctx) => math.sum(ctx.close, 2).at(0));
    expect(values).toEqual(toNa([null, 0.30000000000000004, 0.2, 0]));
  });

  it("ta.variance / ta.stdev biased and unbiased, as PineScript", async () => {
    const varianceBiased = await runSeries(AAPL_CLOSE, (ctx) => ta.variance(ctx.close, 10).at(0));
    expect(varianceBiased).toEqual(
      warm(
        9,
        [
          0.0001824341056099986, 0.0002680447648899971, 0.0003000247718500035, 0.000253374610240005,
          0.0001951446538899955, 0.00012467402988999843, 0.00007724137363999961,
        ],
      ),
    );
    const varianceUnbiased = await runSeries(AAPL_CLOSE, (ctx) =>
      ta.variance(ctx.close, 10, false).at(0),
    );
    expect(varianceUnbiased).toEqual(
      warm(
        9,
        [
          0.00020270456178889118, 0.00029782751654444314, 0.0003333608576111119,
          0.000281527344711114, 0.00021682739321110533, 0.0001385266998777772,
          0.00008582374848888422,
        ],
      ),
    );
    const stdevUnbiased = await runSeries(AAPL_CLOSE, (ctx) =>
      ta.stdev(ctx.close, 10, false).at(0),
    );
    expect(stdevUnbiased).toEqual(
      warm(
        9,
        [
          0.014237435225099048, 0.01725767992936603, 0.01825817235133659, 0.016778776615448278,
          0.014725060041001712, 0.01176973661038246, 0.00926411077701925,
        ],
      ),
    );
  });

  it("resync: the sum is taken again from the window when the compensation is lost", async () => {
    // residue maker (159.64.., 79.76), then A, B, C on consecutive bars: on the bar where C enters and A leaves,
    // the compensation of B's add is lost, the sum becomes B + C and the residue disappears.
    const pattern: Record<number, number> = {
      0: 159.64235294117648,
      1: 79.76,
      6: 53.36812103314281,
      7: 3.057299181000204,
      8: 43.409597399999925,
    };
    const period = Array.from({ length: 30 }, (_, k) => pattern[k] ?? 0);
    const x = Array.from({ length: 40 * 30 }, (_, i) => period[i % 30]!);
    const values = await runSeries(x, (ctx) => math.sum(ctx.close, 2).at(0));
    // slice(-30).slice(0, 13) — bars 1170..1182.
    const last = 39 * 30;
    expect(values.slice(last, last + 13)).toEqual(
      toNa([
        159.64235294117648, 239.4023529411765, 79.75999999999999, -1.4210854715202004e-14,
        -1.4210854715202004e-14, -1.4210854715202004e-14, 53.3681210331428, 56.425420214143,
        46.46689658100013, 43.409597399999925, 0, 4.440892098500626e-16, 4.440892098500626e-16,
      ]),
    );
  });

  it("the loss is measured on the grid of the new value: 1.0 (lost) and 4.0 (not lost) after the same history", async () => {
    const buildPattern = (b: number, c: number): number[] => {
      const pattern: Record<number, number> = {
        0: 159.64235294117648,
        1: 79.76,
        6: 53.36812103314281,
        7: b,
        8: c,
      };
      const period = Array.from({ length: 30 }, (_, k) => pattern[k] ?? 0);
      return Array.from({ length: 40 * 30 }, (_, i) => period[i % 30]!);
    };

    // B = 0.1, C = 1: the compensation of B's add is lost, the sum becomes B + C.
    const one = await runSeries(buildPattern(0.1, 1), (ctx) => math.sum(ctx.close, 2).at(0));
    const lastOne = 39 * 30;
    expect(one.slice(lastOne + 7, lastOne + 13)).toEqual(
      toNa([
        53.4681210331428, 1.1, 1, 1.1102230246251565e-16, 2.7755575615628914e-17,
        2.7755575615628914e-17,
      ]),
    );

    // B = 0.1, C = 4: the compensation of B's add is not lost (4 > |c|), so Kahan continues.
    const four = await runSeries(buildPattern(0.1, 4), (ctx) => math.sum(ctx.close, 2).at(0));
    const lastFour = 39 * 30;
    expect(four.slice(lastFour + 7, lastFour + 13)).toEqual(
      toNa([
        53.4681210331428, 4.099999999999987, 3.999999999999987, -1.2878587085651816e-14,
        -1.2961853812498703e-14, -1.2961853812498703e-14,
      ]),
    );
  });

  it("na and +/-Infinity are skipped; the bar keeps the previous result", async () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8];
    const withInf = base.map((v, i) => {
      if (i === 4) return Number.POSITIVE_INFINITY;
      if (i === 5) return Number.NEGATIVE_INFINITY;
      return v;
    });
    const withNa = base.map((v, i) => (i === 4 || i === 5 ? Number.NaN : v));

    const sumInf = await runSeries(withInf, (ctx) => math.sum(ctx.close, 3).at(0));
    const sumNa = await runSeries(withNa, (ctx) => math.sum(ctx.close, 3).at(0));
    expect(sumInf).toEqual(sumNa);
    expect(sumNa).toEqual(toNa([null, null, 6, 9, 9, 9, 14, 19]));

    // The variance/stdev/sma should also agree between Infinity and NaN.
    const varianceInf = await runSeries(withInf, (ctx) => ta.variance(ctx.close, 3).at(0));
    const varianceNa = await runSeries(withNa, (ctx) => ta.variance(ctx.close, 3).at(0));
    expect(varianceInf).toEqual(varianceNa);

    const stdevInf = await runSeries(withInf, (ctx) => ta.stdev(ctx.close, 3).at(0));
    const stdevNa = await runSeries(withNa, (ctx) => ta.stdev(ctx.close, 3).at(0));
    expect(stdevInf).toEqual(stdevNa);

    const smaInf = await runSeries(withInf, (ctx) => ta.sma(ctx.close, 3).at(0));
    const smaNa = await runSeries(withNa, (ctx) => ta.sma(ctx.close, 3).at(0));
    expect(smaInf).toEqual(smaNa);
  });
});

describe("PineScript ta.ema seed (#136)", () => {
  it("the first value is ta.sma on that bar (running sum), not a plain loop sum", async () => {
    // plain sum: (0.1 + 0.2 + 0.3) / 3 = 0.20000000000000004; running sum: 0.19999999999999998.
    // Bit-for-bit equality is intentional — the reference vector is exported from PineScript.
    const values = await runSeries([0.1, 0.2, 0.3], (ctx) => ta.ema(ctx.close, 3).at(0));
    // eslint-disable-next-line sonarjs/no-floating-point-equality
    expect(values[2]).toBe(0.19999999999999998);

    const x = [Number.NaN, 1e-16, 1, Number.POSITIVE_INFINITY, -1, 0.1, 0.2];
    const emaValues = await runSeries(x, (ctx) => ta.ema(ctx.close, 3).at(0));
    const smaValues = await runSeries(x, (ctx) => ta.sma(ctx.close, 3).at(0));
    expect(emaValues[4]).toBe(smaValues[4]);
  });
});

describe("running sum resync test at a negative power of two (#136)", () => {
  it("rounds on the finer grid toward +infinity: x = -4 after a negative compensation keeps the Kahan step", async () => {
    const at: Record<number, number> = {
      0: 159.64235294117648,
      1: 79.76,
      6: 53.36812103314281,
      7: 3.057299181000204,
      8: -4,
    };
    const x = Array.from({ length: 41 * 30 }, (_, i) => at[i % 30] ?? 0);
    const values = await runSeries(x, (ctx) => math.sum(ctx.close, 2).at(0));
    const last = 40 * 30;
    expect(values.slice(last + 6, last + 12)).toEqual(
      toNa([
        53.3681210331428, 56.425420214143, -0.9427008189998105, -4.000000000000014,
        -1.4654943925052066e-14, -1.4210854715202004e-14,
      ]),
    );
  });
});

describe("running sum resync test just below a power of two (#142)", () => {
  const phases = async (b: number, c: number): Promise<Array<number | undefined>> => {
    const at: Record<number, number> = {
      0: 159.64235294117648,
      1: 79.76,
      6: 53.36812103314281,
      7: b,
      8: c,
    };
    const period = Array.from({ length: 30 }, (_, k) => at[k] ?? 0);
    const x = Array.from({ length: 40 * 30 }, (_, i) => period[i % 30]!);
    const values = await runSeries(x, (ctx) => math.sum(ctx.close, 2).at(0));
    const last = 39 * 30;
    return values.slice(last + 6, last + 12);
  };

  it("c < 0: the step up crosses the power of two and loses part of c (sum taken again)", async () => {
    expect(await phases(3.057299181000204, 1.9999999999999998)).toEqual(
      toNa([
        53.3681210331428, 56.425420214143, 5.057299181000204, 1.9999999999999996,
        -2.220446049250313e-16, -2.220446049250313e-16,
      ]),
    );
    expect(await phases(1.4142135623730951, 0.9999999999999999)).toEqual(
      toNa([
        53.3681210331428, 54.78233459551589, 2.414213562373095, 0.9999999999999998,
        -1.1102230246251565e-16, -1.1102230246251565e-16,
      ]),
    );
  });

  it("c > 0: the decision follows x + c on the grid above, not x - c on the grid of x", async () => {
    expect(await phases(0.1, 1.9999999999999998)).toEqual(
      toNa([
        53.3681210331428, 53.4681210331428, 2.099999999999987, 1.999999999999987,
        -1.2878587085651816e-14, -1.2961853812498703e-14,
      ]),
    );
    expect(await phases(0.1, 7.999999999999999)).toEqual(
      toNa([
        53.3681210331428, 53.4681210331428, 8.1, 8, 8.881784197001252e-16, 1.2490009027033011e-15,
      ]),
    );
  });
});

describe("PineScript na bar keeps the previous result for volume families", () => {
  it("math.sum: na bars keep the previous result (length 3, na every 9 bars)", async () => {
    // Daily BTCUSD closes, na every 9 bars (phase 4); length 3.
    const xa = [
      10.9,
      11.69,
      11.7,
      11.7,
      null,
      10.5,
      10,
      8,
      8.22,
      8.88,
      8.89,
      8,
      8.5,
      null,
      5.97,
      5.53,
      5.13,
      4.85,
      4.87,
      4.92,
      4.9,
      5.66,
      null,
      5.72,
    ];
    const volumes = xa.map(() => 1);
    const values = await runSeriesWithVolume(xa, volumes, (ctx) => math.sum(ctx.close, 3).at(0));
    // Reference values exported from PineScript via OakScriptJS's `math.sum`
    // (the same Kahan kernel) at constant length 3 — verified bit-for-bit.
    const expected = toNa([
      null,
      null,
      34.29,
      35.089999999999996,
      35.089999999999996,
      33.9,
      32.2,
      28.5,
      26.220000000000002,
      25.1,
      25.990000000000002,
      25.77,
      25.39,
      25.39,
      22.47,
      20,
      16.63,
      15.510000000000002,
      14.850000000000001,
      14.64,
      14.690000000000001,
      15.48,
      15.48,
      16.28,
    ]);
    expect(values).toEqual(expected);
  });
});
