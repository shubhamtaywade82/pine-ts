/**
 * Double-entry verification: run the actual pine-ts runtime over the newly
 * generated fixtures and compare against the Python-derived expected values.
 * Run with: npx tsx scripts/verify-fixtures.ts (from the repo root).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PineRuntime, math, str, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

const mathInfo: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto", minTick: 0.25 };

class Provider implements MarketDataProvider {
  public constructor(
    private readonly bars: readonly Bar[],
    private readonly symbolInfo: SymbolInfo = info,
  ) {}
  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => this.symbolInfo;
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

// ---------------------------------------------------------------------------
// math fixtures
// ---------------------------------------------------------------------------

const mathFixturesDir = resolve(import.meta.dirname, "../fixtures/v6/math");

type FixtureValue = number | boolean | string | null;
type ObservedValue = FixtureValue | undefined;

interface FixturePayload {
  input: Record<string, unknown>;
  expected: Record<string, FixtureValue[]>;
}

const loadJson = async (dir: string, name: string): Promise<FixturePayload> =>
  JSON.parse(await readFile(resolve(dir, name), "utf8")) as FixturePayload;

const collectMath = async (
  bars: readonly Bar[],
  read: (ctx: Parameters<PineScript>[0]) => number,
): Promise<Array<number | undefined>> => {
  const values: Array<number | undefined> = [];
  const runtime = new PineRuntime({
    provider: new Provider(bars, mathInfo),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run((ctx) => {
    values.push(read(ctx));
  }, bars);
  return values;
};

const report = (name: string, key: string, ok: boolean): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${key})`);
  if (!ok) process.exitCode = 1;
};

const matchesExpected = (actual: ObservedValue, expectedValue: FixtureValue): boolean => {
  if (typeof actual !== "number") {
    return (actual ?? null) === (expectedValue ?? null);
  }
  // Numeric na (NaN) matches the JSON null the Python mirror records.
  if (Number.isNaN(actual)) return expectedValue === null;
  return typeof expectedValue === "number" && Math.abs(actual - expectedValue) < 1e-9;
};

const compareSeries = (
  name: string,
  key: string,
  actual: Array<number | undefined>,
  want: FixtureValue[],
): void => {
  let ok = true;
  for (let index = 0; index < want.length; index += 1) {
    if (!matchesExpected(actual[index], want[index]!)) {
      console.error(
        `MISMATCH ${name}[${index}]: actual=${String(actual[index])} expected=${String(want[index])}`,
      );
      ok = false;
    }
  }
  report(name, key, ok);
};

{
  const pointwise: Readonly<Record<string, (ctx: Parameters<PineScript>[0]) => number>> = {
    abs: (ctx) => math.abs(ctx.close).value,
    acos: (ctx) => math.acos(ctx.close).value,
    asin: (ctx) => math.asin(ctx.close).value,
    atan: (ctx) => math.atan(ctx.close).value,
    ceil: (ctx) => math.ceil(ctx.close).value,
    cos: (ctx) => math.cos(ctx.close).value,
    exp: (ctx) => math.exp(ctx.close).value,
    floor: (ctx) => math.floor(ctx.close).value,
    log: (ctx) => math.log(ctx.close).value,
    log10: (ctx) => math.log10(ctx.close).value,
    sign: (ctx) => math.sign(ctx.close).value,
    sin: (ctx) => math.sin(ctx.close).value,
    sqrt: (ctx) => math.sqrt(ctx.close).value,
    tan: (ctx) => math.tan(ctx.close).value,
    todegrees: (ctx) => math.todegrees(ctx.close).value,
    toradians: (ctx) => math.toradians(ctx.close).value,
  };
  for (const [name, read] of Object.entries(pointwise)) {
    const { input, expected } = await loadJson(mathFixturesDir, `${name}.basic.json`);
    const actual = await collectMath(closesToBars(input["source"] as number[]), read);
    compareSeries(`${name}.basic.json`, name, actual, expected[name]!);
  }
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "pow.basic.json");
  const exponent = input["exponent"] as number;
  const actual = await collectMath(
    closesToBars(input["source"] as number[]),
    (ctx) => math.pow(ctx.close, exponent).value,
  );
  compareSeries("pow.basic.json", "pow", actual, expected["pow"]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "round.basic.json");
  const precision = input["precision"] as number;
  const actual = await collectMath(
    closesToBars(input["source"] as number[]),
    (ctx) => math.round(ctx.close, precision).value,
  );
  compareSeries("round.basic.json", "round", actual, expected["round"]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "round_to_mintick.basic.json");
  // The fixture's mintick matches mathInfo.minTick; the series overload reads
  // it from the session symbol info.
  const actual = await collectMath(
    closesToBars(input["source"] as number[]),
    (ctx) => math.roundToMintick(ctx.close).value,
  );
  compareSeries(
    "round_to_mintick.basic.json",
    "round_to_mintick",
    actual,
    expected["round_to_mintick"]!,
  );
}

for (const name of ["max", "min"] as const) {
  const { input, expected } = await loadJson(mathFixturesDir, `${name}.basic.json`);
  const source1 = input["source1"] as number[];
  const source2 = input["source2"] as number[];
  const bars = closesToBars(source1).map((bar, index) => ({
    ...bar,
    volume: source2[index] as number,
  }));
  const read =
    name === "max"
      ? (ctx: Parameters<PineScript>[0]) => math.max(ctx.close, ctx.volume).value
      : (ctx: Parameters<PineScript>[0]) => math.min(ctx.close, ctx.volume).value;
  const actual = await collectMath(bars, read);
  compareSeries(`${name}.basic.json`, name, actual, expected[name]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "avg.basic.json");
  const source1 = input["source1"] as number[];
  const source2 = input["source2"] as number[];
  const scalar = input["scalar"] as number;
  const bars = closesToBars(source1).map((bar, index) => ({
    ...bar,
    volume: source2[index] as number,
  }));
  const actual = await collectMath(bars, (ctx) => math.avg(ctx.close, ctx.volume, scalar).value);
  compareSeries("avg.basic.json", "avg", actual, expected["avg"]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "sum.basic.json");
  const length = input["length"] as number;
  const actual = await collectMath(
    closesToBars(input["source"] as number[]),
    (ctx) => math.sum(ctx.close, length).value,
  );
  compareSeries("sum.basic.json", "sum", actual, expected["sum"]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "sum.skipna.json");
  const length = input["length"] as number;
  const source = input["source"] as number[];
  const naValues = new Set((input["naAt"] as number[]).map((index) => source[index] as number));
  const actual = await collectMath(closesToBars(source), (ctx) => {
    // The condition must read a live series: the user-series closure captures
    // the first bar's context snapshot, so barstate/bar are frozen there.
    const gappy = ctx.series("gappy", () =>
      naValues.has(ctx.close.value) ? Number.NaN : ctx.close.value,
    );
    return math.sum(gappy, length).value;
  });
  compareSeries("sum.skipna.json", "sum", actual, expected["sum"]!);
}

{
  const { input, expected } = await loadJson(mathFixturesDir, "random.seeded.json");
  const seed = input["seed"] as number;
  const min = input["min"] as number;
  const max = input["max"] as number;
  const calls = input["calls"] as number;
  const actual: number[] = [];
  for (let index = 0; index < calls; index += 1) {
    actual.push(math.random(min, max, seed));
  }
  // Scalar calls run outside any session, so the process-global sequence is
  // used — exactly the environment the Python mirror models.
  compareSeries("random.seeded.json", "random", actual, expected["random"]!);
}

// ---------------------------------------------------------------------------
// str fixtures
// ---------------------------------------------------------------------------

const strFixturesDir = resolve(import.meta.dirname, "../fixtures/v6/str");

type StrCase = Record<string, unknown>;
type StrResult = number | boolean | string | null | undefined;

const asString = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : (value as string);

const strBuilders: Readonly<Record<string, (args: StrCase) => StrResult>> = {
  contains: (a) => str.contains(asString(a["source"]), a["str"] as string),
  endswith: (a) => str.endswith(asString(a["source"]), a["str"] as string),
  startswith: (a) => str.startswith(asString(a["source"]), a["str"] as string),
  length: (a) => str.length(asString(a["source"])),
  lower: (a) => str.lower(asString(a["source"])),
  upper: (a) => str.upper(asString(a["source"])),
  trim: (a) => str.trim(asString(a["source"])),
  pos: (a) => str.pos(asString(a["source"]), a["str"] as string),
  repeat: (a) =>
    str.repeat(asString(a["source"]), a["repeat"] as number, (a["separator"] as string) ?? ""),
  replace: (a) =>
    str.replace(
      asString(a["source"]),
      a["target"] as string,
      a["replacement"] as string,
      (a["occurrence"] as number | undefined) ?? 0,
    ),
  replace_all: (a) =>
    str.replaceAll(asString(a["source"]), a["target"] as string, a["replacement"] as string),
  substring: (a) =>
    str.substring(
      asString(a["source"]),
      a["begin_pos"] as number,
      a["end_pos"] as number | undefined,
    ),
  match: (a) => str.match(asString(a["source"]), a["regex"] as string),
  tonumber: (a) => str.tonumber(asString(a["source"])),
  tostring: (a) => {
    let format: string | ReturnType<typeof str.mintick> | undefined;
    if (a["format"] !== undefined) {
      format = a["format"] as string;
    } else if (a["mintick"] !== undefined) {
      format = str.mintick(a["mintick"] as number);
    }
    const value = a["value"];
    if (typeof value === "boolean") return str.tostring(value, format);
    return str.tostring(value === null ? undefined : (value as number | string), format);
  },
  format: (a) => str.format(...(a["args"] as unknown[] as Parameters<typeof str.format>)),
  format_time: (a) =>
    str.formatTime(
      (a["time"] as number | null) ?? Number.NaN,
      (a["format"] as string | undefined) ?? undefined,
      asString(a["timezone"]),
    ),
};

for (const [name, build] of Object.entries(strBuilders)) {
  const { input, expected } = await loadJson(strFixturesDir, `${name}.basic.json`);
  const cases = input["cases"] as StrCase[];
  const want = expected[name] as FixtureValue[];
  let ok = true;
  for (let index = 0; index < cases.length; index += 1) {
    const actual = build(cases[index]!);
    if (!matchesExpected(actual, want[index]!)) {
      console.error(
        `MISMATCH str.${name}[${index}]: actual=${JSON.stringify(actual ?? null)} expected=${JSON.stringify(want[index])}`,
      );
      ok = false;
    }
  }
  report(`${name}.basic.json`, name, ok);
}
