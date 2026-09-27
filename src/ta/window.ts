import { isNa } from "../core/na.js";
import type { Series } from "../core/series.js";

/**
 * Collected window entry: the value and the bar offset it was read from.
 * Offsets stay bar-accurate even when na bars are skipped, so offset-returning
 * built-ins (e.g. `ta.highestbars`) can report the true bar distance.
 */
export interface WindowValue {
  readonly value: number;
  readonly offset: number;
}

/**
 * Reads the values of the last `length` bars of `source` strictly: a na value
 * anywhere inside the window yields undefined, which callers surface as na.
 * Pine v6 documents this for built-ins whose remark reads "na values in the
 * source series are included in calculations and will produce an na result"
 * (e.g. `ta.percentile_linear_interpolation`, `ta.percentrank`). Missing
 * history before the first bar also yields undefined, so warm-up is covered.
 */
export const collectStrictWindow = (
  source: Series<number>,
  length: number,
): readonly number[] | undefined => {
  const values: number[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const value = source.at(offset);
    if (value === undefined || isNa(value)) return undefined;
    values.push(value);
  }
  return values;
};

/** A bar-aligned pair of non-na values read from two source series. */
export interface WindowPair {
  readonly left: number;
  readonly right: number;
}

/**
 * Reads the last `length` bars at which BOTH sources hold non-na values,
 * scanning back from the current bar — the paired-series extension of the
 * v6 "na values in the source series are ignored; the function calculates on
 * the length quantity of non-na values" convention (e.g. `ta.correlation`).
 * Bars where either side is na are skipped entirely so pairs stay
 * bar-aligned. Returns undefined when fewer than `length` pairs exist.
 */
export const collectNonNaPairWindow = (
  left: Series<number>,
  right: Series<number>,
  length: number,
): readonly WindowPair[] | undefined => {
  const window: WindowPair[] = [];
  let offset = 0;
  while (window.length < length) {
    const leftValue = left.at(offset);
    if (leftValue === undefined) return undefined;
    const rightValue = right.at(offset);
    if (rightValue === undefined) return undefined;
    if (!isNa(leftValue) && !isNa(rightValue)) {
      window.push({ left: leftValue, right: rightValue });
    }
    offset += 1;
  }
  return window;
};

/**
 * Reads the last `length` non-na values of `source`, starting at the current
 * bar and scanning back. Pine v6 windowed built-ins document this behavior as
 * "na values in the source series are ignored; the function calculates on the
 * length quantity of non-na values". The scan stops at the beginning of the
 * data — values before the first bar are missing history, not na values, so
 * they cannot extend the window.
 *
 * Returns undefined when fewer than `length` non-na values exist, which every
 * caller surfaces as na (the Pine warm-up behavior).
 */
export const collectNonNaWindow = (
  source: Series<number>,
  length: number,
): readonly WindowValue[] | undefined => {
  const window: WindowValue[] = [];
  let offset = 0;
  while (window.length < length) {
    const value = source.at(offset);
    // `undefined` means the offset reaches before the first bar; NaN is a
    // committed na value on an existing bar and is skipped.
    if (value === undefined) return undefined;
    if (isNa(value)) {
      offset += 1;
      continue;
    }
    window.push({ value, offset });
    offset += 1;
  }
  return window;
};
