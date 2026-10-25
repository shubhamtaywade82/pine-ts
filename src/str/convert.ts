/**
 * Pine Script v6 `str.*` conversion helpers.
 *
 * Kept separate from `index.ts` so the namespace module stays within the
 * project's file-size limit.
 */

type PineString = string | undefined;

const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * `str.tonumber(source)`. Parses plain decimal or scientific notation and
 * returns `NaN` (Pine's numeric `na`) for anything else. Whitespace, hex,
 * `Infinity`, and `NaN` are rejected, matching the v6 remark.
 */
export const tonumber = (source: PineString): number =>
  source !== undefined && STRICT_NUMBER_PATTERN.test(source) ? Number(source) : Number.NaN;

/**
 * `str.repeat(source, repeat, separator)`. Repeats `source` `repeat` times
 * with `separator` between copies; `na` source yields `na`. The count must be
 * a non-negative integer.
 */
export const repeat = (source: PineString, times: number, separator = ""): PineString => {
  if (source === undefined) return undefined;
  if (!Number.isInteger(times) || times < 0) {
    throw new RangeError("str.repeat requires a non-negative integer repeat count");
  }
  return Array.from({ length: times }, () => source).join(separator);
};
