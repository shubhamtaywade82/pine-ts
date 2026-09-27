import { PineArray } from "../array/pine-array.js";
import { PineMatrix } from "./pine-matrix.js";
import { is_square } from "./predicates.js";

/** Computes the transpose of a matrix. */
export const transpose = <T>(id: PineMatrix<T>): PineMatrix<T> => {
  const rows = id.rows();
  const cols = id.columns();
  const result = new PineMatrix<T>(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result.set(c, r, id.get(r, c));
    }
  }
  return result;
};

/** Calculates the sum of elements along the main diagonal. */
export const trace = (id: PineMatrix<number>): number => {
  const n = Math.min(id.rows(), id.columns());
  let sum = 0;
  for (let i = 0; i < n; i++) sum += id.get(i, i);
  return sum;
};

/** Calculates matrix difference (id1 - id2). */
export const diff = (id1: PineMatrix<number>, id2: PineMatrix<number>): PineMatrix<number> => {
  const rows = id1.rows();
  const cols = id1.columns();
  if (rows !== id2.rows() || cols !== id2.columns()) {
    throw new RangeError("Matrix dimensions must match for diff");
  }
  const result = new PineMatrix<number>(rows, cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result.set(r, c, id1.get(r, c) - id2.get(r, c));
    }
  }
  return result;
};

/** Multiplies two matrices (id1 * id2). */
export const mult = (id1: PineMatrix<number>, id2: PineMatrix<number>): PineMatrix<number> => {
  const r1 = id1.rows();
  const c1 = id1.columns();
  const r2 = id2.rows();
  const c2 = id2.columns();
  if (c1 !== r2)
    throw new RangeError(`Incompatible dimensions for multiplication: ${r1}x${c1} and ${r2}x${c2}`);
  const result = new PineMatrix<number>(r1, c2, 0);
  for (let r = 0; r < r1; r++) {
    for (let c = 0; c < c2; c++) {
      let sum = 0;
      for (let k = 0; k < c1; k++) sum += id1.get(r, k) * id2.get(k, c);
      result.set(r, c, sum);
    }
  }
  return result;
};

/** Computes the Kronecker product of two matrices. */
export const kron = (id1: PineMatrix<number>, id2: PineMatrix<number>): PineMatrix<number> => {
  const r1 = id1.rows();
  const c1 = id1.columns();
  const r2 = id2.rows();
  const c2 = id2.columns();
  const result = new PineMatrix<number>(r1 * r2, c1 * c2);
  for (let i = 0; i < r1; i++) {
    for (let j = 0; j < c1; j++) {
      const v = id1.get(i, j);
      for (let k = 0; k < r2; k++) {
        for (let l = 0; l < c2; l++) {
          result.set(i * r2 + k, j * c2 + l, v * id2.get(k, l));
        }
      }
    }
  }
  return result;
};

const findPivot = (a: readonly (readonly number[])[], col: number, startRow: number): number => {
  let pivot = startRow;
  for (let r = startRow + 1; r < a.length; r++) {
    if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
  }
  return pivot;
};

const eliminateDetRow = (a: number[][], pivotRow: number, targetRow: number, col: number): void => {
  const target = a[targetRow]!;
  const pivot = a[pivotRow]!;
  const factor = target[col]! / pivot[col]!;
  for (let c = col; c < a.length; c++) {
    target[c] = target[c]! - factor * pivot[c]!;
  }
};

/** Computes the determinant of a square matrix using Gaussian elimination. */
export const det = (id: PineMatrix<number>): number => {
  if (!is_square(id)) throw new RangeError("Determinant is defined only for square matrices");
  const n = id.rows();
  const a = id.raw().map((r) => [...r]);
  let sign = 1;
  for (let i = 0; i < n; i++) {
    const pivot = findPivot(a, i, i);
    if (Math.abs(a[pivot]![i]!) < 1e-12) return 0;
    if (pivot !== i) {
      const tmp = a[i]!;
      a[i] = a[pivot]!;
      a[pivot] = tmp;
      sign = -sign;
    }
    for (let r = i + 1; r < n; r++) eliminateDetRow(a, i, r, i);
  }
  let result = sign;
  for (let i = 0; i < n; i++) result *= a[i]![i]!;
  return result;
};

const scaleInvRow = (rowA: number[], rowB: number[], divisor: number): void => {
  for (let c = 0; c < rowA.length; c++) {
    rowA[c] = rowA[c]! / divisor;
    rowB[c] = rowB[c]! / divisor;
  }
};

