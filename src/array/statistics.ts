import { isNa } from "../core/na.js";
import { PineArray } from "./pine-array.js";

/**
 * Collects the non-`na` numeric elements of an array window. The v6 Arrays
 * page pins the rule for every calculation built-in: they "do not return na
 * when some of the values they calculate on have na values" — `na` elements
 * are skipped — and they return `na` only when the array is empty or every
 * element is `na`.
 */
const collectNonNa = (id: PineArray<number>): number[] => {
  const values: number[] = [];
  for (const element of id.toArray()) {
    if (!isNa(element)) values.push(element);
  }
  return values;
};

/** `na` when the skip-`na` reduction left nothing to compute. */
const emptyResult = Number.NaN;

/** v6 `array.avg(id)` — mean of the non-`na` elements. */
export const avg = (id: PineArray<number>): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

/** v6 `array.sum(id)` — sum of the non-`na` elements. */
export const sum = (id: PineArray<number>): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  return values.reduce((total, value) => total + value, 0);
};

/** v6 `array.max(id, nth)` — the `nth` greatest value (0 = greatest). */
export const max = (id: PineArray<number>, nth = 0): number => {
  const values = collectNonNa(id);
  if (nth < 0 || nth >= values.length) return emptyResult;
  const sorted = [...values].sort((left, right) => right - left);
  return sorted[nth]!;
};

/** v6 `array.min(id, nth)` — the `nth` smallest value (0 = smallest). */
export const min = (id: PineArray<number>, nth = 0): number => {
  const values = collectNonNa(id);
  if (nth < 0 || nth >= values.length) return emptyResult;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[nth]!;
};

/** v6 `array.range(id)` — the difference between the max and min values. */
export const range = (id: PineArray<number>): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  for (const value of values) {
    highest = Math.max(highest, value);
    lowest = Math.min(lowest, value);
  }
  return highest - lowest;
};

/** v6 `array.median(id)` — the middle value of the sorted non-`na` elements. */
export const median = (id: PineArray<number>): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * v6 `array.mode(id)` — the most frequently occurring value, with ties
 * resolved to the smallest value (the reference's "if none exists, returns
 * the smallest value instead"), mirroring `ta.mode`.
 */
export const mode = (id: PineArray<number>): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  const frequencies = new Map<number, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of frequencies) {
    if (count > bestCount || (count === bestCount && value < (best ?? Number.POSITIVE_INFINITY))) {
      best = value;
      bestCount = count;
    }
  }
  return best!;
};

const varianceOf = (values: readonly number[], biased: boolean): number => {
  if (values.length === 0) return emptyResult;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const squared = values.reduce((total, value) => total + (value - mean) ** 2, 0);
  const denominator = biased ? values.length : values.length - 1;
  if (denominator <= 0) return emptyResult;
  return squared / denominator;
};

/** v6 `array.variance(id, biased)` — population (true) or sample (false). */
export const variance = (id: PineArray<number>, biased = true): number => {
  return varianceOf(collectNonNa(id), biased);
};

/** v6 `array.stdev(id, biased)` — population (true) or sample (false). */
export const stdev = (id: PineArray<number>, biased = true): number => {
  const varianceValue = varianceOf(collectNonNa(id), biased);
  return isNa(varianceValue) ? emptyResult : Math.sqrt(varianceValue);
};

/**
 * v6 `array.covariance(id1, id2, biased)` — covariance over the index pairs
 * where both elements are non-`na`. The arrays must be the same size, the
 * pairwise analogue of Pine's own requirement that paired collections line
 * up by index.
 */
export const covariance = (
  id1: PineArray<number>,
  id2: PineArray<number>,
  biased = true,
): number => {
  const left = id1.toArray();
  const right = id2.toArray();
  if (left.length !== right.length) {
    throw new RangeError("array.covariance() requires arrays of the same size");
  }
  const pairs: [number, number][] = [];
  for (let index = 0; index < left.length; index += 1) {
    if (!isNa(left[index]) && !isNa(right[index])) pairs.push([left[index]!, right[index]!]);
  }
  if (pairs.length === 0) return emptyResult;
  const meanLeft = pairs.reduce((total, pair) => total + pair[0], 0) / pairs.length;
  const meanRight = pairs.reduce((total, pair) => total + pair[1], 0) / pairs.length;
  const product = pairs.reduce(
    (total, pair) => total + (pair[0] - meanLeft) * (pair[1] - meanRight),
    0,
  );
  const denominator = biased ? pairs.length : pairs.length - 1;
  if (denominator <= 0) return emptyResult;
  return product / denominator;
};

