import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const closesToBars = (closes: readonly number[]): readonly Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    isClosed: true,
  })) satisfies readonly Bar[];

const ohlcToBars = (rows: ReadonlyArray<readonly [number, number, number]>): readonly Bar[] =>
  rows.map(([high, low, close], index) => ({
    time: index + 1,
    open: close,
    high,
    low,
    close,
    volume: 1,
    isClosed: true,
  })) satisfies readonly Bar[];

const tick = (time: number, high: number, low: number, close: number, isClosed: boolean): Bar => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 1,
  isClosed,
});

class Provider implements MarketDataProvider {
  public constructor(
    private readonly history: readonly Bar[],
    private readonly stream: readonly Bar[] = [],
  ) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;

  public streamBars = (): AsyncIterable<Bar> => {
    let index = 0;
    const iterator: AsyncIterator<Bar> = {
      next: async () => {
        const value = this.stream[index];
        if (value === undefined) return { value: undefined, done: true };
        index += 1;
        return { value, done: false };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

type Context = Parameters<PineScript>[0];

const runHistorical = async <T>(
  bars: readonly Bar[],
  read: (context: Context) => T,
): Promise<T[]> => {
  const values: T[] = [];
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((context) => {
    values.push(read(context));
  }, bars);
  return values;
};

const runRealtime = async <T>(
  ticks: readonly Bar[],
  read: (context: Context) => T,
): Promise<T[]> => {
  const values: T[] = [];
  const runtime = new PineRuntime({
    provider: new Provider([], ticks),
    symbol: "TEST",
    timeframe: "1m",
    executionMode: "realtime",
  });
  await runtime.runRealtime((context) => {
    values.push(read(context));
  });
  return values;
};

describe("Milestone 1.2 — composite built-ins", () => {
  it("calculates MACD line, signal line and histogram", async () => {
    const macdLine: number[] = [];
    const signalLine: number[] = [];
    const histLine: number[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const result = ta.macd(ctx.close, 2, 4, 2);
      macdLine.push(result.macdLine.value);
      signalLine.push(result.signalLine.value);
      histLine.push(result.histLine.value);
    });

    // EMA seeds make every MACD output defined from the first bar.
    expect(macdLine[0]).toBe(0);
    expect(signalLine[0]).toBe(0);
    expect(histLine[0]).toBe(0);
    expect(macdLine[1]).toBeCloseTo(0.26666666666666666, 10);
    expect(macdLine[2]).toBeCloseTo(0.5155555555555553, 10);
    expect(macdLine[3]).toBeCloseTo(0.6945185185185183, 10);
    expect(macdLine[4]).toBeCloseTo(0.8117728395061725, 10);
    expect(signalLine[1]).toBeCloseTo(0.17777777777777773, 10);
    expect(signalLine[4]).toBeCloseTo(0.740293004115226, 10);
    expect(histLine[1]).toBeCloseTo(0.08888888888888888, 10);
    expect(histLine[4]).toBeCloseTo(0.07147983539094649, 10);
  });

  it("exposes MACD history offsets per output", async () => {
    const history: Array<number | undefined> = [];
    const values: number[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const { macdLine } = ta.macd(ctx.close, 2, 4, 2);
      // Materialize the current value first: lazy series only commit on reads.
      values.push(macdLine.value);
      history.push(macdLine.at(1));
    });

    expect(values).toEqual([
      0, 0.2666666666666666, 0.5155555555555553, 0.6945185185185183, 0.8117728395061725,
    ]);
    expect(history).toEqual([
      undefined,
      0,
      0.2666666666666666,
      0.5155555555555553,
      0.6945185185185183,
    ]);
  });

  it("preserves structural identity for repeated MACD nodes", async () => {
    const identities: unknown[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const first = ta.macd(ctx.close, 2, 4, 2);
      const second = ta.macd(ctx.close, 2, 4, 2);
      identities.push(first.macdLine, second.macdLine, first.signalLine, second.signalLine);
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).toBe(identities[3]);
  });

  it("calculates Bollinger Bands with a warm-up of length - 1", async () => {
    const middle: number[] = [];
    const upper: number[] = [];
    const lower: number[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const bands = ta.bb(ctx.close, 3, 2);
      middle.push(bands.middle.value);
      upper.push(bands.upper.value);
      lower.push(bands.lower.value);
    });

    expect(middle.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(upper.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(lower.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(middle.slice(2)).toEqual([2, 3, 4]);
    expect(upper[2]).toBeCloseTo(3.632993161855452, 10);
    expect(upper[4]).toBeCloseTo(5.6329931618554525, 10);
    expect(lower[2]).toBeCloseTo(0.36700683814454793, 10);
    expect(lower[4]).toBeCloseTo(2.367006838144548, 10);
  });

  it("keeps distinct multipliers on separate bb nodes", async () => {
    const identities: unknown[] = [];
    const tightValues: number[] = [];
    const wideValues: number[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4, 5]), (ctx) => {
      const tight = ta.bb(ctx.close, 3, 2);
      const tightAgain = ta.bb(ctx.close, 3, 2);
      const wide = ta.bb(ctx.close, 3, 2.5);
      identities.push(tight.upper, tightAgain.upper, wide.upper);
      tightValues.push(tight.upper.value);
      wideValues.push(wide.upper.value);
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[0]).not.toBe(identities[2]);
    const tight = tightValues[4] ?? Number.NaN;
    const wide = wideValues[4] ?? Number.NaN;
    expect(wide).toBeGreaterThan(tight);
    expect(tight).toBeCloseTo(5.6329931618554525, 10);
    expect(wide).toBeCloseTo(4 + 2.5 * Math.sqrt(2 / 3), 10);
  });

  it("calculates directional movement with Wilder smoothing", async () => {
    const bars = ohlcToBars([
      [12, 8, 10],
      [13, 9, 11],
      [15, 10, 14],
      [14, 7, 8],
      [16, 9, 15],
      [17, 10, 16],
    ]);
    const plusDI: number[] = [];
    const minusDI: number[] = [];
    const adx: number[] = [];
    await runHistorical(bars, (_ctx) => {
      const result = ta.dmi(2, 2);
      plusDI.push(result.plusDI.value);
      minusDI.push(result.minusDI.value);
      adx.push(result.adx.value);
    });

    // +DI/-DI need di_length smoothed changes; ADX needs adx_smoothing more.
    expect(plusDI.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(minusDI.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(adx.slice(0, 3).every(Number.isNaN)).toBe(true);

    expect(plusDI[2]).toBeCloseTo(33.333333333333336, 10);
    expect(minusDI[2]).toBeCloseTo(0, 10);
    expect(plusDI[3]).toBeCloseTo(13.043478260869565, 10);
    expect(minusDI[3]).toBeCloseTo(26.08695652173913, 10);
    expect(plusDI[4]).toBeCloseTo(20, 10);
    expect(minusDI[4]).toBeCloseTo(10.909090909090908, 10);
    expect(plusDI[5]).toBeCloseTo(17.117117117117118, 10);
    expect(minusDI[5]).toBeCloseTo(5.405405405405405, 10);

    expect(adx[3]).toBeCloseTo(66.66666666666666, 10);
    expect(adx[4]).toBeCloseTo(48.03921568627451, 10);
    expect(adx[5]).toBeCloseTo(50.01960784313726, 10);
  });

  it("returns na DMI values for zero-range bars", async () => {
    const plusDI: number[] = [];
    const adx: number[] = [];
    await runHistorical(closesToBars([5, 5, 5, 5]), (_ctx) => {
      const result = ta.dmi(2, 2);
      plusDI.push(result.plusDI.value);
      adx.push(result.adx.value);
    });

    // A flat series has zero true range, so Pine division yields na.
    expect(plusDI.every(Number.isNaN)).toBe(true);
    expect(adx.every(Number.isNaN)).toBe(true);
  });

  it("preserves structural identity for repeated DMI nodes", async () => {
    const identities: unknown[] = [];
    await runHistorical(closesToBars([1, 2, 3, 4]), (_ctx) => {
      const first = ta.dmi(2, 2);
      const second = ta.dmi(2, 2);
      identities.push(first.plusDI, second.plusDI, first.adx, second.adx);
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).toBe(identities[3]);
  });

  it("tracks supertrend direction flips and band carry-forward", async () => {
    const bars = ohlcToBars([
      [12, 8, 10],
      [13, 9, 12],
      [14, 10, 13],
      [15, 11, 14],
      [16, 12, 15],
      [17, 13, 16],
      [18, 14, 17],
    ]);
    const supertrend: number[] = [];
    const direction: Array<number | undefined> = [];
    await runHistorical(bars, (_ctx) => {
      const result = ta.supertrend(1, 2);
      supertrend.push(result.supertrend.value);
      direction.push(result.direction.value);
    });

    // Warm-up: the line stays na until ATR confirms; direction is 1 from the
    // first bar per the v6 reference algorithm.
    expect(Number.isNaN(supertrend[0])).toBe(true);
    expect(direction[0]).toBe(1);

    // Downtrend band carries at 15 until close breaks above it.
    expect(supertrend.slice(1, 5)).toEqual([15, 15, 15, 15]);
    expect(direction.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);

    // Breakout flips to the rising lower band.
    expect(direction[5]).toBe(-1);
    expect(supertrend[5]).toBe(11);
    expect(direction[6]).toBe(-1);
    expect(supertrend[6]).toBe(12);
  });

  it("resets the trailing band when price breaks through it", async () => {
    const bars = ohlcToBars([
      [12, 8, 10],
      [13, 9, 12],
      [14, 10, 13],
      [17, 13, 16],
      [12, 6, 7],
      [11, 5, 6],
    ]);
    const supertrend: number[] = [];
    const direction: Array<number | undefined> = [];
    await runHistorical(bars, (_ctx) => {
      const result = ta.supertrend(1, 2);
      supertrend.push(result.supertrend.value);
      direction.push(result.direction.value);
    });

    // Breakout to the lower band, then a crash that reclaims the upper band
    // and finally tightens it as volatility expands.
    expect(direction).toEqual([1, 1, 1, -1, 1, 1]);
    expect(supertrend.slice(1)).toEqual([15, 15, 11, 16, 14.5]);
  });

  it("keeps supertrend state frozen across intrabar ticks", async () => {
    const confirmed = ohlcToBars([
      [12, 8, 10],
      [13, 9, 12],
      [14, 10, 13],
      [15, 11, 14],
      [16, 12, 15],
      [17, 13, 16],
    ]);
    const ticks = [
      ...confirmed.map((bar) => ({ ...bar })),
      tick(7, 18.5, 13.5, 17, false),
      tick(7, 18.5, 9, 10, false),
      tick(7, 18.5, 13.5, 17, true),
    ];
    const observed: Array<[number | undefined, number]> = [];
    await runRealtime(ticks, (_ctx) => {
      const result = ta.supertrend(1, 2);
      observed.push([result.direction.value, result.supertrend.value]);
    });

    // Committed history matches the historical semantics bar by bar.
    expect(observed.slice(0, 6)).toEqual([
      [1, Number.NaN],
      [1, 15],
      [1, 15],
      [1, 15],
      [1, 15],
      [-1, 11],
    ]);

    // Intrabar: the working close breaks the committed lower band and flips
    // direction, but the band state itself is not committed by the tick.
    expect(observed[6]).toEqual([-1, 11.5]);
    expect(observed[7]).toEqual([1, 20.5]);

    // The closing tick restores the uptrend and commits exactly the values a
    // historical run over the same closed bars produces.
    expect(observed[8]).toEqual([-1, 11.5]);
    const historical = await runHistorical(
      [...confirmed, tick(7, 18.5, 13.5, 17, true)],
      (_ctx) => {
        const result = ta.supertrend(1, 2);
        return [result.direction.value, result.supertrend.value] as const;
      },
    );
    expect(observed[8]).toEqual(historical.at(-1));
  });

  it("rolls MACD back across intrabar ticks", async () => {
    const ticks = [
      ...closesToBars([1, 2, 3, 4, 5]).map((bar) => ({ ...bar })),
      { ...closesToBars([10])[0]!, time: 6, isClosed: false },
      { ...closesToBars([4])[0]!, time: 6, isClosed: false },
      { ...closesToBars([5])[0]!, time: 6, isClosed: true },
    ];
    const histLine: number[] = [];
    await runRealtime(ticks, (ctx) => {
      histLine.push(ta.macd(ctx.close, 2, 4, 2).histLine.value);
    });

    expect(histLine.slice(0, 5)).toEqual([
      0, 0.08888888888888888, 0.11259259259259258, 0.09718518518518526, 0.07147983539094649,
    ]);

    // Intrabar ticks re-evaluate against the working close without advancing
    // the EMA state, so the two ticks observe different live values.
    expect(histLine[5]).not.toBe(histLine[6]);
    expect(Number.isFinite(histLine[5])).toBe(true);

    // The committed close matches a pure historical run over the same bars.
    const historical = await runHistorical(
      closesToBars([1, 2, 3, 4, 5, 5]),
      (ctx) => ta.macd(ctx.close, 2, 4, 2).histLine.value,
    );
    expect(histLine[7]).toBeCloseTo(historical.at(-1) ?? Number.NaN, 12);
  });

  it("isolates composite state across independent runtimes", async () => {
    const bars = ohlcToBars([
      [12, 8, 10],
      [13, 9, 12],
      [14, 10, 13],
      [15, 11, 14],
      [16, 12, 15],
      [17, 13, 16],
    ]);
    const read = (_ctx: Context): number => ta.supertrend(1, 2).supertrend.value;
    const first = await runHistorical(bars, read);
    const second = await runHistorical(bars, read);

    expect(first).toEqual(second);
  });

  it("rejects invalid composite parameters", async () => {
    await runHistorical(closesToBars([1, 2, 3, 4]), (ctx) => {
      expect(() => ta.macd(ctx.close, 0, 26, 9)).toThrow(RangeError);
      expect(() => ta.macd(ctx.close, 12, 26, 0)).toThrow(RangeError);
      expect(() => ta.bb(ctx.close, 3, Number.NaN)).toThrow(RangeError);
      expect(() => ta.bb(ctx.close, 0, 2)).toThrow(RangeError);
      expect(() => ta.dmi(0, 14)).toThrow(RangeError);
      expect(() => ta.supertrend(Number.POSITIVE_INFINITY, 10)).toThrow(RangeError);
      expect(() => ta.supertrend(3, 0)).toThrow(RangeError);
    });
  });
});
