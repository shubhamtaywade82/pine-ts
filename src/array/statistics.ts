import type { PineArray } from "./pine-array.js";
import { PineArray as PineArrayClass } from "./pine-array.js";

/** Returns a new array containing the absolute values of the elements. */
export const abs = (id: PineArray<number>): PineArray<number> =>
  new PineArrayClass<number>(id.raw().map(Math.abs));

/** Returns the minimum value in the array, or NaN if empty. */
export const min = (id: PineArray<number>): number => {
  let result = Number.NaN;
  for (const val of id) {
    if (Number.isNaN(val)) continue;
    if (Number.isNaN(result) || val < result) result = val;
  }
  return result;
};

/** Returns the maximum value in the array, or NaN if empty. */
export const max = (id: PineArray<number>): number => {
  let result = Number.NaN;
  for (const val of id) {
    if (Number.isNaN(val)) continue;
    if (Number.isNaN(result) || val > result) result = val;
  }
  return result;
};

/** Returns the difference between the max and min elements. */
export const range = (id: PineArray<number>): number => {
  const lo = min(id);
  const hi = max(id);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return Number.NaN;
  return hi - lo;
};

/** Returns the sum of array elements, or NaN if empty. */
export const sum = (id: PineArray<number>): number => {
  let total = 0;
  let count = 0;
  for (const val of id) {
    if (Number.isNaN(val)) continue;
    total += val;
    count++;
  }
  return count === 0 ? Number.NaN : total;
};

/** Returns the average of array elements, or NaN if empty. */
export const avg = (id: PineArray<number>): number => {
  let total = 0;
  let count = 0;
  for (const val of id) {
    if (Number.isNaN(val)) continue;
    total += val;
    count++;
  }
  return count === 0 ? Number.NaN : total / count;
};

/** Calculates variance of array elements (biased by default). */
export const variance = (id: PineArray<number>, biased = true): number => {
  const items = id.raw().filter((x) => !Number.isNaN(x));
  const n = items.length;
  if (n === 0 || (!biased && n <= 1)) return Number.NaN;
  const m = items.reduce((acc, x) => acc + x, 0) / n;
  const sumSq = items.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return sumSq / (biased ? n : n - 1);
};

/** Calculates standard deviation of array elements. */
export const stdev = (id: PineArray<number>, biased = true): number => {
  const v = variance(id, biased);
  return Number.isNaN(v) ? Number.NaN : Math.sqrt(v);
};

/** Standardizes array elements into z-scores using population stdev. */
export const standardize = (id: PineArray<number>): PineArray<number> => {
  const m = avg(id);
  const s = stdev(id, true);
  if (Number.isNaN(m) || Number.isNaN(s) || s === 0) {
    return new PineArrayClass<number>(new Array<number>(id.size()).fill(Number.NaN));
  }
  return new PineArrayClass<number>(id.raw().map((x) => (x - m) / s));
};

/** Calculates covariance between two numeric arrays. */
export const covariance = (
  id1: PineArray<number>,
  id2: PineArray<number>,
  biased = true,
): number => {
  const x = id1.raw();
  const y = id2.raw();
  if (x.length !== y.length || x.length === 0) return Number.NaN;
  const n = x.length;
  if (!biased && n <= 1) return Number.NaN;
  const m1 = avg(id1);
  const m2 = avg(id2);
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(x[i]!) || Number.isNaN(y[i]!)) return Number.NaN;
    sumDiff += (x[i]! - m1) * (y[i]! - m2);
  }
  return sumDiff / (biased ? n : n - 1);
};

/** Calculates median of array elements. */
export const median = (id: PineArray<number>): number => {
  const valid = id
    .raw()
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0) return Number.NaN;
  const mid = n >> 1;
  return (n & 1) === 1 ? valid[mid]! : (valid[mid - 1]! + valid[mid]!) / 2;
};

/** Returns the most frequent value in the array; tie-breaks with smallest value. */
export const mode = (id: PineArray<number>): number => {
  const valid = id.raw().filter((x) => !Number.isNaN(x));
  if (valid.length === 0) return Number.NaN;
  const counts = new Map<number, number>();
  let maxFreq = 0;
  for (const x of valid) {
    const f = (counts.get(x) ?? 0) + 1;
    counts.set(x, f);
    if (f > maxFreq) maxFreq = f;
  }
  let result = Number.NaN;
  for (const [val, freq] of counts.entries()) {
    if (freq === maxFreq && (Number.isNaN(result) || val < result)) {
      result = val;
    }
  }
  return result;
};

/** Calculates the percentile rank of the element at the specified index. */
export const percentrank = (id: PineArray<number>, index: number): number => {
  const target = id.get(index);
  if (Number.isNaN(target)) return Number.NaN;
  const valid = id.raw().filter((x) => !Number.isNaN(x));
  if (valid.length <= 1) return 100;
  let countLess = 0;
  for (const x of valid) {
    if (x < target) countLess++;
  }
  return (countLess / (valid.length - 1)) * 100;
};

/** Calculates percentile using linear interpolation between closest ranks. */
export const percentile_linear_interpolation = (
  id: PineArray<number>,
  percentage: number,
): number => {
  const valid = id
    .raw()
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0 || Number.isNaN(percentage)) return Number.NaN;
  if (n === 1) return valid[0]!;
  const clamped = Math.max(0, Math.min(100, percentage));
  const rank = (clamped / 100) * (n - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return valid[low]!;
  return valid[low]! + (rank - low) * (valid[high]! - valid[low]!);
};

/** Calculates percentile using the nearest rank method. */
export const percentile_nearest_rank = (id: PineArray<number>, percentage: number): number => {
  const valid = id
    .raw()
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0 || Number.isNaN(percentage)) return Number.NaN;
  if (percentage <= 0) return valid[0]!;
  if (percentage >= 100) return valid[n - 1]!;
  const rank = Math.ceil((percentage / 100) * n);
  const idx = Math.max(0, Math.min(n - 1, rank - 1));
  return valid[idx]!;
};
