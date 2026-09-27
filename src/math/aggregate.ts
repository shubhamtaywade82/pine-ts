import { getCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import type { PineSession } from "../core/session.js";
import { FloatSeries, type Series } from "../core/series.js";
import { collectNonNaWindow } from "../ta/window.js";
import type { MathOperand } from "./pointwise.js";

const requireSeriesRuntime = (source: Series<number>): PineSession => {
  if (source.runtime === undefined) {
    throw new Error("Math series require a PineSession-owned source series");
  }
  return source.runtime;
};

const requireVariadic = (name: string, values: readonly MathOperand[]): void => {
  if (values.length < 2) {
    throw new RangeError(`${name} expects at least two values`);
  }
};

const isSeriesOperand = (value: MathOperand): value is Series<number> => typeof value === "object";

/**
 * Series-side engine for the aggregate built-ins: a memoized elementwise
 * node keyed on every operand identity.
 */
const variadicSeries = (
  key: string,
  values: readonly MathOperand[],
  combine: (numbers: readonly number[]) => number,
): FloatSeries => {
  const seriesOperands = values.filter(isSeriesOperand);
  const first = seriesOperands[0]!;
  const runtime = requireSeriesRuntime(first);
  if (seriesOperands.some((operand) => operand.runtime !== runtime)) {
    throw new Error("Math series operands must belong to the same PineSession");
  }

  const evaluate = (): number =>
    combine(
      values.map((operand) => (isSeriesOperand(operand) ? (operand.at(0) ?? Number.NaN) : operand)),
    );

  return runtime.nodes.getOrCreate(nodeKey(key, ...values), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => evaluate(),
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * Variadic pointwise engine for the aggregate built-ins: scalar-only calls
 * collapse to a scalar; any series operand produces an elementwise series.
 */
const applyVariadic = (
  key: string,
  values: readonly MathOperand[],
  combine: (numbers: readonly number[]) => number,
): number | FloatSeries =>
  values.some(isSeriesOperand)
    ? variadicSeries(key, values, combine)
    : combine(values as readonly number[]);

/**
 * math.avg — average of all given values, elementwise across series
 * operands. na propagates: an na operand makes the average na, the standard
 * scalar convention for a function with no documented na remark.
 */
export function avg(...values: readonly number[]): number;
export function avg(first: Series<number>, ...rest: readonly MathOperand[]): FloatSeries;
export function avg(...values: readonly MathOperand[]): number | FloatSeries;
export function avg(...values: readonly MathOperand[]): number | FloatSeries {
  requireVariadic("math.avg", values);
  return applyVariadic("math.avg", values, (numbers) => {
    let sum = 0;
    for (const value of numbers) sum += value;
    return sum / numbers.length;
  });
}

/**
 * math.max — the greatest of multiple values, elementwise across series
 * operands.
 *
 * na propagates: v4, v5 and v6 document no "na values are ignored" remark for
 * the variadic `math.max` (that wording belongs to the windowed
 * `ta.max`/`ta.highest` family), and the sibling `math.round` documents plain
 * na propagation — so pine-ts follows the standard scalar convention until
 * oracle vectors say otherwise.
 */
export function max(...values: readonly number[]): number;
export function max(first: Series<number>, ...rest: readonly MathOperand[]): FloatSeries;
export function max(...values: readonly MathOperand[]): number | FloatSeries;
export function max(...values: readonly MathOperand[]): number | FloatSeries {
  requireVariadic("math.max", values);
  return applyVariadic("math.max", values, (numbers) => Math.max(...numbers));
}

/**
 * math.min — the smallest of multiple values, elementwise across series
 * operands. Same na model as {@link max}.
 */
export function min(...values: readonly number[]): number;
export function min(first: Series<number>, ...rest: readonly MathOperand[]): FloatSeries;
export function min(...values: readonly MathOperand[]): number | FloatSeries;
export function min(...values: readonly MathOperand[]): number | FloatSeries {
  requireVariadic("math.min", values);
  return applyVariadic("math.min", values, (numbers) => Math.min(...numbers));
}

/**
 * math.sum — the sliding sum of the last `length` values of `source`.
 *
 * v6 remark: "na values in the source series are ignored; the function
 * calculates on the length quantity of non-na values" — the same skip-na
 * window model as the `ta` statistics family: a na current value yields na,
 * and fewer than `length` non-na values yield na (warm-up).
 */
export const sum = (source: Series<number>, length: number): FloatSeries => {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("math.sum length must be a positive integer");
  }
  const runtime = requireSeriesRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("math.sum", source, length), () => {
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        let total = 0;
        for (const entry of window) total += entry.value;
        return total;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

const roundToTick = (value: number, mintick: number): number =>
  Math.round(value / mintick) * mintick;

const requireValidMintick = (mintick: number): void => {
  if (!Number.isFinite(mintick) || mintick <= 0) {
    throw new RangeError("math.round_to_mintick requires a positive finite mintick");
  }
};

/**
 * Series-side `math.round_to_mintick`: reads the owning session's
 * `SymbolInfo.minTick` lazily so pipelines may be built before the session's
 * symbol information is initialized.
 */
const roundToMintickSeries = (source: Series<number>): FloatSeries => {
  const runtime = requireSeriesRuntime(source);
  return runtime.nodes.getOrCreate(nodeKey("math.round_to_mintick", source), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => {
        const info = runtime.getSymbolInfo();
        const tick = info.minTick;
        if (tick === undefined || !Number.isFinite(tick) || tick <= 0) {
          throw new RangeError(
            "math.round_to_mintick requires a positive SymbolInfo.minTick on the session",
          );
        }
        const current = source.at(0);
        return current === undefined ? Number.NaN : roundToTick(current, tick);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * math.round_to_mintick — value rounded to the symbol's mintick, "the nearest
 * value that can be divided by syminfo.mintick, without the remainder, with
 * ties rounding up". na propagates.
 *
 * pine-ts has no ambient chart, so the scalar overload takes the mintick
 * explicitly, while the series overload reads it from the owning session's
 * `SymbolInfo.minTick` (v6 remark: "Note that for 'na' values function
 * returns 'na'").
 */
export function roundToMintick(value: number, mintick: number): number;
export function roundToMintick(value: Series<number>): FloatSeries;
export function roundToMintick(value: MathOperand, mintick?: number): number | FloatSeries {
  const tick = mintick ?? Number.NaN;
  return typeof value === "number"
    ? (requireValidMintick(tick), roundToTick(value, tick))
    : roundToMintickSeries(value);
}

/**
 * mulberry32 — the public-domain 32-bit PRNG Pine-compatible seeded sequences
 * are built on. The returned uniform value is strictly inside (0, 1) because
 * the v6 reference documents both `math.random` bounds as excluded: "The
 * value is not included in the range."
 */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
};

const nextUnseeded = (): number => {
  // Cryptographic entropy keeps the unseeded sequence fresh on every script
  // run; the +0.5 nudge keeps the uniform strictly inside (0, 1).
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0]! + 0.5) / 4294967296;
};

/** Seeded sequences started during script execution, scoped per session. */
const sessionSequences = new WeakMap<PineSession, Map<number, () => number>>();

/** Seeded sequences started outside any script execution. */
const globalSequences = new Map<number, () => number>();

const nextSeeded = (seed: number): number => {
  const session = getCurrentSession();
  const registry =
    session === undefined
      ? globalSequences
      : (sessionSequences.get(session) ??
        (() => {
          const fresh = new Map<number, () => number>();
          sessionSequences.set(session, fresh);
          return fresh;
        })());
  const sequence =
    registry.get(seed) ??
    (() => {
      const fresh = mulberry32(seed);
      registry.set(seed, fresh);
      return fresh;
    })();
  return sequence();
};

/**
 * math.random — pseudo-random value in the open interval (min, max); both
 * bounds are excluded per the v6 reference. Defaults are min = 0, max = 1.
 *
 * Passing the same `seed` produces a repeatable sequence across successive
 * calls (the v6 reference: "When the same seed is used, allows successive
 * calls to the function to produce a repeatable set of values"). The sequence
 * is call-order dependent and restarts with each script execution: sequences
 * started inside a PineSession reset when a fresh runtime runs the script,
 * matching the "different sequence for each script execution" behavior. Omit
 * the seed for a fresh, cryptographically seeded value on every call.
 */
export const random = (min = 0, max = 1, seed?: number): number =>
  min + (seed === undefined ? nextUnseeded() : nextSeeded(seed)) * (max - min);
