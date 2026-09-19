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
