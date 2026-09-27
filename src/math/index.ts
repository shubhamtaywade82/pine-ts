import { getCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import type { PineSession } from "../core/session.js";
import { collectNonNaWindow } from "../ta/window.js";

export const e: number = Math.E;
export const pi: number = Math.PI;
export const phi = 1.618033988749895;
export const rphi = 0.618033988749895;

export type Numeric = number | Series<number>;

const isSeries = (val: unknown): val is Series<number> => val instanceof Series;

const getSession = (...operands: readonly unknown[]): PineSession => {
  for (const op of operands) {
    if (isSeries(op) && op.runtime !== undefined) return op.runtime;
  }
  const active = getCurrentSession();
  if (active !== undefined) return active;
  throw new Error("Series operands must belong to an active PineSession");
};

const scalarUnary = (fn: (x: number) => number, x: number): number =>
  isNa(x) ? Number.NaN : fn(x);

const seriesUnary = (name: string, fn: (x: number) => number, x: Series<number>): FloatSeries => {
  const session = getSession(x);
  return session.nodes.getOrCreate(nodeKey(`math.${name}`, x), () => {
    const def = {
      init: (): null => null,
      evaluate: (): number => {
        const v = x.at(0);
        return v === undefined || isNa(v) ? Number.NaN : fn(v);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(session, new IndicatorNode(def));
  }) as FloatSeries;
};

const scalarBinary = (fn: (a: number, b: number) => number, a: number, b: number): number =>
  isNa(a) || isNa(b) ? Number.NaN : fn(a, b);

const seriesBinary = (
  name: string,
  fn: (a: number, b: number) => number,
  a: Numeric,
  b: Numeric,
): FloatSeries => {
  const session = getSession(a, b);
  return session.nodes.getOrCreate(nodeKey(`math.${name}`, a, b), () => {
    const def = {
      init: (): null => null,
      evaluate: (): number => {
        const av = isSeries(a) ? a.at(0) : a;
        const bv = isSeries(b) ? b.at(0) : b;
        return av === undefined || bv === undefined || isNa(av) || isNa(bv)
          ? Number.NaN
          : fn(av, bv);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(session, new IndicatorNode(def));
  }) as FloatSeries;
};

const scalarVariadic = (
  fn: (nums: readonly number[]) => number,
  nums: readonly number[],
): number => (nums.some(isNa) ? Number.NaN : fn(nums));

const seriesVariadic = (
  name: string,
  fn: (nums: readonly number[]) => number,
  args: readonly Numeric[],
): FloatSeries => {
  const session = getSession(...args);
  return session.nodes.getOrCreate(nodeKey(`math.${name}`, ...args), () => {
    const def = {
      init: (): null => null,
      evaluate: (): number => {
        const evaluated = args.map((arg) => (isSeries(arg) ? arg.at(0) : arg));
        if (evaluated.some((v) => v === undefined || isNa(v))) return Number.NaN;
        return fn(evaluated as readonly number[]);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(session, new IndicatorNode(def));
  }) as FloatSeries;
};

const signScalar = (x: number): number => {
  if (x > 0) return 1;
  return x < 0 ? -1 : 0;
};

export function abs(x: number): number;
export function abs(x: Series<number>): FloatSeries;
export function abs(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("abs", Math.abs, x) : scalarUnary(Math.abs, x);
}

export function sign(x: number): number;
export function sign(x: Series<number>): FloatSeries;
export function sign(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("sign", signScalar, x) : scalarUnary(signScalar, x);
}

export function ceil(x: number): number;
export function ceil(x: Series<number>): FloatSeries;
export function ceil(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("ceil", Math.ceil, x) : scalarUnary(Math.ceil, x);
}

export function floor(x: number): number;
export function floor(x: Series<number>): FloatSeries;
export function floor(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("floor", Math.floor, x) : scalarUnary(Math.floor, x);
}

export function sin(x: number): number;
export function sin(x: Series<number>): FloatSeries;
export function sin(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("sin", Math.sin, x) : scalarUnary(Math.sin, x);
}

export function cos(x: number): number;
export function cos(x: Series<number>): FloatSeries;
export function cos(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("cos", Math.cos, x) : scalarUnary(Math.cos, x);
}

export function tan(x: number): number;
export function tan(x: Series<number>): FloatSeries;
export function tan(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("tan", Math.tan, x) : scalarUnary(Math.tan, x);
}

export function asin(x: number): number;
export function asin(x: Series<number>): FloatSeries;
export function asin(x: Numeric): FloatSeries | number {
  const op = (v: number): number => (v < -1 || v > 1 ? Number.NaN : Math.asin(v));
  return isSeries(x) ? seriesUnary("asin", op, x) : scalarUnary(op, x);
}

export function acos(x: number): number;
export function acos(x: Series<number>): FloatSeries;
export function acos(x: Numeric): FloatSeries | number {
  const op = (v: number): number => (v < -1 || v > 1 ? Number.NaN : Math.acos(v));
  return isSeries(x) ? seriesUnary("acos", op, x) : scalarUnary(op, x);
}

export function atan(x: number): number;
export function atan(x: Series<number>): FloatSeries;
export function atan(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("atan", Math.atan, x) : scalarUnary(Math.atan, x);
}

export function sqrt(x: number): number;
export function sqrt(x: Series<number>): FloatSeries;
export function sqrt(x: Numeric): FloatSeries | number {
  const op = (v: number): number => (v < 0 ? Number.NaN : Math.sqrt(v));
  return isSeries(x) ? seriesUnary("sqrt", op, x) : scalarUnary(op, x);
}

export function exp(x: number): number;
export function exp(x: Series<number>): FloatSeries;
export function exp(x: Numeric): FloatSeries | number {
  return isSeries(x) ? seriesUnary("exp", Math.exp, x) : scalarUnary(Math.exp, x);
}

export function log(x: number): number;
export function log(x: Series<number>): FloatSeries;
export function log(x: Numeric): FloatSeries | number {
  const op = (v: number): number => (v <= 0 ? Number.NaN : Math.log(v));
  return isSeries(x) ? seriesUnary("log", op, x) : scalarUnary(op, x);
}

export function log10(x: number): number;
export function log10(x: Series<number>): FloatSeries;
export function log10(x: Numeric): FloatSeries | number {
  const op = (v: number): number => (v <= 0 ? Number.NaN : Math.log10(v));
  return isSeries(x) ? seriesUnary("log10", op, x) : scalarUnary(op, x);
}

export function todegrees(x: number): number;
export function todegrees(x: Series<number>): FloatSeries;
export function todegrees(x: Numeric): FloatSeries | number {
  const op = (v: number): number => v * (180 / Math.PI);
  return isSeries(x) ? seriesUnary("todegrees", op, x) : scalarUnary(op, x);
}

export function toradians(x: number): number;
export function toradians(x: Series<number>): FloatSeries;
export function toradians(x: Numeric): FloatSeries | number {
  const op = (v: number): number => v * (Math.PI / 180);
  return isSeries(x) ? seriesUnary("toradians", op, x) : scalarUnary(op, x);
}

export function pow(base: Series<number>, exponent: Numeric): FloatSeries;
export function pow(base: Numeric, exponent: Series<number>): FloatSeries;
export function pow(base: number, exponent: number): number;
export function pow(base: Numeric, exponent: Numeric): FloatSeries | number {
  const op = (b: number, expVal: number): number => {
    if (b < 0 && !Number.isInteger(expVal)) return Number.NaN;
    return Math.pow(b, expVal);
  };
  return isSeries(base) || isSeries(exponent)
    ? seriesBinary("pow", op, base, exponent)
    : scalarBinary(op, base, exponent);
}

export function round(x: number, precision?: number): number;
export function round(x: Series<number>, precision?: number): FloatSeries;
export function round(x: Numeric, precision?: number): FloatSeries | number {
  const op = (val: number): number => {
    if (isNa(val)) return Number.NaN;
    if (precision === undefined || precision === 0) return Math.round(val);
    const factor = 10 ** precision;
    return Math.round(val * factor) / factor;
  };
  return isSeries(x) ? seriesUnary(`round_${precision ?? 0}`, op, x) : scalarUnary(op, x);
}

export function round_to_mintick(x: number, minTick?: number): number;
export function round_to_mintick(x: Series<number>, minTick?: number): FloatSeries;
export function round_to_mintick(x: Numeric, minTick?: number): FloatSeries | number {
  const op = (val: number): number => {
    if (isNa(val)) return Number.NaN;
    const resolvedTick = minTick ?? getCurrentSession()?.getSymbolInfo().minTick ?? 0.01;
    if (resolvedTick <= 0) return val;
    const raw = Math.round(val / resolvedTick) * resolvedTick;
    const decimals = (resolvedTick.toString().split(".")[1] ?? "").length;
    return Number(raw.toFixed(Math.min(decimals + 1, 10)));
  };
  const key = `round_to_mintick_${minTick ?? "auto"}`;
  return isSeries(x) ? seriesUnary(key, op, x) : scalarUnary(op, x);
}

export function max(...args: readonly [number, ...number[]]): number;
export function max(...args: readonly Numeric[]): FloatSeries | number;
export function max(...args: readonly Numeric[]): FloatSeries | number {
  const op = (nums: readonly number[]): number => Math.max(...nums);
  return args.some(isSeries)
    ? seriesVariadic("max", op, args)
    : scalarVariadic(op, args as readonly number[]);
}

export function min(...args: readonly [number, ...number[]]): number;
export function min(...args: readonly Numeric[]): FloatSeries | number;
export function min(...args: readonly Numeric[]): FloatSeries | number {
  const op = (nums: readonly number[]): number => Math.min(...nums);
  return args.some(isSeries)
    ? seriesVariadic("min", op, args)
    : scalarVariadic(op, args as readonly number[]);
}

export function avg(...args: readonly [number, ...number[]]): number;
export function avg(...args: readonly Numeric[]): FloatSeries | number;
export function avg(...args: readonly Numeric[]): FloatSeries | number {
  const op = (nums: readonly number[]): number => nums.reduce((acc, v) => acc + v, 0) / nums.length;
  return args.some(isSeries)
    ? seriesVariadic("avg", op, args)
    : scalarVariadic(op, args as readonly number[]);
}

export const random = (minVal = 0, maxVal = 1, seed?: number): number => {
  if (seed !== undefined) {
    const next = (seed * 1664525 + 1013904223) % 4294967296;
    const ratio = (next >>> 0) / 4294967296;
    return minVal + (maxVal - minVal) * ratio;
  }
  // Math.random is the intentional analytical PRNG specified by Pine Script v6.
  // eslint-disable-next-line sonarjs/pseudo-random
  return minVal + (maxVal - minVal) * Math.random();
};

export const sum = (source: Series<number>, length: number): FloatSeries => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
  const session = getSession(source);
  return session.nodes.getOrCreate(nodeKey("math.sum", source, length), () => {
    const def = {
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;
        return window.reduce((acc, item) => acc + item.value, 0);
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(session, new IndicatorNode(def));
  }) as FloatSeries;
};
