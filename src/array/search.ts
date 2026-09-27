import type { PineArray } from "./pine-array.js";
import { PineArray as PineArrayClass } from "./pine-array.js";

/** Checks if the array includes the given value. */
export const includes = <T>(id: PineArray<T>, value: T): boolean => {
  for (const item of id) {
    if (Object.is(item, value)) return true;
  }
  return false;
};

/** Returns the first index of the value, or -1 if not found. */
export const indexof = <T>(id: PineArray<T>, value: T): number => {
  let index = 0;
  for (const item of id) {
    if (Object.is(item, value)) return index;
    index++;
  }
  return -1;
};

/** Returns the last index of the value, or -1 if not found. */
export const lastindexof = <T>(id: PineArray<T>, value: T): number => {
  const items = id.raw();
  for (let i = items.length - 1; i >= 0; i--) {
    if (Object.is(items[i], value)) return i;
  }
  return -1;
};

/** Binary search for value in a sorted array; returns index or -1. */
export const binary_search = (id: PineArray<number>, val: number): number => {
  const items = id.raw();
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = items[mid]!;
    if (midVal === val) return mid;
    if (midVal < val) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
};

/** Binary search returning leftmost occurrence or index of next smaller element. */
export const binary_search_leftmost = (id: PineArray<number>, val: number): number => {
  const items = id.raw();
  if (items.length === 0 || val < items[0]!) return -1;
  let low = 0;
  let high = items.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = items[mid]!;
    if (midVal === val) {
      candidate = mid;
      high = mid - 1;
    } else if (midVal < val) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate !== -1 ? candidate : high;
};

/** Binary search returning rightmost occurrence or index of next larger element. */
export const binary_search_rightmost = (id: PineArray<number>, val: number): number => {
  const items = id.raw();
  if (items.length === 0 || val > items[items.length - 1]!) return -1;
  let low = 0;
  let high = items.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = items[mid]!;
    if (midVal === val) {
      candidate = mid;
      low = mid + 1;
    } else if (midVal < val) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate !== -1 ? candidate : low;
};

/** Sorts the array elements in place. */
export const sort = <T extends number | string>(
  id: PineArray<T>,
  order: "asc" | "desc" = "asc",
): void => {
  const isAsc = order === "asc";
  id.raw().sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") {
      return isAsc ? a - b : b - a;
    }
    return isAsc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
  });
};

/** Returns a new array containing indices sorted by array values. */
export const sort_indices = <T extends number | string>(
  id: PineArray<T>,
  order: "asc" | "desc" = "asc",
): PineArray<number> => {
  const items = id.raw();
  const indices = items.map((_, i) => i);
  const isAsc = order === "asc";
  indices.sort((i, j) => {
    const a = items[i]!;
    const b = items[j]!;
    if (typeof a === "number" && typeof b === "number") {
      return isAsc ? a - b : b - a;
    }
    return isAsc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
  });
  return new PineArrayClass<number>(indices);
};

/** Reverses the array elements in place. */
export const reverse = <T>(id: PineArray<T>): void => {
  id.raw().reverse();
};

/** Evaluates whether every element in a boolean array is true. */
export const every = (id: PineArray<boolean>): boolean => {
  for (const item of id) {
    if (!item) return false;
  }
  return true;
};

/** Evaluates whether at least one element in a boolean array is true. */
export const some = (id: PineArray<boolean>): boolean => {
  for (const item of id) {
    if (item) return true;
  }
  return false;
};

/** Joins array elements into a string using the separator. */
export const join = <T>(id: PineArray<T>, separator: string): string => id.raw().join(separator);