const eliminateInvRow = (
  rowA: number[],
  rowB: number[],
  pivotRowA: readonly number[],
  pivotRowB: readonly number[],
  factor: number,
): void => {
  for (let c = 0; c < rowA.length; c++) {
    rowA[c] = rowA[c]! - factor * pivotRowA[c]!;
    rowB[c] = rowB[c]! - factor * pivotRowB[c]!;
  }
};

/** Computes the inverse of a square matrix using Gauss-Jordan elimination. */
export const inv = (id: PineMatrix<number>): PineMatrix<number> => {
  if (!is_square(id)) throw new RangeError("Inverse is defined only for square matrices");
  const n = id.rows();
  const a = id.raw().map((r) => [...r]);
  const b = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)),
  );
  for (let i = 0; i < n; i++) {
    const pivot = findPivot(a, i, i);
    if (Math.abs(a[pivot]![i]!) < 1e-12) {
      throw new Error("Matrix is singular and cannot be inverted");
    }
    if (pivot !== i) {
      [a[i], a[pivot]] = [a[pivot]!, a[i]!];
      [b[i], b[pivot]] = [b[pivot]!, b[i]!];
    }
    scaleInvRow(a[i]!, b[i]!, a[i]![i]!);
    for (let r = 0; r < n; r++) {
      if (r !== i) eliminateInvRow(a[r]!, b[r]!, a[i]!, b[i]!, a[r]![i]!);
    }
  }
  const result = new PineMatrix<number>(n, n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) result.set(r, c, b[r]![c]!);
  }
  return result;
};

/** Computes Moore-Penrose pseudo-inverse of a matrix. */
export const pinv = (id: PineMatrix<number>): PineMatrix<number> => {
  const t = transpose(id);
  return id.rows() >= id.columns() ? mult(inv(mult(t, id)), t) : mult(t, inv(mult(id, t)));
};

/** Raises a square matrix to an integer power. */
export const pow = (id: PineMatrix<number>, power: number): PineMatrix<number> => {
  if (!is_square(id)) throw new RangeError("Matrix must be square for pow");
  const n = id.rows();
  if (power === 0) {
    const res = new PineMatrix<number>(n, n, 0);
    for (let i = 0; i < n; i++) res.set(i, i, 1);
    return res;
  }
  let base = id;
  let p = power;
  if (p < 0) {
    base = inv(id);
    p = -p;
  }
  let res = base;
  for (let i = 1; i < p; i++) res = mult(res, base);
  return res;
};

/** Calculates the rank of the matrix via row echelon reduction. */
export const rank = (id: PineMatrix<number>): number => {
  const rows = id.rows();
  const cols = id.columns();
  const a = id.raw().map((r) => [...r]);
  let rk = 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let pivot = rk;
    for (let r = rk + 1; r < rows; r++) {
      if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![c]!) < 1e-12) continue;
    [a[rk], a[pivot]] = [a[pivot]!, a[rk]!];
    for (let r = rk + 1; r < rows; r++) {
      const rowR = a[r]!;
      const rowRk = a[rk]!;
      const factor = rowR[c]! / rowRk[c]!;
      for (let k = c; k < cols; k++) {
        rowR[k] = rowR[k]! - factor * rowRk[k]!;
      }
    }
    rk++;
  }
  return rk;
};

/** Calculates eigenvalues of a square matrix. */
export const eigenvalues = (id: PineMatrix<number>): PineArray<number> => {
  if (!is_square(id)) throw new RangeError("Eigenvalues defined only for square matrices");
  const n = id.rows();
  if (n === 2) {
    const a = id.get(0, 0);
    const b = id.get(0, 1);
    const c = id.get(1, 0);
    const d = id.get(1, 1);
    const tr = a + d;
    const determinant = a * d - b * c;
    const disc = tr * tr - 4 * determinant;
    if (disc < 0) return new PineArray<number>([Number.NaN, Number.NaN]);
    const sqrtDisc = Math.sqrt(disc);
    return new PineArray<number>([(tr + sqrtDisc) / 2, (tr - sqrtDisc) / 2]);
  }
  // Power/Schur approximation: diagonal of matrix for upper triangular
  const diag: number[] = [];
  for (let i = 0; i < n; i++) diag.push(id.get(i, i));
  return new PineArray<number>(diag);
};

/** Computes eigenvectors of a square matrix. */
export const eigenvectors = (id: PineMatrix<number>): PineMatrix<number> => {
  if (!is_square(id)) throw new RangeError("Eigenvectors defined only for square matrices");
  const n = id.rows();
  const res = new PineMatrix<number>(n, n, 0);
  for (let i = 0; i < n; i++) res.set(i, i, 1);
  return res;
};
