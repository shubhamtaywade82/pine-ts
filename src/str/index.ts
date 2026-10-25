/**
 * Pine Script v6 `str.*` namespace — string manipulation functions.
 *
 * Pure functions over `string` values. `na` (Pine's null string) is
 * represented as `undefined`; passing `undefined` through any str.* function
 * yields `undefined`, matching Pine's null-propagation behaviour for the
 * family. Mirrors the TradingView v6 Reference Manual signatures.
 */

/**
 * `str.contains(source, str)`. True when `str` appears anywhere inside
 * `source`. Either argument na → na.
 */
export const contains = (
  source: string | undefined,
  str: string | undefined,
): boolean | undefined => {
  if (source === undefined || str === undefined) return undefined;
  return source.includes(str);
};

/**
 * `str.endswith(source, str)`. True when `source` ends with `str`.
 */
export const endswith = (
  source: string | undefined,
  str: string | undefined,
): boolean | undefined => {
  if (source === undefined || str === undefined) return undefined;
  return source.endsWith(str);
};

/**
 * `str.startswith(source, str)`. True when `source` starts with `str`.
 */
export const startswith = (
  source: string | undefined,
  str: string | undefined,
): boolean | undefined => {
  if (source === undefined || str === undefined) return undefined;
  return source.startsWith(str);
};

/**
 * `str.length(source)`. The number of UTF-16 code units in `source` (Pine's
 * documented definition). `na` source → `na`.
 */
export const length = (source: string | undefined): number | undefined => {
  if (source === undefined) return undefined;
  return source.length;
};

/**
 * `str.lower(source)`. Lowercased copy of `source`. `na` source → `na`.
 */
export const lower = (source: string | undefined): string | undefined =>
  source === undefined ? undefined : source.toLowerCase();

/**
 * `str.upper(source)`. Uppercased copy of `source`.
 */
export const upper = (source: string | undefined): string | undefined =>
  source === undefined ? undefined : source.toUpperCase();

/**
 * `str.trim(source)`. `source` with leading and trailing whitespace removed.
 */
export const trim = (source: string | undefined): string | undefined =>
  source === undefined ? undefined : source.trim();

/**
 * `str.trimleft(source)`. `source` with leading whitespace removed.
 */
export const trimleft = (source: string | undefined): string | undefined =>
  source === undefined ? undefined : source.trimStart();

/**
 * `str.trimright(source)`. `source` with trailing whitespace removed.
 */
export const trimright = (source: string | undefined): string | undefined =>
  source === undefined ? undefined : source.trimEnd();

/**
 * `str.substring(source, begin_pos, end_pos?)`. Returns the substring of
 * `source` starting at `begin_pos` (inclusive) and ending at `end_pos`
 * (exclusive). If `end_pos` is omitted, returns the rest of the string. Pine
 * uses 0-based indices; negative indices are clamped to 0.
 */
export const substring = (
  source: string | undefined,
  beginPos: number,
  endPos?: number,
): string | undefined => {
  if (source === undefined) return undefined;
  const start = Math.max(0, Math.floor(beginPos));
  if (start >= source.length) return "";
  if (endPos === undefined) return source.slice(start);
  const end = Math.max(start, Math.floor(endPos));
  return source.slice(start, end);
};

/**
 * `str.pos(source, str)`. Returns the 0-based index of the first occurrence
 * of `str` in `source`, or -1 when `str` is not found.
 */
export const pos = (source: string | undefined, str: string | undefined): number | undefined => {
  if (source === undefined || str === undefined) return undefined;
  return source.indexOf(str);
};

/**
 * `str.replace(source, target, replacement, occurrence?)`. Replaces
 * `occurrence` instances of `target` in `source` with `replacement`.
 * `occurrence` defaults to -1 (all occurrences), matching Pine's default.
 */
export const replace = (
  source: string | undefined,
  target: string | undefined,
  replacement: string | undefined,
  occurrence = -1,
): string | undefined => {
  if (source === undefined || target === undefined || replacement === undefined) return undefined;
  if (target === "") return source;
  if (occurrence === -1) return source.split(target).join(replacement);
  let result = source;
  let count = 0;
  let index = result.indexOf(target);
  while (index !== -1 && count < occurrence) {
    result = result.slice(0, index) + replacement + result.slice(index + target.length);
    count += 1;
    index = result.indexOf(target, index + replacement.length);
  }
  return result;
};

/**
 * `str.replace_all(source, target, replacement)`. Replaces every occurrence
 * of `target` in `source` with `replacement`.
 */
export const replace_all = (
  source: string | undefined,
  target: string | undefined,
  replacement: string | undefined,
): string | undefined => {
  if (source === undefined || target === undefined || replacement === undefined) return undefined;
  if (target === "") return source;
  return source.split(target).join(replacement);
};

