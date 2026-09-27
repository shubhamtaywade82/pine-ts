/**
 * Double-entry verification: run the actual pine-ts runtime over the newly
 * generated fixtures and compare against the Python-derived expected values.
 * Run with: npx tsx scripts/verify-fixtures.ts (from the repo root).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { array, PineRuntime, math, str, ta } from "../src/index.js";
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

// ---------------------------------------------------------------------------
// array fixtures
// ---------------------------------------------------------------------------

const arrayFixturesDir = resolve(import.meta.dirname, "../fixtures/v6/array");

type NestedValue = number | boolean | string | null | NestedValue[];
type ArrayCase = Record<string, unknown>;

const loadArrayFixture = async (name: string) =>
  JSON.parse(await readFile(resolve(arrayFixturesDir, `${name}.basic.json`), "utf8")) as {
    input: { cases: ArrayCase[] };
    expected: Record<string, NestedValue[]>;
  };

const nestedEqual = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => nestedEqual(item, right[i]));
  }
  if (typeof left === "number" && typeof right === "number") {
    if (Number.isNaN(left) && Number.isNaN(right)) return true;
    return Math.abs(left - right) < 1e-9;
  }
  const norm = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (typeof value === "number" && Number.isNaN(value)) return null;
    return value;
  };
  return norm(left) === norm(right);
};

const toElements = (values: readonly unknown[]): Array<number | undefined> =>
  values.map((value) => (value === null ? Number.NaN : (value as number)));

/** Builds a fresh float array from possibly-na elements (empty stays empty). */
const mk = (values: ReadonlyArray<number | undefined>): array.FloatArray =>
  values.length === 0 ? array.newFloat(0) : array.from(values[0] ?? Number.NaN, ...values.slice(1));

const observeElements = (values: ReadonlyArray<number | undefined>): NestedValue =>
  values.map((element) => (element === undefined || Number.isNaN(element) ? null : element));

const naOrValue = (value: number | undefined): NestedValue =>
  value === undefined || Number.isNaN(value) ? null : value;

interface OpOutcome {
  readonly id: array.FloatArray;
  last: number | undefined;
}

const runOps = (start: readonly unknown[], ops: readonly unknown[][]): OpOutcome => {
  const elements = toElements(start);
  const id = mk(elements);
  let last: number | undefined;
  for (const op of ops) {
    const [name, ...args] = op as [string, ...unknown[]];
    switch (name) {
      case "push":
        array.push(id, args[0] as number);
        last = undefined;
        break;
      case "unshift":
        array.unshift(id, args[0] as number);
        last = undefined;
        break;
      case "pop":
        last = array.pop(id);
        break;
      case "shift":
        last = array.shift(id);
        break;
      case "get":
        last = array.get(id, args[0] as number);
        break;
      case "set":
        array.set(id, args[0] as number, args[1] as number);
        last = undefined;
        break;
      case "insert":
        array.insert(id, args[0] as number, args[1] as number);
        last = undefined;
        break;
      case "remove":
        last = array.remove(id, args[0] as number);
        break;
      case "clear":
        array.clear(id);
        last = undefined;
        break;
      case "fill":
        array.fill(
          id,
          args[0] as number,
          args[1] as number | undefined,
          args[2] as number | undefined,
        );
        last = undefined;
        break;
      case "reverse":
        array.reverse(id);
        last = undefined;
        break;
      case "sort":
        array.sort(id, args[0] as "ascending" | "descending");
        last = undefined;
        break;
      case "concat":
        for (const value of args[0] as number[]) array.push(id, value);
        last = undefined;
        break;
      case "set_slice": {
        const view = array.slice(id, args[0] as number, args[1] as number);
        array.set(view, args[2] as number, args[3] as number);
        last = undefined;
        break;
      }
      case "push_slice": {
        const view = array.slice(id, args[0] as number, args[1] as number);
        array.push(view, args[2] as number);
        last = undefined;
        break;
      }
      case "first":
        last = array.first(id);
        break;
      case "last":
        last = array.last(id);
        break;
      case "size":
        last = array.size(id);
        break;
      case "copy_independent_size": {
        const duplicate = array.copy(id);
        array.push(id, args[0] as number);
        last = array.size(duplicate);
        break;
      }
      default:
        throw new Error(`unknown fixture op ${name}`);
    }
  }
  return { id, last };
};

const observeOutcome = (outcome: OpOutcome, observe: string): NestedValue => {
  if (observe === "value") return naOrValue(outcome.last);
  if (observe === "both") {
    return [naOrValue(outcome.last), observeElements(outcome.id.toArray())];
  }
  return observeElements(outcome.id.toArray());
};

const checkCases = async (fixture: string, actual: NestedValue[]): Promise<void> => {
  const { expected } = await loadArrayFixture(fixture);
  const key = Object.keys(expected)[0] as string;
  const want = expected[key] as NestedValue[];
  let ok = true;
  for (let index = 0; index < want.length; index += 1) {
    if (!nestedEqual(actual[index], want[index])) {
      console.error(
        `MISMATCH array.${fixture}[${index}]: actual=${JSON.stringify(actual[index])} expected=${JSON.stringify(want[index])}`,
      );
      ok = false;
    }
  }
  report(`${fixture}.basic.json`, key, ok);
};

// op-protocol fixtures: element access, mutation, slices, sorting
for (const fixture of [
  "get",
  "push_pop",
  "shift_unshift",
  "insert_remove",
  "fill",
  "reverse_clear_concat",
  "slice",
  "sort",
  "constructors",
]) {
  const { input } = await loadArrayFixture(fixture);
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const outcome = runOps(caseData["start"] as unknown[], caseData["ops"] as unknown[][]);
    actual.push(observeOutcome(outcome, (caseData["observe"] as string | undefined) ?? "array"));
  }
  await checkCases(fixture, actual);
}

