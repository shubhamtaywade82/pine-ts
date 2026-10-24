/**
 * Pine Script v6 `input.*` namespace — typed parameter binding.
 *
 * In TradingView Pine, `input.*` functions declare user-configurable script
 * parameters that surface in the script's settings UI. In a TypeScript
 * runtime, there is no UI; the functions therefore reduce to typed
 * parameter declarations with defaults, validation (`minval`/`maxval`/
 * `options`), and optional metadata that a host application can read for its
 * own UI. Each function returns the resolved value (the default unless
 * overridden by a runtime parameter provider).
 *
 * The namespace exposes a single `InputBindings` interface that the host
 * passes through `PineRuntime`'s options. When no bindings are supplied,
 * every input resolves to its declared default.
 */

import { isNa } from "../core/na.js";
import type { Color } from "../color/index.js";

/** A descriptive label / metadata for a bound input (no UI side effect). */
export interface InputMetadata {
  readonly key: string;
  readonly title: string;
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  /** The type-erased default value (the value used when no binding is set). */
  readonly defval: unknown;
}

/**
 * A registry of bindings that the host application passes to the runtime.
 * Keys are the `key` strings passed to each `input.*` call. When a key is
 * missing, the input function falls back to its declared default.
 */
export type InputBindings = Readonly<Record<string, unknown>>;

let activeBindings: InputBindings = {};
const seen = new Map<string, InputMetadata>();

/**
 * Sets the active input bindings for the current runtime invocation. The
 * runtime calls this once per script execution with the host-supplied map;
 * any input.* call inside the script reads from it.
 */
export const setActiveBindings = (bindings: InputBindings): void => {
  activeBindings = bindings;
};

/** Returns the metadata for every input.* call seen so far in this script. */
export const seenInputs = (): readonly InputMetadata[] => [...seen.values()];

/**
 * Reads a bound value or falls back to the default, then registers the
 * metadata for the call.
 */
const resolve = <T>(meta: InputMetadata, defval: T): T => {
  seen.set(meta.key, meta);
  if (activeBindings[meta.key] !== undefined) {
    const bound = activeBindings[meta.key] as T;
    return bound;
  }
  return defval;
};

export interface IntegerInputOptions {
  readonly minval?: number;
  readonly maxval?: number;
  readonly step?: number;
  readonly confirm?: boolean;
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.int(defval, title?, minval?, maxval?, ...)`. Binds an integer
 * parameter. Range validation runs when `minval`/`maxval` are supplied; an
 * out-of-range bound value clamps into range, matching Pine v6's clamping
 * behaviour.
 */
export const int = (
  defval: number,
  title = "",
  options: IntegerInputOptions = {},
): number => {
  const key = options.inline ?? title;
  const value = resolve({ key, title, ...options, defval }, defval);
  if (!Number.isInteger(value)) {
    throw new Error(`input.int(${key}) expected an integer, got ${value}`);
  }
  const min = options.minval ?? Number.NEGATIVE_INFINITY;
  const max = options.maxval ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, value));
};

export interface FloatInputOptions {
  readonly minval?: number;
  readonly maxval?: number;
  readonly step?: number;
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.float(defval, title?, minval?, maxval?, ...)`. Binds a float
 * parameter with the same clamping behaviour as `input.int`.
 */
export const float = (defval: number, title = "", options: FloatInputOptions = {}): number => {
  const key = options.inline ?? title;
  const value = resolve({ key, title, ...options, defval }, defval);
  if (!Number.isFinite(value)) {
    throw new Error(`input.float(${key}) expected a finite number, got ${value}`);
  }
  const min = options.minval ?? Number.NEGATIVE_INFINITY;
  const max = options.maxval ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, value));
};

export interface BoolInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.bool(defval, title?, ...)`. Binds a boolean parameter.
 */
export const bool = (defval: boolean, title = "", options: BoolInputOptions = {}): boolean => {
  const key = options.inline ?? title;
  const value = resolve({ key, title, ...options, defval }, defval);
  return Boolean(value);
};

export interface StringInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
  readonly options?: readonly string[];
}

/**
 * `input.string(defval, title?, options?)`. Binds a string parameter. When
 * `options.options` is supplied, the bound value must be one of them;
 * otherwise it falls back to `defval`.
 */
export const string = (
  defval: string,
  title = "",
  options: StringInputOptions = {},
): string => {
  const key = options.inline ?? title;
  const value = resolve({ key, title, ...options, defval }, defval);
  if (options.options !== undefined && !options.options.includes(value)) {
    return defval;
  }
  return value;
};

export interface ColorInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.color(defval, title?, ...)`. Binds a `color` parameter.
 */
export const color = (
  defval: Color,
  title = "",
  options: ColorInputOptions = {},
): Color => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface SourceInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.source(defval, title?)`. Binds a series source. The default is a
 * `series float` value (`close`); the host can bind a different series
 * reference. Returns the resolved `defval` if no binding is set.
 */
export const source = <T>(defval: T, title = "", options: SourceInputOptions = {}): T => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface TimeframeInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
  readonly options?: readonly string[];
}

/**
 * `input.timeframe(defval, title?, ...)`. Binds a timeframe string. The
 * value is not validated against the timeframe parser here; the runtime
 * validates when the value is consumed by `request.security`.
 */
export const timeframe = (
  defval: string,
  title = "",
  options: TimeframeInputOptions = {},
): string => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface SessionInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.session(defval, title?, ...)`. Binds a session string (Pine's
 * `"0930-1600"` or `"0930-1600:UTC"` format).
 */
export const session = (
  defval: string,
  title = "",
  options: SessionInputOptions = {},
): string => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface SymbolInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.symbol(defval, title?, ...)`. Binds a symbol/ticker string.
 */
export const symbol = (
  defval: string,
  title = "",
  options: SymbolInputOptions = {},
): string => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface IntervalInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.interval(defval, title?, ...)`. Binds an interval value (in
 * seconds). Pine v6 type is `int`.
 */
export const interval = (
  defval: number,
  title = "",
  options: IntervalInputOptions = {},
): number => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface PriceInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
}

/**
 * `input.price(defval, title?, ...)`. Binds a price-style float parameter.
 */
export const price = (defval: number, title = "", options: PriceInputOptions = {}): number => {
  const key = options.inline ?? title;
  return resolve({ key, title, ...options, defval }, defval);
};

export interface QtyInputOptions {
  readonly group?: string;
  readonly tooltip?: string;
  readonly inline?: string;
  readonly title?: string;
  readonly minval?: number;
}

/**
 * `input.qty(defval, title?, ...)`. Binds a quantity-style float parameter.
 */
export const qty = (defval: number, title = "", options: QtyInputOptions = {}): number => {
  const key = options.inline ?? title;
  const value = resolve({ key, title, ...options, defval }, defval);
  const min = options.minval ?? 0;
  return Math.max(min, value);
};

/**
 * `input(...)`. The polymorphic overload. Dispatches on the runtime type of
 * `defval` to one of `int`/`float`/`bool`/`string`/`color`/`source`.
 */
export const input = <T>(defval: T, title = "", options: Record<string, unknown> = {}): T => {
  const key = (options["inline"] as string | undefined) ?? title;
  return resolve({ key, title, defval }, defval);
};

// Re-export the `nz`/`isNa` helpers for input defaulting utilities.
export { isNa };
