import { describe, expect, it } from "vitest";
import { PineRuntime, array, constants, matrix, resolveSource, str } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

class Provider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

const ohlcvBars: readonly Bar[] = [
  { time: 1, open: 9, high: 12, low: 8, close: 11, volume: 100, isClosed: true },
  { time: 2, open: 11, high: 13, low: 9, close: 9, volume: 200, isClosed: true },
  { time: 3, open: 10, high: 10, low: 10, close: 10, volume: 50, isClosed: true },
  { time: 4, open: 11, high: 14, low: 10, close: 13, volume: 150, isClosed: true },
];

const collect = async (
  bars: readonly Bar[],
  read: (ctx: Parameters<PineScript>[0]) => number,
): Promise<number[]> => {
  const values: number[] = [];
  const runtime = new PineRuntime({
    provider: new Provider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((ctx) => {
    values.push(read(ctx));
  }, bars);
  return values;
};

describe("Pine v6 gaps recovered from the feature branches", () => {
  it("exposes hlcc4 with double close weight", async () => {
    const values = await collect(ohlcvBars, (ctx) => ctx.hlcc4.value);

    expect(values).toEqual([
      (12 + 8 + 2 * 11) / 4,
      (13 + 9 + 2 * 9) / 4,
      10,
      (14 + 10 + 2 * 13) / 4,
    ]);
  });

  it("resolves hlcc4 through the registry source selector", async () => {
    const runtime = new PineRuntime({
      provider: new Provider(ohlcvBars),
      symbol: "TEST",
      timeframe: "1m",
    });
    const values: number[] = [];
    await runtime.run((ctx) => {
      values.push(resolveSource(ctx, "hlcc4").value);
    }, ohlcvBars);
    expect(values[0]).toBeCloseTo(10.5, 15);
  });

  it("repeats strings with an optional separator", () => {
    expect(str.repeat("?", 3, ",")).toBe("?,?,?");
    expect(str.repeat("ab", 2)).toBe("abab");
    expect(str.repeat("ab", 0, "-")).toBe("");
    expect(str.repeat(undefined, 3)).toBeUndefined();
    expect(() => str.repeat("a", -1)).toThrow(RangeError);
    expect(() => str.repeat("a", 1.5)).toThrow(RangeError);
  });

  it("parses only plain decimal and scientific notation", () => {
    expect(str.tonumber("42")).toBe(42);
    expect(str.tonumber("-3.5")).toBe(-3.5);
    expect(str.tonumber("+.5")).toBeCloseTo(0.5, 15);
    expect(str.tonumber("1.5e3")).toBeCloseTo(1500, 15);
    expect(str.tonumber("-2E-2")).toBeCloseTo(-0.02, 15);
    expect(str.tonumber("abc")).toBeNaN();
    expect(str.tonumber("")).toBeNaN();
    expect(str.tonumber("0x10")).toBeNaN();
    expect(str.tonumber("Infinity")).toBeNaN();
    expect(str.tonumber(" 1.5")).toBeNaN();
    expect(str.tonumber(undefined)).toBeNaN();
  });

  it("formats timestamps with the default pattern", () => {
    const time = Date.UTC(2024, 0, 15, 14, 30, 45, 123);
    expect(str.format_time(time)).toBe("2024-01-15T14:30:45+0000");
    expect(str.format_time(time, "yyyy-MM-dd'T'HH:mm:ssZ")).toBe("2024-01-15T14:30:45+0000");
  });

  it("renders the supported SimpleDateFormat token set", () => {
    const time = Date.UTC(2024, 0, 15, 14, 30, 45, 123);
    expect(str.format_time(time, "yyyy-MM-dd HH:mm:ss.SSS")).toBe("2024-01-15 14:30:45.123");
    expect(str.format_time(time, "yy-M-d h:m:s a")).toBe("24-1-15 2:30:45 PM");
    expect(str.format_time(time, "EEE yyyy/MM/dd")).toBe("Mon 2024/01/15");
    expect(str.format_time(time, "EEEE, MMMM d, yyyy")).toBe("Monday, January 15, 2024");
    expect(str.format_time(time, "S")).toBe("1");
  });

  it("applies IANA timezones with DST awareness", () => {
    const january = Date.UTC(2024, 0, 15, 14, 30, 45, 123);
    expect(str.format_time(january, "yyyy-MM-dd HH:mm:ss Z", "America/New_York")).toBe(
      "2024-01-15 09:30:45 -0500",
    );
    const july = Date.UTC(2024, 6, 15, 14, 30, 45, 123);
    expect(str.format_time(july, "yyyy-MM-dd HH:mm:ss Z", "America/New_York")).toBe(
      "2024-07-15 10:30:45 -0400",
    );
    expect(str.format_time(january, "yyyy-MM-dd HH:mm:ss.SSS", "Asia/Kolkata")).toBe(
      "2024-01-15 20:00:45.123",
    );
  });

  it("accepts UTC and GMT offset notation", () => {
    const time = Date.UTC(2024, 0, 15, 14, 30, 45, 123);
    expect(str.format_time(time, "HH:mm Z", "UTC-5")).toBe("09:30 -0500");
    expect(str.format_time(time, "HH:mm Z", "GMT+0530")).toBe("20:00 +0530");
    expect(str.format_time(time, "HH:mm Z", "UTC+05:30")).toBe("20:00 +0530");
    expect(str.format_time(time, "HH:mm Z", "GMT")).toBe("14:30 +0000");
  });

  it("propagates na and rejects malformed input", () => {
    const time = Date.UTC(2024, 0, 15, 14, 30, 45, 123);
    expect(str.format_time(Number.NaN)).toBeUndefined();
    expect(() => str.format_time(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => str.format_time(time, "QQ")).toThrow(RangeError);
    expect(() => str.format_time(time, "yyyy", "Not/AZone")).toThrow(RangeError);
  });

  it("uses Pine's order.ascending / order.descending for sorts", () => {
    const values = array.from(30, 10, 50, 20);
    array.sort(values, constants.order.descending);
    expect(array.get(values, 0)).toBe(50);

    const m = matrix.new_matrix<number>(3, 1, 0);
    matrix.set(m, 0, 0, 30);
    matrix.set(m, 1, 0, 10);
    matrix.set(m, 2, 0, 20);
    matrix.sort(m, 0, constants.order.descending);
    expect(matrix.get(m, 0, 0)).toBe(30);
  });
});
