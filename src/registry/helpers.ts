/**
 * Indicator-runtime helpers — resolving the `"source"` input selector
 * (`"close"`, `"open"`, `"high"`, `"low"`, `"hl2"`, `"hlc3"`, `"ohlc4"`)
 * against the bar context, so an indicator author writes
 * `ta.rsi(resolveSource(ctx, inputs.source), inputs.length)` without
 * branching on the selector.
 */

import type { FloatSeries } from "../core/series.js";
import type { PineContext } from "../core/context.js";

/** The Pine v6 source series selectable via the `"source"` input kind. */
export type SourceSelector = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4";

/** The list of valid source selectors (for `input.options` defaults). */
export const SOURCE_SELECTORS: readonly SourceSelector[] = [
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
];

/**
 * Resolves a source selector string against the bar context.
 * Throws `RangeError` for an unknown selector (a typo in the indicator
 * spec or user override).
 */
export const resolveSource = (ctx: PineContext, selector: string): FloatSeries => {
  switch (selector) {
    case "open":
      return ctx.open;
    case "high":
      return ctx.high;
    case "low":
      return ctx.low;
    case "close":
      return ctx.close;
    case "hl2":
      return ctx.hl2;
    case "hlc3":
      return ctx.hlc3;
    case "ohlc4":
      return ctx.ohlc4;
    default:
      throw new RangeError(
        `Unknown source selector: ${JSON.stringify(selector)}. ` +
          `Valid: open, high, low, close, hl2, hlc3, ohlc4.`,
      );
  }
};

/**
 * Reads a `number` input from the resolved inputs bag with a type check.
 * Throws `TypeError` if the value is not a finite number.
 */
export const readNumber = (inputs: Record<string, unknown>, name: string): number => {
  const value = inputs[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(
      `Input ${JSON.stringify(name)} must be a finite number; got ${String(value)}`,
    );
  }
  return value;
};

/**
 * Reads a `boolean` input from the resolved inputs bag with a type check.
 */
export const readBoolean = (inputs: Record<string, unknown>, name: string): boolean => {
  const value = inputs[name];
  if (typeof value !== "boolean") {
    throw new TypeError(`Input ${JSON.stringify(name)} must be a boolean; got ${String(value)}`);
  }
  return value;
};

/**
 * Reads a `string` input from the resolved inputs bag with a type check.
 */
export const readString = (inputs: Record<string, unknown>, name: string): string => {
  const value = inputs[name];
  if (typeof value !== "string") {
    throw new TypeError(`Input ${JSON.stringify(name)} must be a string; got ${String(value)}`);
  }
  return value;
};
