import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import type { PineSession } from "../core/session.js";
import { FloatSeries, type Series } from "../core/series.js";

/**
 * A scalar or series operand accepted by the elementwise `math.*` built-ins.
 * Pine types every parameter as `const int/float … series int/float`; pine-ts
 * mirrors that with `number | Series<number>` and evaluates elementwise when
 * any operand is a series.
 */
export type MathOperand = number | Series<number>;

const isSeriesOperand = (value: MathOperand): value is Series<number> => typeof value === "object";

const requireCompatibleRuntime = (operands: readonly Series<number>[]): PineSession => {
  const first = operands[0];
  if (first?.runtime === undefined) {
    throw new Error("Math series operands require PineSession-owned source series");
  }
  const runtime = first.runtime;
  if (operands.some((operand) => operand.runtime !== runtime)) {
    throw new Error("Math series operands must belong to the same PineSession");
  }
  return runtime;
};

/**
 * Reads a series operand's current value as a Pine float: missing history
 * (before the first bar) reads as `na` (NaN), the same convention
 * `FloatSeries.current` uses.
 */
const readOperand = (operand: Series<number>): number => operand.at(0) ?? Number.NaN;

/**
 * Series-side engine of the pointwise built-ins: builds a memoized node
 * reading every operand's current bar, keyed on the operand identities (and
 * any scalar operands) so repeated calls reuse the same series across a
 * revision.
 */
