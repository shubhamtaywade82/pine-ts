import { describe, expect, it } from "vitest";
import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

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

// Bars and expected values mirror fixtures/v6/ta/sar.basic.json, which was
// generated from the official pine_sar algorithm and hand-verified.
const sarBasicBars = ohlcToBars([
  [11, 9, 10],
  [12, 9.5, 11],
  [13, 10, 12],
  [12.5, 9.5, 10],
  [11.5, 8.5, 9],
  [10.5, 7.5, 8],
  [9.5, 7, 7.5],
  [12, 8, 11.5],
]);

// Bars and expected values mirror fixtures/v6/ta/sar.cap.json: inc=0.1 and
// max=0.12 drive the acceleration factor to its cap on the first new extreme.
const sarCapBars = ohlcToBars([
  [11, 9, 10],
  [10.5, 8.5, 9.5],
  [10, 8, 9],
  [9.5, 7.5, 8],
  [11, 8.5, 10.5],
  [11.5, 9, 11],
  [12, 9.5, 11.5],
  [12.5, 10, 12],
]);

describe("Milestone 1.2 — trend built-ins", () => {
  it("tracks the Parabolic SAR through an uptrend and a bearish reversal", async () => {
    const values: number[] = [];
    await runHistorical(sarBasicBars, (_ctx) => {
      values.push(ta.sar(0.02, 0.02, 0.2).value);
    });

    // Bar 0 is na; bar 1 seeds an uptrend (close rose) with the SAR at the
    // previous low; the low[1]/low[2] clamps pin the first values to 9.
    expect(Number.isNaN(values[0])).toBe(true);
    expect(values[1]).toBe(9);
    expect(values[2]).toBe(9);
    expect(values[3]).toBeCloseTo(9.16, 10);
    // Bar 4 reverses to a downtrend: the SAR jumps to the old extreme 13.
    expect(values[4]).toBe(13);
    expect(values[5]).toBeCloseTo(12.91, 10);
    expect(values[6]).toBeCloseTo(12.6936, 10);
    expect(values[7]).toBeCloseTo(12.351984, 10);
  });

  it("caps the acceleration factor and reverses to an uptrend", async () => {
    const values: number[] = [];
    await runHistorical(sarCapBars, (_ctx) => {
      values.push(ta.sar(0.02, 0.1, 0.12).value);
    });

    // Bar 1 seeds a downtrend (close fell) with the SAR at the previous high,
    // and the high clamps hold it at 11 for two bars.
    expect(Number.isNaN(values[0])).toBe(true);
    expect(values[1]).toBe(11);
    expect(values[2]).toBe(11);
    expect(values[3]).toBeCloseTo(10.64, 10);
    // Bar 4 reverses to an uptrend: the SAR drops to the prior extreme 7.5.
    expect(values[4]).toBe(7.5);
    expect(values[5]).toBe(7.5);
    expect(values[6]).toBeCloseTo(7.98, 10);
    expect(values[7]).toBeCloseTo(8.4624, 10);
  });

  it("exposes SAR history offsets", async () => {
    const values: number[] = [];
    const history: Array<number | undefined> = [];
    await runHistorical(sarBasicBars, (_ctx) => {
      const sar = ta.sar(0.02, 0.02, 0.2);
      values.push(sar.value);
      history.push(sar.at(1));
    });

    expect(values[6]).toBeCloseTo(12.6936, 10);
    // Bar 0 committed na, so the first readable history value is bar 1's 9.
    expect(Number.isNaN(history[1])).toBe(true);
    expect(history[2]).toBe(9);
    expect(history[7]).toBeCloseTo(12.6936, 10);
  });

  it("preserves structural identity for repeated SAR nodes", async () => {
    const identities: unknown[] = [];
    await runHistorical(sarBasicBars, (_ctx) => {
      const first = ta.sar(0.02, 0.02, 0.2);
      const second = ta.sar(0.02, 0.02, 0.2);
      const tighter = ta.sar(0.02, 0.02, 0.15);
      identities.push(first, second, tighter);
    });

    expect(identities[0]).toBe(identities[1]);
    expect(identities[0]).not.toBe(identities[2]);
  });

  it("keeps SAR state frozen across intrabar ticks", async () => {
    const ticks = [
      ...sarBasicBars.slice(0, 7).map((bar) => ({ ...bar })),
      tick(8, 13, 8, 12, false),
      tick(8, 12, 8, 11.5, false),
      tick(8, 12, 8, 11.5, true),
    ];
    const observed: number[] = [];
    await runRealtime(ticks, (_ctx) => {
      observed.push(ta.sar(0.02, 0.02, 0.2).value);
    });

    // Committed history matches the historical run bar by bar.
    expect(Number.isNaN(observed[0])).toBe(true);
    expect(observed.slice(1, 7)).toEqual([9, 9, 9.16, 13, 12.91, 12.6936]);

    // Intrabar: a high above the SAR (12.351984) flips the trend and moves the
    // SAR to the reversal extreme, but the committed state does not advance.
    expect(observed[7]).toBe(7);
    // The next tick rolls back and re-evaluates against the committed state.
    expect(observed[8]).toBeCloseTo(12.351984, 10);
    // The closing tick commits exactly the value a historical run produces.
    expect(observed[9]).toBeCloseTo(12.351984, 10);
    const historical = await runHistorical(sarBasicBars, (_ctx) => ta.sar(0.02, 0.02, 0.2).value);
    expect(observed[9]).toBeCloseTo(historical.at(-1) ?? Number.NaN, 12);
  });

  it("isolates SAR state across independent runtimes", async () => {
    const read = (_ctx: Context): number => ta.sar(0.02, 0.02, 0.2).value;
    const first = await runHistorical(sarBasicBars, read);
    const second = await runHistorical(sarBasicBars, read);

    expect(first).toEqual(second);
  });

  it("rejects invalid SAR parameters", async () => {
    await runHistorical(sarBasicBars, (_ctx) => {
      expect(() => ta.sar(Number.NaN, 0.02, 0.2)).toThrow(RangeError);
      expect(() => ta.sar(0.02, Number.POSITIVE_INFINITY, 0.2)).toThrow(RangeError);
      expect(() => ta.sar(0.02, 0.02, Number.NaN)).toThrow(RangeError);
    });
  });

  it("calculates the linear regression curve at the current bar", async () => {
    const values: number[] = [];
    await runHistorical(closesToBars([1, 2, 4, 8, 16]), (ctx) => {
      values.push(ta.linreg(ctx.close, 3, 0).value);
    });

    // Mirrors fixtures/v6/ta/linreg.basic.json: least-squares fit with
    // offset 0 returning the line value at the current bar.
    expect(values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(values[2]).toBeCloseTo(3.8333333333333335, 10);
    expect(values[3]).toBeCloseTo(7.666666666666667, 10);
    expect(values[4]).toBeCloseTo(15.333333333333334, 10);
  });

  it("returns the window-start value for offset length - 1", async () => {
    const values: number[] = [];
    await runHistorical(closesToBars([1, 3, 5, 7, 9]), (ctx) => {
      values.push(ta.linreg(ctx.close, 4, 3).value);
    });

    // Mirrors fixtures/v6/ta/linreg.start.json: a perfectly linear source
    // pins the exact intercepts.
    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(values.slice(3)).toEqual([1, 3]);
  });

  it("extrapolates beyond the window for other offsets", async () => {
    const center: number[] = [];
    const beforeWindow: number[] = [];
    const afterCurrent: number[] = [];
    await runHistorical(closesToBars([1, 2, 4, 8, 16]), (ctx) => {
      center.push(ta.linreg(ctx.close, 3, 1).value);
      beforeWindow.push(ta.linreg(ctx.close, 3, 3).value);
      afterCurrent.push(ta.linreg(ctx.close, 3, -1).value);
    });

    // Window at bar 2 fits y = 5/6 + 1.5x: offset 1 is the middle bar,
    // offset 3 one bar before the window, offset -1 one bar past the
    // current bar.
    expect(center[2]).toBeCloseTo(7 / 3, 10);
    expect(beforeWindow[2]).toBeCloseTo(-2 / 3, 10);
    expect(afterCurrent[2]).toBeCloseTo(16 / 3, 10);
  });

  it("propagates na source values through the window", async () => {
    const values: number[] = [];
    await runHistorical(closesToBars([1, 2, 4, 8, 16]), (ctx) => {
      // ta.change(close, 2) is na on the first two bars, so every length-3
      // window touching them is na; the first full window is at bar 4.
      values.push(ta.linreg(ta.change(ctx.close, 2), 3, 0).value);
    });

    expect(values.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(values[4]).toBeCloseTo(11.5, 10);
  });

  it("exposes linreg history offsets and node identity", async () => {
    const values: number[] = [];
    const history: Array<number | undefined> = [];
    const identities: unknown[] = [];
    await runHistorical(closesToBars([1, 2, 4, 8, 16]), (ctx) => {
      const curve = ta.linreg(ctx.close, 3, 0);
      const sameCurve = ta.linreg(ctx.close, 3, 0);
      const startValue = ta.linreg(ctx.close, 3, 2);
      values.push(curve.value);
      history.push(curve.at(1));
      identities.push(curve, sameCurve, startValue);
    });

    expect(values[3]).toBeCloseTo(7.666666666666667, 10);
    expect(history[3]).toBeCloseTo(3.8333333333333335, 10);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[0]).not.toBe(identities[2]);
  });

  it("rejects invalid linreg parameters", async () => {
    await runHistorical(closesToBars([1, 2, 4, 8, 16]), (ctx) => {
      expect(() => ta.linreg(ctx.close, 0, 0)).toThrow(RangeError);
      expect(() => ta.linreg(ctx.close, 3, 0.5)).toThrow(RangeError);
    });
  });
});
