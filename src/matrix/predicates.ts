import { PineMatrix } from "./pine-matrix.js";

/** Equality that treats two `na` elements as matching (for symmetry tests). */
const valueEq = (left: number | undefined, right: number | undefined): boolean => {
  if (isNumericNa(left)) return isNumericNa(right);
  if (isNumericNa(right)) return false;
  return left === right;
};

/** Negation that maps `na` to `na` (for antisymmetry tests). */
const negate = (value: number | undefined): number | undefined =>
  value === undefined || Number.isNaN(value) ? value : -value;

const isNumericNa = (value: number | undefined): boolean =>
  value === undefined || Number.isNaN(value);

/** v6 `matrix.is_square(id)` — equal row and column counts. */
export const is_square = (id: PineMatrix<number>): boolean => id.rowCount() === id.columnCount();

/**
 * v6 `matrix.is_zero(id)` — true when every element is exactly zero (`na`
 * elements are not zero). The empty matrix is vacuously zero.
 */
export const is_zero = (id: PineMatrix<number>): boolean => {
  for (const row of id.backing.rows) {
    for (const value of row) {
      if (isNumericNa(value) || value! !== 0) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_binary(id)` — true when every element is 0 or 1 (`na`
 * elements disqualify).
 */
export const is_binary = (id: PineMatrix<number>): boolean => {
  for (const row of id.backing.rows) {
    for (const value of row) {
      if (isNumericNa(value)) return false;
      if (value! !== 0 && value! !== 1) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_identity(id)` — ones on the main diagonal, zeros elsewhere.
 * Returns false with non-square matrices.
 */
export const is_identity = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  for (let r = 0; r < id.rowCount(); r += 1) {
    for (let c = 0; c < id.columnCount(); c += 1) {
      const value = id.backing.rows[r]![c];
      if (r === c) {
        if (isNumericNa(value) || value! !== 1) return false;
      } else if (isNumericNa(value) || value! !== 0) {
        return false;
      }
    }
  }
  return true;
};

/**
 * v6 `matrix.is_diagonal(id)` — all elements outside the main diagonal are
 * zero. Returns false with non-square matrices.
 */
export const is_diagonal = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  for (let r = 0; r < id.rowCount(); r += 1) {
    for (let c = 0; c < id.columnCount(); c += 1) {
      if (r === c) continue;
      const value = id.backing.rows[r]![c];
      if (isNumericNa(value) || value! !== 0) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_antidiagonal(id)` — all elements outside the secondary
 * diagonal are zero. Returns false with non-square matrices.
 */
export const is_antidiagonal = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rowCount();
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (r + c === n - 1) continue;
      const value = id.backing.rows[r]![c];
      if (isNumericNa(value) || value! !== 0) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_symmetric(id)` — the matrix equals its transpose. Returns
 * false with non-square matrices.
 */
export const is_symmetric = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rowCount();
  for (let r = 0; r < n; r += 1) {
    for (let c = r + 1; c < n; c += 1) {
      if (!valueEq(id.backing.rows[r]![c], id.backing.rows[c]![r])) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_antisymmetric(id)` — the transpose equals the negative.
 * Returns false with non-square matrices.
 */
export const is_antisymmetric = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rowCount();
  for (let r = 0; r < n; r += 1) {
    for (let c = r; c < n; c += 1) {
      const left = id.backing.rows[r]![c];
      const right = id.backing.rows[c]![r];
      // a == -a forces a zero (or na) diagonal, so no separate check is needed.
      if (!valueEq(left, negate(right))) return false;
    }
  }
  return true;
};

/**
 * v6 `matrix.is_triangular(id)` — all elements above or below the main
 * diagonal are zero. Returns false with non-square matrices.
 */
export const is_triangular = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rowCount();
  let upper = true;
  let lower = true;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const value = id.backing.rows[r]![c];
      if (r < c && (isNumericNa(value) || value! !== 0)) upper = false;
      if (r > c && (isNumericNa(value) || value! !== 0)) lower = false;
    }
  }
  return upper || lower;
};

/**
 * v6 `matrix.is_stochastic(id)` — every element non-negative and every row
 * summing to 1 (a row-stochastic matrix; `na` disqualifies). Row sums use
 * a 1e-9 tolerance to absorb floating-point accumulation.
 */
export const is_stochastic = (id: PineMatrix<number>): boolean => {
  for (const row of id.backing.rows) {
    let total = 0;
    for (const value of row) {
      if (isNumericNa(value) || value! < 0) return false;
      total += value!;
    }
    if (Math.abs(total - 1) > 1e-9) return false;
  }
  return true;
};