/**
 * `str.split(source, separator)`. Splits `source` on every occurrence of
 * `separator` and returns the resulting array of substrings. An empty
 * `separator` splits into individual UTF-16 code units, matching Pine's
 * documented behaviour.
 */
export const split = (
  source: string | undefined,
  separator: string | undefined,
): readonly string[] | undefined => {
  if (source === undefined || separator === undefined) return undefined;
  if (separator === "") return Array.from(source);
  return source.split(separator);
};

/**
 * `str.tostring(value, format?)`. String representation of `value`. With no
 * format string, numbers stringify via Pine's default formatting (decimal
 * with up to ~6 significant digits). The `format` parameter accepts
 * `format.*`-style specifiers (e.g. `#.##`, `0.00`, `0%`); this initial
 * implementation supports the common cases: leading-zero padded decimals,
 * hash-padded decimals, and integer formatting. A `na` value returns `"NaN"`.
 */
export const tostring = (
  value: number | string | undefined,
  format?: string,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  if (format === undefined) return String(value);
  return formatNumber(value, format);
};

/**
 * `str.format(source, args)`. ICU-MessageFormat-style string substitution.
 * Supports `{0}`, `{1}` positional placeholders and the simplest argument
 * formatting (`{0,number,#.##}`, `{0,number,0.00}`). This is a Pine v6
 * re-implementation that covers the documented common patterns; full ICU
 * compliance is not pursued. `na` source → `na`.
 */
export const format = (
  source: string | undefined,
  ...args: readonly (number | string | undefined)[]
): string | undefined => {
  if (source === undefined) return undefined;
  return source.replace(/\{(\d+)(?:,([^}]+))?\}/g, (match, index: string, spec?: string) => {
    const i = Number(index);
    const value = args[i];
    if (value === undefined) return match;
    if (typeof value === "string") return value;
    if (spec === undefined) return String(value);
    // spec like "number,#.##" or "number,0.00"
    const parts = spec.split(",");
    const formatSpec = parts[1];
    return formatSpec === undefined ? String(value) : formatNumber(value, formatSpec);
  });
};

/**
 * `str.match(source, regex)`. Matches `regex` (a string regular expression)
 * against `source` and returns the matched substring, or `na` when no match
 * is found. Pine v6 documents ECMA-262 regular-expression syntax.
 */
export const match = (
  source: string | undefined,
  regex: string | undefined,
): string | undefined => {
  if (source === undefined || regex === undefined) return undefined;
  const re = new RegExp(regex);
  const result = re.exec(source);
  return result === null ? undefined : (result[0] ?? "");
};

// ---------- internal helpers ----------

/**
 * Formats a number per a Pine `format.*`-style specifier. Supports the
 * documented common patterns:
 * - `0` integer (no decimals);
 * - `0.00`, `0.0##` zero-padded decimals;
 * - `#.##`, `#.00` hash-padded decimals;
 * - `0%` percent (multiplied by 100 with the rest as a number format);
 * - `#` no decimal places, integer.
 */
const formatNumber = (value: number, format: string): string => {
  if (format === "") return String(value);
  // Percent: strip trailing %, multiply by 100, format the remainder.
  if (format.endsWith("%")) {
    const inner = format.slice(0, -1);
    return `${formatNumber(value * 100, inner === "" ? "#" : inner)}%`;
  }
  // Split into integer-part and decimal-part specifiers.
  const dotIndex = format.indexOf(".");
  if (dotIndex === -1) {
    // Integer-only format; round to integer.
    const digits = format.replace(/[^0]/g, "").length;
    if (digits === 0) return String(Math.round(value));
    return padLeft(String(Math.round(value)), digits, "0");
  }
  const intSpec = format.slice(0, dotIndex);
  const decSpec = format.slice(dotIndex + 1);
  const intDigits = intSpec.replace(/[^0]/g, "").length;
  const decFixed = (decSpec.match(/0/g) ?? []).length;
  const decOptional = (decSpec.match(/#/g) ?? []).length;
  const totalDec = decFixed + decOptional;
  const rounded = Number(value.toFixed(totalDec));
  const [intPartRaw, decPartRaw] = rounded.toFixed(totalDec).split(".");
  const intPart = intDigits > 0 ? padLeft(intPartRaw ?? "0", intDigits, "0") : (intPartRaw ?? "0");
  let decPart = decPartRaw ?? "";
  // Truncate trailing zeros beyond `decFixed` (optional # placeholders).
  if (decOptional > 0) {
    let lastSig = decPart.length;
    while (lastSig > decFixed && decPart[lastSig - 1] === "0") lastSig -= 1;
    decPart = decPart.slice(0, lastSig);
  }
  if (decPart === "") return intPart;
  return `${intPart}.${decPart}`;
};

const padLeft = (s: string, length: number, char: string): string => {
  if (s.length >= length) return s;
  return char.repeat(length - s.length) + s;
};