// value fixtures: statistics over a literal element list
const valueFixture = async (
  fixture: string,
  build: (values: Array<number | undefined>) => NestedValue,
): Promise<void> => {
  const { input } = await loadArrayFixture(fixture);
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    actual.push(build(toElements(caseData["values"] as unknown[])));
  }
  await checkCases(fixture, actual);
};

await valueFixture("avg", (values) => naOrValue(array.avg(mk(values))));
await valueFixture("sum", (values) => naOrValue(array.sum(mk(values))));
await valueFixture("median", (values) => naOrValue(array.median(mk(values))));
await valueFixture("mode", (values) => naOrValue(array.mode(mk(values))));
await valueFixture("range", (values) => naOrValue(array.range(mk(values))));
await valueFixture("standardize", (values) =>
  observeElements(array.standardize(mk(values)).toArray()),
);

const nthFixture = async (
  fixture: string,
  build: (values: Array<number | undefined>, nth: number) => NestedValue,
): Promise<void> => {
  const { input } = await loadArrayFixture(fixture);
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    actual.push(build(toElements(caseData["values"] as unknown[]), caseData["nth"] as number));
  }
  await checkCases(fixture, actual);
};

await nthFixture("max", (values, nth) => naOrValue(array.max(mk(values), nth)));
await nthFixture("min", (values, nth) => naOrValue(array.min(mk(values), nth)));

// biased-flag fixtures: [variance, stdev] pairs
{
  const { input } = await loadArrayFixture("stdev_variance");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const values = mk(toElements(caseData["values"] as unknown[]));
    const biased = caseData["biased"] as boolean;
    actual.push([array.variance(values, biased), array.stdev(values, biased)]);
  }
  await checkCases("stdev_variance", actual);
}

// covariance fixtures
{
  const { input } = await loadArrayFixture("covariance");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    actual.push(
      naOrValue(
        array.covariance(
          mk(toElements(caseData["left"] as unknown[])),
          mk(toElements(caseData["right"] as unknown[])),
          caseData["biased"] as boolean,
        ),
      ),
    );
  }
  await checkCases("covariance", actual);
}

// percentrank fixtures (index-resolved reference element)
{
  const { input } = await loadArrayFixture("percentrank");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    actual.push(
      naOrValue(
        array.percentrank(
          mk(toElements(caseData["values"] as unknown[])),
          caseData["index"] as number,
        ),
      ),
    );
  }
  await checkCases("percentrank", actual);
}

// percentile fixtures: [nearest_rank, linear_interpolation] pairs
{
  const { input } = await loadArrayFixture("percentiles");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const values = mk(toElements(caseData["values"] as unknown[]));
    const percentage = caseData["percentage"] as number;
    actual.push([
      array.percentile_nearest_rank(values, percentage),
      array.percentile_linear_interpolation(values, percentage),
    ]);
  }
  await checkCases("percentiles", actual);
}

// binary search fixtures: [search, leftmost, rightmost] triples
{
  const { input } = await loadArrayFixture("binary_search");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const values = mk(toElements(caseData["values"] as unknown[]));
    const target = caseData["target"] as number;
    actual.push([
      array.binary_search(values, target),
      array.binary_search_leftmost(values, target),
      array.binary_search_rightmost(values, target),
    ]);
  }
  await checkCases("binary_search", actual);
}

// abs fixtures: array result, na (null) for the all-na or empty input
{
  const { input } = await loadArrayFixture("abs");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const result = array.abs(mk(toElements(caseData["values"] as unknown[])));
    actual.push(result === undefined ? null : observeElements(result.toArray()));
  }
  await checkCases("abs", actual);
}

// every/some/join triples
{
  const { input } = await loadArrayFixture("every_some_join");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const values = mk(toElements(caseData["values"] as unknown[]));
    actual.push([array.every(values), array.some(values), array.join(values, ",")]);
  }
  await checkCases("every_some_join", actual);
}

// str.split fixtures
{
  const { input } = await loadArrayFixture("str_split");
  const actual: NestedValue[] = [];
  for (const caseData of input.cases) {
    const parts = str.split(caseData["source"] as string, caseData["separator"] as string);
    actual.push(parts === undefined ? null : (parts.toArray() as NestedValue));
  }
  await checkCases("str_split", actual);
}

// pivot fixtures: per-bar pivot level 0 under a time % 5 anchor
{
  const pivotKinds = [
    ["pivot_traditional", "Traditional", false],
    ["pivot_classic", "Classic", false],
    ["pivot_woodie", "Woodie", false],
    ["pivot_dm", "DM", false],
    ["pivot_camarilla", "Camarilla", false],
    ["pivot_camarilla_developing", "Camarilla", true],
  ] as const;
  for (const [fixture, kind, developing] of pivotKinds) {
    const { input } = await loadArrayFixture(fixture);
    const barsSpec = input.cases[0]!["bars"] as Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
    const bars: Bar[] = barsSpec.map((bar) => ({ ...bar, isClosed: true }));
    const pivotPerBar: number[] = [];
    const script: PineScript = (ctx) => {
      const anchor = ctx.series("anchor", () => (ctx.time.value ?? 0) % 5 === 0);
      const levels = ta.pivotPointLevels(kind, anchor, developing);
      pivotPerBar.push(levels.get(0) ?? Number.NaN);
    };
    const runtime = new PineRuntime({
      provider: new Provider(bars),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, bars);
    await checkCases(fixture, [pivotPerBar.map((value) => (Number.isNaN(value) ? null : value))]);
  }
}
