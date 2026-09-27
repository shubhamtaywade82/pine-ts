/**
 * Double-entry verification: run the actual pine-ts runtime over the newly
 * generated fixtures and compare against the Python-derived expected values.
 * Run with: npx tsx scripts/verify-fixtures.ts (from the repo root).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PineRuntime, ta } from "../src/index.js";
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

const closesToBars = (closes: readonly number[], volume = 1): readonly Bar[] =>
  closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume,
    isClosed: true,
  }));

const ohlcvToBars = (
  bars: ReadonlyArray<{ high: number; low: number; close: number; open: number; volume: number }>,
): readonly Bar[] => bars.map((bar, index) => ({ time: index + 1, isClosed: true, ...bar }));

/** Observed value union shared by the fixture comparison helpers. */
type Observed = number | boolean | undefined | null;

/** Value produced by a runtime read callback. */
type RuntimeValue = number | boolean | undefined;

const collect = async (
  bars: readonly Bar[],
  read: (ctx: Parameters<PineScript>[0]) => RuntimeValue,
): Promise<RuntimeValue[]> => {
  const values: RuntimeValue[] = [];
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

const norm = (v: Observed): Observed => {
  if (typeof v !== "number") return v;
  return Number.isNaN(v) ? null : v;
};

const eq = (a: Observed, b: Observed) => {
  const x = norm(a);
  const y = norm(b);
  if (x === null && y === null) return true;
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < 1e-9;
  return x === y;
};

const fixtures = resolve(import.meta.dirname, "../fixtures/v6/ta");
const load = async (name: string) =>
  JSON.parse(await readFile(resolve(fixtures, name), "utf8")) as {
    input: Record<string, unknown>;
    expected: Record<string, Array<number | boolean | null>>;
  };

const check = async (
  name: string,
  build: (ctx: Parameters<PineScript>[0]) => RuntimeValue,
): Promise<void> => {
  const { input, expected } = await load(name);
  const key = Object.keys(expected)[0] as string;
  const closes = (input["source"] as number[] | undefined) ?? [];
  const bars =
    closes.length > 0
      ? closesToBars(closes)
      : ohlcvToBars(
          input["bars"] as Array<{
            high: number;
            low: number;
            close: number;
            open: number;
            volume: number;
          }>,
        );
  const actual = await collect(bars, (ctx) => build(ctx));
  const want = expected[key] as Array<number | boolean | null>;
  let ok = true;
  for (let i = 0; i < want.length; i += 1) {
    if (!eq(actual[i], want[i])) {
      console.error(
        `MISMATCH ${name}[${i}]: actual=${String(actual[i])} expected=${String(want[i])}`,
      );
      ok = false;
    }
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${key})`);
  if (!ok) process.exitCode = 1;
};

// source-only fixtures
await check("cum.basic.json", (ctx) => ta.cum(ctx.close).value);
await check("max.basic.json", (ctx) => ta.max(ctx.close).value);
await check("min.basic.json", (ctx) => ta.min(ctx.close).value);
await check("median.basic.json", (ctx) => ta.median(ctx.close, 4).value);
await check("mode.basic.json", (ctx) => ta.mode(ctx.close, 4).value);
await check("range.basic.json", (ctx) => ta.range(ctx.close, 4).value);
await check(
  "percentile_nearest_rank.basic.json",
  (ctx) => ta.percentileNearestRank(ctx.close, 5, 50).value,
);
await check(
  "percentile_linear_interpolation.basic.json",
  (ctx) => ta.percentileLinearInterpolation(ctx.close, 5, 30).value,
);
await check("percentrank.basic.json", (ctx) => ta.percentrank(ctx.close, 3).value);
await check("rci.basic.json", (ctx) => ta.rci(ctx.close, 5).value);
await check("cci.basic.json", (ctx) => ta.cci(ctx.close, 3).value);
await check("cog.basic.json", (ctx) => ta.cog(ctx.close, 3).value);
await check("tsi.basic.json", (ctx) => ta.tsi(ctx.close, 3, 5).value);
await check("alma.basic.json", (ctx) => ta.alma(ctx.close, 9, 0.85, 6).value);

// two-source fixtures (the second source maps onto the bar volume so both
// operands are real session-owned source series)
{
  const { input, expected } = await load("cross.basic.json");
  const s1 = input["source1"] as number[];
  const s2 = input["source2"] as number[];
  const bars = closesToBars(s1).map((bar, index) => ({ ...bar, volume: s2[index] as number }));
  const actual = await collect(bars, (ctx) => ta.cross(ctx.close, ctx.volume).value);
  const want = expected["cross"] as Array<boolean | null>;
  let ok = true;
  for (let i = 0; i < want.length; i += 1) {
    if ((actual[i] ?? null) !== (want[i] ?? null)) {
      console.error(
        `MISMATCH cross[${i}]: actual=${String(actual[i])} expected=${String(want[i])}`,
      );
      ok = false;
    }
  }
  console.log(`${ok ? "PASS" : "FAIL"} cross.basic.json`);
  if (!ok) process.exitCode = 1;
}
{
  const { input, expected } = await load("correlation.basic.json");
  const s1 = input["source1"] as number[];
  const s2 = input["source2"] as number[];
  const bars = closesToBars(s1).map((bar, index) => ({ ...bar, volume: s2[index] as number }));
  const actual = await collect(bars, (ctx) => ta.correlation(ctx.close, ctx.volume, 4).value);
  const want = expected["correlation"] as Array<number | null>;
  let ok = true;
  for (let i = 0; i < want.length; i += 1) {
    if (!eq(actual[i], want[i])) {
      console.error(
        `MISMATCH correlation[${i}]: actual=${String(actual[i])} expected=${String(want[i])}`,
      );
      ok = false;
    }
  }
  console.log(`${ok ? "PASS" : "FAIL"} correlation.basic.json`);
  if (!ok) process.exitCode = 1;
}

// OHLCV fixtures
await check("iii.basic.json", () => ta.iii().value);
await check("wvad.basic.json", () => ta.wvad().value);
await check("wad.basic.json", () => ta.wad().value);

// hlcc4 sanity
{
  const ohlc: readonly Bar[] = [
    { time: 1, open: 9, high: 12, low: 8, close: 11, volume: 1, isClosed: true },
    { time: 2, open: 10, high: 14, low: 9, close: 12, volume: 1, isClosed: true },
  ];
  const values: number[] = [];
  const runtime = new PineRuntime({
    provider: new Provider(ohlc),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((ctx) => values.push(ctx.hlcc4.value), ohlc);
  const want = [(12 + 8 + 2 * 11) / 4, (14 + 9 + 2 * 12) / 4];
  const ok = values.every((v, i) => Math.abs(v - (want[i] as number)) < 1e-9);
  console.log(`${ok ? "PASS" : "FAIL"} hlcc4 (${values.join(", ")})`);
  if (!ok) process.exitCode = 1;
}