/**
 * v6 `array.standardize(id)` — a new array of `(x - mean) / stdev` values
 * (population stdev), `na` elements preserved in place. Per the v6 Arrays
 * page, an empty or all-`na` input yields an empty array (the one exception
 * to the return-`na` rule). A zero stdev standardizes every element to `na`.
 */
export const standardize = (id: PineArray<number>): PineArray<number> => {
  const elements = id.toArray();
  const values = elements.filter((element) => !isNa(element));
  if (values.length === 0) return PineArray.createRoot<number>();
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const squared = values.reduce((total, value) => total + (value - mean) ** 2, 0);
  const deviation = Math.sqrt(squared / values.length);
  if (deviation === 0) {
    return PineArray.createRoot<number>(elements.map(() => Number.NaN));
  }
  return PineArray.createRoot<number>(
    elements.map((element) => (isNa(element) ? Number.NaN : (element - mean) / deviation)),
  );
};

/**
 * v6 `array.percentrank(id, index)` — the percentage of non-`na` elements
 * less than or equal to the reference element at `index` (the reference's
 * "less than or equal" convention, so the maximum reads 100).
 */
export const percentrank = (id: PineArray<number>, index: number): number => {
  const reference = id.get(index);
  if (isNa(reference)) return emptyResult;
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  const below = values.filter((value) => value <= reference).length;
  return (below / values.length) * 100;
};

/**
 * v6 `array.percentile_nearest_rank(id, percentage)` — the nearest-rank
 * percentile over the non-`na` elements: rank `ceil(percentage / 100 *
 * count)` on the ascending sort, clamped into the window, so the result is
 * always a member of the data set.
 */
export const percentile_nearest_rank = (id: PineArray<number>, percentage: number): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentage / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
};

/**
 * v6 `array.percentile_linear_interpolation(id, percentage)` — the linearly
 * interpolated percentile over the non-`na` elements (unlike the `ta.*`
 * window variant, whose window is strict: the v6 Arrays page pins the
 * skip-`na` rule for every array calculation built-in).
 */
export const percentile_linear_interpolation = (
  id: PineArray<number>,
  percentage: number,
): number => {
  const values = collectNonNa(id);
  if (values.length === 0) return emptyResult;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (percentage / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
};

/**
 * v6 `array.binary_search(id, val)` — an index whose element equals `val` in
 * a sorted array, or -1. The array must be sorted ascending and `na`-free,
 * exactly as the reference requires for correct results.
 */
export const binary_search = (id: PineArray<number>, val: number): number => {
  const elements = id.toArray();
  let low = 0;
  let high = elements.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = elements[mid]!;
    if (value === val) return mid;
    if (value < val) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
};

/**
 * v6 `array.binary_search_leftmost(id, val)` — the first index of `val`, or
 * (when absent) the index of the last element below `val`, or 0 when `val`
 * sorts before the first element. The result is always a valid index for a
 * non-empty array.
 */
export const binary_search_leftmost = (id: PineArray<number>, val: number): number => {
  const elements = id.toArray();
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (elements[mid]! < val) low = mid + 1;
    else high = mid;
  }
  if (low < elements.length && elements[low] === val) return low;
  return low > 0 ? low - 1 : 0;
};

/**
 * v6 `array.binary_search_rightmost(id, val)` — the last index of `val`, or
 * (when absent) the first index above `val`, or the array's last index plus
 * one when `val` sorts after the final element.
 */
export const binary_search_rightmost = (id: PineArray<number>, val: number): number => {
  const elements = id.toArray();
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (elements[mid]! <= val) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && elements[low - 1] === val) return low - 1;
  return low;
};
