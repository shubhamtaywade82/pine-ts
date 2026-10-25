/**
 * PineScript-exported reference vectors for the `ta.wma` partial-sum kernel.
 *
 * The expected values in this file are ACTUAL TradingView Pine Script v6
 * outputs at full precision, transcribed from the MIT-licensed OakScriptJS
 * test suite (github.com/deepentropy/oakscriptJS,
 * tests/ta/wma.test.ts, (c) Odyssée, MIT). They cover the cases that
 * distinguish Pine's `wmaAdd` cancellation rule from a plain weighted sum:
 * cancellation residues that round to 0, the `1e-10` threshold for tiny
 * values, and bit-for-bit agreement on a 21-bar window with internal
 * cancellation.
 *
 * Attribution: OakScriptJS authors exported these values from TradingView
 * charts (Data Window) for the same inputs; pine-ts reuses the vectors
 * under the MIT license's permission.
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
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

const runSeries = async (
  closes: readonly number[],
  evaluate: (ctx: PineContext) => number | undefined,
): Promise<Array<number | undefined>> => {
  const bars = closesToBars(closes);
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

describe("PineScript ta.wma partial sums (#136)", () => {
  it("a cancellation residue in the oldest-first sum is 0 (1.55 - 1.55 on the 4th value)", async () => {
    const window = [
      0.36699729486023464, 0.44995491433723744, 0.09467989179440549, -0.38773669972948793, -0.355275022542832,
      -3.2110009017132635, -3.019837691614077, 0.2863663425282791, 0.24568366739432423, 0.19626910101210535,
      0.1543957134352049, -0.22603691208573165, 0.02520341337566942, 0.0930740226235364, 0.36753883892068684,
      0.4569364949577542, 0.4418097574270917, 0.8167151547209731, 0.8394604601957156, 0.7892092039143084,
      0.41507798960138753,
    ];
    const values = await runSeries(window, (ctx) => ta.wma(ctx.close, 21).at(0));
    // Plain weighted sum / weightSum = 0.17483288638087413; Pine's wmaAdd
    // rule zeroes the cancellation residue → 0.17483288638087427.
    // eslint-disable-next-line sonarjs/no-floating-point-equality
    expect(values[20]).toBe(0.17483288638087427);
  });

  it("the sum is 0 when |s + t| <= 1e-10 * max(1, |s| + |t|)", async () => {
    // 1 + 2 * x: 1.9979995435903675e-10 is below 1e-10 * 1.9999999998 (0),
    // 2.000000165480742e-10 is above.
    const a = await runSeries([1, -0.4999999999001], (ctx) => ta.wma(ctx.close, 2).at(0));
    expect(a).toEqual(toNa([null, 0]));
    const b = await runSeries([1, -0.4999999999], (ctx) => ta.wma(ctx.close, 2).at(0));
    // eslint-disable-next-line sonarjs/no-floating-point-equality
    expect(b[1]).toBe(6.66666721826914e-11);
  });

  it("values below 1e-10 are 0 in the sum", async () => {
    const tiny = [5e-11, 2e-10, 1.2e-10, 5e-11];
    const w1 = await runSeries(tiny, (ctx) => ta.wma(ctx.close, 1).at(0));
    expect(w1).toEqual([0, 2e-10, 1.2e-10, 0]);
    const w2 = await runSeries(tiny, (ctx) => ta.wma(ctx.close, 2).at(0));
    expect(w2).toEqual(toNa([
      null, 1.3333333333333334e-10, 1.4666666666666668e-10, 7.333333333333334e-11,
    ]));
  });
});