const pointwiseSeries = (
  key: string,
  operands: readonly MathOperand[],
  combine: (values: readonly number[]) => number,
): FloatSeries => {
  const runtime = requireCompatibleRuntime(operands.filter(isSeriesOperand));
  const evaluate = (): number =>
    combine(operands.map((operand) => (isSeriesOperand(operand) ? readOperand(operand) : operand)));

  return runtime.nodes.getOrCreate(nodeKey(key, ...operands), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => evaluate(),
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};

/**
 * Shared pointwise engine: all-scalar operands evaluate immediately; any
 * series operand produces a memoized elementwise node.
 */
const applyPointwise = (
  key: string,
  operands: readonly MathOperand[],
  combine: (values: readonly number[]) => number,
): number | FloatSeries =>
  operands.some(isSeriesOperand)
    ? pointwiseSeries(key, operands, combine)
    : combine(operands as readonly number[]);

/** math.abs — absolute value of number (`number if number >= 0, or -number otherwise`). na propagates. */
export function abs(value: number): number;
export function abs(value: Series<number>): FloatSeries;
export function abs(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.abs", [value], ([x = Number.NaN]) => Math.abs(x));
}

/** math.acos — arccosine in radians, in the range [0, Pi]; na when the argument is outside [-1, 1]. */
export function acos(value: number): number;
export function acos(value: Series<number>): FloatSeries;
export function acos(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.acos", [value], ([x = Number.NaN]) => Math.acos(x));
}

/** math.asin — arcsine in radians, in the range [-Pi/2, Pi/2]; na when the argument is outside [-1, 1]. */
export function asin(value: number): number;
export function asin(value: Series<number>): FloatSeries;
export function asin(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.asin", [value], ([x = Number.NaN]) => Math.asin(x));
}

/** math.atan — arctangent in radians, in the range [-Pi/2, Pi/2]. */
export function atan(value: number): number;
export function atan(value: Series<number>): FloatSeries;
export function atan(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.atan", [value], ([x = Number.NaN]) => Math.atan(x));
}

/** math.ceil — rounds the specified number up to the smallest whole number that is greater than or equal to it. */
export function ceil(value: number): number;
export function ceil(value: Series<number>): FloatSeries;
export function ceil(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.ceil", [value], ([x = Number.NaN]) => Math.ceil(x));
}

/** math.cos — trigonometric cosine of an angle in radians. */
export function cos(angle: number): number;
export function cos(angle: Series<number>): FloatSeries;
export function cos(angle: MathOperand): number | FloatSeries {
  return applyPointwise("math.cos", [angle], ([x = Number.NaN]) => Math.cos(x));
}

/** math.exp — e raised to the power of number. */
export function exp(value: number): number;
export function exp(value: Series<number>): FloatSeries;
export function exp(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.exp", [value], ([x = Number.NaN]) => Math.exp(x));
}

/** math.floor — rounds the specified number down to the largest whole number that is less than or equal to it. */
export function floor(value: number): number;
export function floor(value: Series<number>): FloatSeries;
export function floor(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.floor", [value], ([x = Number.NaN]) => Math.floor(x));
}

/** math.log — natural logarithm; na for numbers <= 0. */
export function log(value: number): number;
export function log(value: Series<number>): FloatSeries;
export function log(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.log", [value], ([x = Number.NaN]) => Math.log(x));
}

/** math.log10 — common (base 10) logarithm; na for numbers <= 0. */
export function log10(value: number): number;
export function log10(value: Series<number>): FloatSeries;
export function log10(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.log10", [value], ([x = Number.NaN]) => Math.log10(x));
}

/** math.pow — base raised to the power of exponent, elementwise when either operand is a series. */
export function pow(base: number, exponent: number): number;
export function pow(base: Series<number>, exponent: MathOperand): FloatSeries;
export function pow(base: number, exponent: Series<number>): FloatSeries;
export function pow(base: MathOperand, exponent: MathOperand): number | FloatSeries;
export function pow(base: MathOperand, exponent: MathOperand): number | FloatSeries {
  return applyPointwise("math.pow", [base, exponent], ([b = Number.NaN, e = Number.NaN]) => b ** e);
}

/**
 * Rounds `value` to `digits` decimal places with ties rounding up, the exact
 * arithmetic the Pine runtime performs (`number * 10^digits`, half-up, divide).
 * `digits` may be negative to round to tens, hundreds, …
 */
const roundToDigits = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * math.round — value rounded to the nearest integer, with ties rounding up;
 * with `precision`, a float rounded to that many decimal places. na
 * propagates (v6 remark: "Note that for 'na' values function returns 'na'").
 */
export function round(value: number, precision?: number): number;
export function round(value: Series<number>, precision?: number): FloatSeries;
export function round(value: MathOperand, precision?: number): number | FloatSeries {
  const digits = precision ?? 0;
  if (!Number.isInteger(digits)) {
    throw new RangeError("math.round precision must be an integer");
  }
  // The node key carries the digits so different precisions never share a node.
  return applyPointwise("math.round", [value, digits], ([x = Number.NaN]) =>
    roundToDigits(x, digits),
  );
}

/** math.sign — sign (signum) of number: zero for zero, 1.0 for positive, -1.0 for negative. */
export function sign(value: number): number;
export function sign(value: Series<number>): FloatSeries;
export function sign(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.sign", [value], ([x = Number.NaN]) => Math.sign(x));
}

/** math.sin — trigonometric sine of an angle in radians. */
export function sin(angle: number): number;
export function sin(angle: Series<number>): FloatSeries;
export function sin(angle: MathOperand): number | FloatSeries {
  return applyPointwise("math.sin", [angle], ([x = Number.NaN]) => Math.sin(x));
}

/** math.sqrt — square root; na for negative numbers. */
export function sqrt(value: number): number;
export function sqrt(value: Series<number>): FloatSeries;
export function sqrt(value: MathOperand): number | FloatSeries {
  return applyPointwise("math.sqrt", [value], ([x = Number.NaN]) => Math.sqrt(x));
}

/** math.tan — trigonometric tangent of an angle in radians. */
export function tan(angle: number): number;
export function tan(angle: Series<number>): FloatSeries;
export function tan(angle: MathOperand): number | FloatSeries {
  return applyPointwise("math.tan", [angle], ([x = Number.NaN]) => Math.tan(x));
}

/** math.todegrees — angle in degrees from an angle measured in radians. */
export function todegrees(radians: number): number;
export function todegrees(radians: Series<number>): FloatSeries;
export function todegrees(radians: MathOperand): number | FloatSeries {
  return applyPointwise("math.todegrees", [radians], ([x = Number.NaN]) => (x * 180) / Math.PI);
}

/** math.toradians — angle in radians from an angle measured in degrees. */
export function toradians(degrees: number): number;
export function toradians(degrees: Series<number>): FloatSeries;
export function toradians(degrees: MathOperand): number | FloatSeries {
  return applyPointwise("math.toradians", [degrees], ([x = Number.NaN]) => (x * Math.PI) / 180);
}
