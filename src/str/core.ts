/**
 * Pine string values carry `na`; pine-ts encodes a na string as `undefined`,
 * the same way `Series.at` reports missing history. Scalar `str.*` built-ins
 * accept and propagate it unless the reference documents otherwise
 * (`str.trim` maps na to `""`, `str.tostring` maps na to `"NaN"`).
 */
import { PineArray } from "../array/pine-array.js";

export type PineString = string | undefined;

/** str.contains — true if the source string contains the str substring, false otherwise; na source yields na. */
export const contains = (source: PineString, search: string): boolean | undefined =>
  source === undefined ? undefined : source.includes(search);

/** str.endswith — true if the source string ends with the substring specified in str; na source yields na. */
export const endswith = (source: PineString, search: string): boolean | undefined =>
  source === undefined ? undefined : source.endsWith(search);

/** str.startswith — true if the source string starts with the substring specified in str; na source yields na. */
export const startswith = (source: PineString, search: string): boolean | undefined =>
  source === undefined ? undefined : source.startsWith(search);

/** str.length — the amount of chars in the string; na source yields na. */
export const length = (source: PineString): number | undefined => source?.length;

/** str.lower — a new string with all letters converted to lowercase; na source yields na. */
export const lower = (source: PineString): PineString =>
  source === undefined ? undefined : source.toLowerCase();

/** str.upper — a new string with all letters converted to uppercase; na source yields na. */
export const upper = (source: PineString): PineString =>
  source === undefined ? undefined : source.toUpperCase();

const TRIMMABLE_CHARACTER = /[\s\p{Cc}]/u;

/**
 * str.trim — a new string with all consecutive whitespaces and other control
 * characters removed from the left and right of the source. Per the v6
 * remark, a na source (or a fully trimmed-away result) yields `""`.
 */
export const trim = (source: PineString): string => {
  if (source === undefined) return "";
  let start = 0;
  let end = source.length;
  while (start < end && TRIMMABLE_CHARACTER.test(source[start]!)) start += 1;
  while (end > start && TRIMMABLE_CHARACTER.test(source[end - 1]!)) end -= 1;
  return source.slice(start, end);
};

/**
 * str.pos — position of the first occurrence of str in the source string, na
 * otherwise. String indexing starts at 0.
 */
export const pos = (source: PineString, search: string): number | undefined => {
  if (source === undefined) return undefined;
  const index = source.indexOf(search);
  return index === -1 ? undefined : index;
};

/**
 * str.repeat — a new string containing the source repeated `repeat` times
 * with the separator injected between each repeated instance. Per the v6
 * remark, a na source yields na; `repeat` must be a non-negative integer.
 */
export const repeat = (source: PineString, times: number, separator = ""): PineString => {
  if (source === undefined) return undefined;
  if (!Number.isInteger(times) || times < 0) {
    throw new RangeError("str.repeat requires a non-negative integer repeat count");
  }
  if (times === 0) return "";
  return Array.from<string>({ length: times })
    .map(() => source)
    .join(separator);
};

const replaceNthOccurrence = (
  source: string,
  target: string,
  replacement: string,
  occurrence: number,
): string => {
  // An empty target has no well-defined occurrence; treat it as a no-op.
  if (target === "") return source;
  let from = 0;
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = source.indexOf(target, from);
    if (index === -1) return source;
    from = index + target.length;
  }
  return source.slice(0, index) + replacement + source.slice(index + target.length);
};

/**
 * str.replace — a new string with the Nth occurrence of the target replaced
 * by the replacement string, where N is `occurrence` (indexing starts at 0).
 * Fewer occurrences than requested leave the source unchanged; a na source
 * yields na.
 */
export const replace = (
  source: PineString,
  target: string,
  replacement: string,
  occurrence = 0,
): PineString => {
  if (source === undefined) return undefined;
  if (!Number.isInteger(occurrence) || occurrence < 0) {
    throw new RangeError("str.replace requires a non-negative integer occurrence index");
  }
  return replaceNthOccurrence(source, target, replacement, occurrence);
};

/**
 * str.replace_all — replaces each occurrence of the target string in the
 * source string with the replacement string; a na source yields na.
 */
export const replaceAll = (source: PineString, target: string, replacement: string): PineString => {
  if (source === undefined) return undefined;
  if (target === "") return source;
  return source.split(target).join(replacement);
};

/**
 * str.substring — a new string that is a substring of the source. The
 * substring begins with the character at `beginPos` (inclusive) and extends
 * to `endPos - 1` (exclusive, defaulting to the source length). Out-of-range
 * positions are a runtime error, matching the Java-derived strictness of
 * Pine's string built-ins; `beginPos === endPos` yields the empty string.
 */
export const substring = (source: PineString, beginPos: number, endPos?: number): PineString => {
  if (source === undefined) return undefined;
  const end = endPos ?? source.length;
  if (!Number.isInteger(beginPos) || !Number.isInteger(end)) {
    throw new RangeError("str.substring positions must be integers");
  }
  if (beginPos < 0 || beginPos > source.length || end < beginPos || end > source.length) {
    throw new RangeError(
      `str.substring positions are out of range: [${beginPos}, ${end}) for length ${source.length}`,
    );
  }
  return source.slice(beginPos, end);
};

/**
 * str.match — the first substring of the source matching the regular
 * expression, an empty string otherwise (v6 remark: "Function returns first
 * occurrence of the regular expression in the source string"). A na source
 * yields na. Regex literals follow the ECMAScript grammar; Pine's runtime
 * uses the Java flavor, so exotic constructs may differ until oracle
 * verification lands.
 */
export const match = (source: PineString, regex: string): PineString => {
  if (source === undefined) return undefined;
  const found = new RegExp(regex).exec(source);
  return found === null ? "" : found[0];
};

const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * str.tonumber — the "float" equivalent of the value in string, or na when
 * the value is not a properly formed integer or floating point value.
 * pine-ts spells numeric na as NaN. Only plain decimal and scientific
 * notation parse; whitespace, hex, Infinity and NaN do not.
 */
export const tonumber = (source: PineString): number =>
  source !== undefined && STRICT_NUMBER_PATTERN.test(source) ? Number(source) : Number.NaN;

/**
 * str.split — divides a string into an array of substrings. A na source or
 * na separator yields na; an empty separator yields the source as a single
 * element (pine-ts decision: no Java-style character fission); trailing
 * empty fields are preserved, matching JavaScript split semantics.
 */
export const split = (
  source: PineString,
  separator: PineString,
): PineArray<string> | undefined => {
  if (source === undefined || separator === undefined) return undefined;
  if (separator === "") return PineArray.createRoot<string>([source]);
  return PineArray.createRoot<string>(source.split(separator));
};
