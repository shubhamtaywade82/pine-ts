import { isNa } from "../core/na.js";
import { PineMatrix } from "./pine-matrix.js";

/** Collects the numeric, non-na elements of a matrix in row-major order. */
const nonNaElements = (id: PineMatrix<number>): number[] => {
  const values: number[] = [];
  for (const row of id.backing.rows) {
    for (const value of row) {
      if (typeof value === "number" && !Number.isNaN(value)) values.push(value);
    }
  }
  return values;
};

/**
 * v6 `matrix.avg(id)` — the skip-na mean of all elements; `na` when the
 * matrix is empty or every element is `na` (the collection statistics
 * rule shared with arrays).
 */
export const avg = (id: PineMatrix<number>): number => {
  const values = nonNaElements(id);
  if (values.length === 0) return Number.NaN;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

/** v6 `matrix.max(id)` — the largest non-na element, or `na` when none. */
export const max = (id: PineMatrix<number>): number => {
  const values = nonNaElements(id);
  if (values.length === 0) return Number.NaN;
  return Math.max(...values);
};

/** v6 `matrix.min(id)` — the smallest non-na element, or `na` when none. */
export const min = (id: PineMatrix<number>): number => {
  const values = nonNaElements(id);
  if (values.length === 0) return Number.NaN;
  return Math.min(...values);
};

/**
 * v6 `matrix.median(id)` — the skip-na median ("the middle" value; the
 * mean of the two middle values for even counts), `na` when empty/all-na.
 * The reference notes na elements are not considered.
 */
export const median = (id: PineMatrix<number>): number => {
  const values = nonNaElements(id);
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * v6 `matrix.mode(id)` — the most frequently occurring value; ties resolve
 * to the smallest value, and when every value occurs equally often that
 * same rule yields the smallest element. `na` elements are not considered.
 */
export const mode = (id: PineMatrix<number>): number => {
  const values = nonNaElements(id);
  if (values.length === 0) return Number.NaN;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const value of [...counts.keys()].sort((left, right) => left - right)) {
    const count = counts.get(value)!;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best ?? Number.NaN;
};

/**
 * v6 `matrix.trace(id)` — the sum of the main diagonal's elements. The
 * diagonal of a non-square matrix runs over `min(rows, columns)`; `na`
 * diagonal entries are skipped (the scalar-statistics na rule).
 */
export const trace = (id: PineMatrix<number>): number => {
  const length = Math.min(id.rowCount(), id.columnCount());
  let total = 0;
  let counted = 0;
  for (let index = 0; index < length; index += 1) {
    const value = id.backing.rows[index]![index];
    if (typeof value === "number" && !Number.isNaN(value)) {
      total += value;
      counted += 1;
    }
  }
  return counted === 0 ? Number.NaN : total;
};

const requireSameShape = (
  id1: PineMatrix<number>,
  id2: PineMatrix<number>,
  operation: string,
): void => {
  if (id1.rowCount() !== id2.rowCount() || id1.columnCount() !== id2.columnCount()) {
    throw new RangeError(
      `Cannot ${operation} matrices with different dimensions: ${id1.rowCount()}x${id1.columnCount()} and ${id2.rowCount()}x${id2.columnCount()}`,
    );
  }
};

/**
 * v6 `matrix.sum(id1, id2)` — element-wise sum of two same-shaped matrices
 * or of a matrix and a scalar, returned as a new matrix. Arithmetic on `na`
 * propagates (`na + x = na`), matching Pine scalar arithmetic.
 */
export const sum = (
  id1: PineMatrix<number>,
  id2: PineMatrix<number> | number,
): PineMatrix<number> => {
  const result = emptyLike(id1);
  if (typeof id2 === "number") {
    for (let r = 0; r < id1.rowCount(); r += 1) {
      for (let c = 0; c < id1.columnCount(); c += 1) {
        result.backing.rows[r]![c] = add(id1.backing.rows[r]![c], id2);
      }
    }
    return result;
  }
  requireSameShape(id1, id2, "sum");
  for (let r = 0; r < id1.rowCount(); r += 1) {
    for (let c = 0; c < id1.columnCount(); c += 1) {
      result.backing.rows[r]![c] = add(id1.backing.rows[r]![c], id2.backing.rows[r]![c]);
    }
  }
  return result;
};

/**
 * v6 `matrix.diff(id1, id2)` — element-wise difference between two
 * same-shaped matrices or between a matrix and a scalar, returned as a new
 * matrix with `na` propagation.
 */
export const diff = (
  id1: PineMatrix<number>,
  id2: PineMatrix<number> | number,
): PineMatrix<number> => {
  const result = emptyLike(id1);
  if (typeof id2 === "number") {
    for (let r = 0; r < id1.rowCount(); r += 1) {
      for (let c = 0; c < id1.columnCount(); c += 1) {
        result.backing.rows[r]![c] = subtract(id1.backing.rows[r]![c], id2);
      }
    }
    return result;
  }
  requireSameShape(id1, id2, "subtract");
  for (let r = 0; r < id1.rowCount(); r += 1) {
    for (let c = 0; c < id1.columnCount(); c += 1) {
      result.backing.rows[r]![c] = subtract(id1.backing.rows[r]![c], id2.backing.rows[r]![c]);
    }
  }
  return result;
};

const emptyLike = (id: PineMatrix<number>): PineMatrix<number> =>
  PineMatrix.fromRows(
    Array.from({ length: id.rowCount() }, () =>
      Array.from({ length: id.columnCount() }, (): number | undefined => undefined),
    ),
  );

const add = (left: number | undefined, right: number | undefined): number | undefined => {
  if (isNa(left) || isNa(right)) return Number.NaN;
  return left + right;
};

const subtract = (left: number | undefined, right: number | undefined): number | undefined => {
  if (isNa(left) || isNa(right)) return Number.NaN;
  return left - right;
};
