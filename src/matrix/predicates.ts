import type { PineMatrix } from "./pine-matrix.js";

/** Checks if the matrix has equal number of rows and columns. */
export const is_square = <T>(id: PineMatrix<T>): boolean =>
  id.rows() === id.columns() && id.rows() > 0;

/** Checks if the matrix is an identity matrix. */
export const is_identity = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const expected = r === c ? 1 : 0;
      if (Math.abs(id.get(r, c) - expected) > 1e-9) return false;
    }
  }
  return true;
};

/** Checks if all elements in the matrix are zero. */
export const is_zero = <T>(id: PineMatrix<T>): boolean => {
  for (const x of id.flat()) {
    if (x !== 0) return false;
  }
  return true;
};

/** Checks if the matrix is square and all non-diagonal elements are zero. */
export const is_diagonal = <T>(id: PineMatrix<T>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r !== c && id.get(r, c) !== 0) return false;
    }
  }
  return true;
};

/** Checks if the matrix is square and all non-antidiagonal elements are zero. */
export const is_antidiagonal = <T>(id: PineMatrix<T>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r + c !== n - 1 && id.get(r, c) !== 0) return false;
    }
  }
  return true;
};

/** Checks if the matrix is symmetric across its main diagonal. */
export const is_symmetric = <T>(id: PineMatrix<T>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    for (let c = r + 1; c < n; c++) {
      if (id.get(r, c) !== id.get(c, r)) return false;
    }
  }
  return true;
};

/** Checks if the matrix satisfies M[i][j] === -M[j][i]. */
export const is_antisymmetric = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (Math.abs(id.get(r, c) + id.get(c, r)) > 1e-9) return false;
    }
  }
  return true;
};

/** Checks if the matrix is either upper or lower triangular. */
export const is_triangular = <T>(id: PineMatrix<T>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  let isUpper = true;
  let isLower = true;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r > c && id.get(r, c) !== 0) isUpper = false;
      if (r < c && id.get(r, c) !== 0) isLower = false;
    }
  }
  return isUpper || isLower;
};

/** Checks if all elements in the matrix are 0 or 1. */
export const is_binary = <T>(id: PineMatrix<T>): boolean => {
  for (const x of id.flat()) {
    if (x !== 0 && x !== 1) return false;
  }
  return true;
};

/** Checks if each row of the matrix has non-negative elements summing to 1. */
export const is_stochastic = (id: PineMatrix<number>): boolean => {
  if (!is_square(id)) return false;
  const n = id.rows();
  for (let r = 0; r < n; r++) {
    let rowSum = 0;
    for (let c = 0; c < n; c++) {
      const val = id.get(r, c);
      if (val < 0 || val > 1) return false;
      rowSum += val;
    }
    if (Math.abs(rowSum - 1) > 1e-6) return false;
  }
  return true;
};
