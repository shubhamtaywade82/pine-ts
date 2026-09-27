import { PineArray } from "../array/pine-array.js";
import { isNa } from "../core/na.js";
import { PineMatrix } from "./pine-matrix.js";

/**
 * v6 `matrix.transpose(id)` — a new matrix with the row and column indices
 * of every element interchanged.
 */
export const transpose = <T>(id: PineMatrix<T>): PineMatrix<T> => {
  const height = id.rowCount();
  const width = id.columnCount();
  const result = PineMatrix.create<T>(width, height);
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      result.backing.rows[c]![r] = id.backing.rows[r]![c];
    }
  }
  return result;
};

/**
 * v6 `matrix.mult(id1, id2)` — the product of a matrix with a matrix, a
 * scalar, or a vector: `m x n * n x p -> m x p`, `m x n * scalar -> m x n`,
 * and `m x n * array n -> array m`. Arithmetic on `na` propagates.
 */
/* eslint-disable sonarjs/function-return-type -- the v6 overloads return matrix or array */
export const mult = (
  id1: PineMatrix<number>,
  id2: PineMatrix<number> | PineArray<number> | number,
): PineMatrix<number> | PineArray<number> => {
  if (typeof id2 === "number") return scale(id1, id2);
  if (id2 instanceof PineArray) return multiplyVector(id1, id2);
  return multiplyMatrices(id1, id2);
};
/* eslint-enable sonarjs/function-return-type */

const multiplyMatrices = (id1: PineMatrix<number>, id2: PineMatrix<number>): PineMatrix<number> => {
  const left = id1.rowCount();
  const inner = id1.columnCount();
  const right = id2.columnCount();
  if (inner !== id2.rowCount()) {
    throw new RangeError(
      `Cannot multiply matrices with incompatible dimensions: ${left}x${inner} and ${id2.rowCount()}x${right}`,
    );
  }
  const result = PineMatrix.create<number>(left, right);
  for (let r = 0; r < left; r += 1) {
    for (let c = 0; c < right; c += 1) {
      let total = 0;
      let na = false;
      for (let k = 0; k < inner; k += 1) {
        const a = id1.backing.rows[r]![k];
        const b = id2.backing.rows[k]![c];
        if (isNa(a) || isNa(b)) {
          na = true;
          break;
        }
        total += a * b;
      }
      result.backing.rows[r]![c] = na ? Number.NaN : total;
    }
  }
  return result;
};

const scale = (id: PineMatrix<number>, factor: number): PineMatrix<number> => {
  const result = PineMatrix.create<number>(id.rowCount(), id.columnCount());
  for (let r = 0; r < id.rowCount(); r += 1) {
    for (let c = 0; c < id.columnCount(); c += 1) {
      const value = id.backing.rows[r]![c];
      result.backing.rows[r]![c] = isNa(value) ? Number.NaN : value * factor;
    }
  }
  return result;
};

const multiplyVector = (id: PineMatrix<number>, vector: PineArray<number>): PineArray<number> => {
  const inner = id.columnCount();
  if (vector.size() !== inner) {
    throw new RangeError(
      `Cannot multiply a matrix with ${inner} columns by a vector of size ${vector.size()}`,
    );
  }
  const result = PineArray.createRoot<number>();
  for (let r = 0; r < id.rowCount(); r += 1) {
    let total = 0;
    let na = false;
    for (let k = 0; k < inner; k += 1) {
      const a = id.backing.rows[r]![k];
      const b = vector.get(k);
      if (isNa(a) || isNa(b)) {
        na = true;
        break;
      }
      total += a * b;
    }
    result.push(na ? Number.NaN : total);
  }
  return result;
};

/** Index of the largest-magnitude entry in `column` at or below the diagonal. */
const pivotRow = (a: number[][], col: number): number => {
  let pivot = col;
  for (let r = col + 1; r < a.length; r += 1) {
    if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
  }
  return pivot;
};

/**
 * v6 `matrix.det(id)` — the determinant of a square matrix, computed via LU
 * decomposition with partial pivoting (the algorithm the reference names).
 * Singular matrices yield 0; `na` elements propagate to an `na` result.
 */
export const det = (id: PineMatrix<number>): number => {
  requireSquare(id, "calculate the determinant of");
  const n = id.rowCount();
  const a = snapshot(id);
  let sign = 1;
  for (let col = 0; col < n; col += 1) {
    const pivot = pivotRow(a, col);
    if (Math.abs(a[pivot]![col]!) < 1e-300) return 0;
    if (pivot !== col) {
      const swap = a[pivot]!;
      a[pivot] = a[col]!;
      a[col] = swap;
      sign = -sign;
    }
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c += 1) a[r]![c] = a[r]![c]! - factor * a[col]![c]!;
    }
  }
  let result = sign;
  for (let index = 0; index < n; index += 1) result *= a[index]![index]!;
  return result;
};

/**
 * v6 `matrix.inv(id)` — the inverse of a square matrix via LU decomposition
 * with partial pivoting (the algorithm the reference names). A singular
 * (non-invertible) matrix raises a runtime error.
 */
export const inv = (id: PineMatrix<number>): PineMatrix<number> => {
  requireSquare(id, "invert");
  const n = id.rowCount();
  const factors = factorLu(snapshot(id));
  if (factors === undefined) throw new RangeError("Matrix is singular");
  const result = PineMatrix.create<number>(n, n);
  for (let column = 0; column < n; column += 1) {
    const b = Array.from({ length: n }, (_, r) => (r === column ? 1 : 0));
    const solved = solveLu(factors, b);
    for (let r = 0; r < n; r += 1) result.backing.rows[r]![column] = solved[r]!;
  }
  return result;
};

/**
 * v6 `matrix.pinv(id)` — the Moore-Penrose pseudoinverse, computed from
 * the singular-value decomposition (one-sided Jacobi rotations, the
 * Hestenes method). For non-singular square matrices the result matches
 * `matrix.inv`, as the reference documents.
 */
export const pinv = (id: PineMatrix<number>): PineMatrix<number> => {
  const height = id.rowCount();
  const width = id.columnCount();
  if (height === 0 || width === 0) return PineMatrix.create<number>(width, height);
  const { u, sigma, v } = svd(id);
  const tolerance = Math.max(height, width) * Number.EPSILON * (sigma[0] ?? 0);
  const inner = Math.min(height, width);
  const result = PineMatrix.create<number>(width, height);
  for (let r = 0; r < width; r += 1) {
    for (let c = 0; c < height; c += 1) {
      let total = 0;
      for (let k = 0; k < inner; k += 1) {
        const singular = sigma[k]!;
        if (singular <= tolerance) continue;
        // pinv = V * diag(1/sigma) * U^T
        total += v.backing.rows[r]![k]! * (u.backing.rows[c]![k]! / singular);
      }
      result.backing.rows[r]![c] = total;
    }
  }
  return result;
};

/**
 * v6 `matrix.rank(id)` — the rank of the matrix, from Gaussian elimination
 * with partial pivoting and a relative tolerance.
 */
export const rank = (id: PineMatrix<number>): number => {
  const height = id.rowCount();
  const width = id.columnCount();
  const a = snapshot(id);
  const tolerance = eliminationTolerance(a, height, width);
  let counted = 0;
  for (let col = 0, row = 0; col < width && row < height; col += 1) {
    const pivot = pivotRow(a, col);
    if (Math.abs(a[pivot]![col]!) <= tolerance) continue;
    if (pivot !== row) {
      const swap = a[pivot]!;
      a[pivot] = a[row]!;
      a[row] = swap;
    }
    for (let r = row + 1; r < height; r += 1) {
      const factor = a[r]![col]! / a[row]![col]!;
      for (let c = col; c < width; c += 1) a[r]![c] = a[r]![c]! - factor * a[row]![c]!;
    }
    row += 1;
    counted += 1;
  }
  return counted;
};

/** Relative pivot threshold for rank counting: max dimension * eps * max |a|. */
const eliminationTolerance = (a: number[][], height: number, width: number): number => {
  let maxAbs = 0;
  for (const row of a) {
    for (const value of row) maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  return Math.max(height, width) * Number.EPSILON * maxAbs;
};

/**
 * v6 `matrix.kron(id1, id2)` — the Kronecker product: a
 * `(r1*r2) x (c1*c2)` matrix of every `id1[i][j] * id2` block.
 */
export const kron = (id1: PineMatrix<number>, id2: PineMatrix<number>): PineMatrix<number> => {
  const r1 = id1.rowCount();
  const c1 = id1.columnCount();
  const r2 = id2.rowCount();
  const c2 = id2.columnCount();
  const result = PineMatrix.create<number>(r1 * r2, c1 * c2);
  for (let i = 0; i < r1; i += 1) {
    for (let j = 0; j < c1; j += 1) {
      const factor = id1.backing.rows[i]![j];
      for (let k = 0; k < r2; k += 1) {
        for (let l = 0; l < c2; l += 1) {
          const value = id2.backing.rows[k]![l];
          result.backing.rows[i * r2 + k]![j * c2 + l] =
            isNa(factor) || isNa(value) ? Number.NaN : factor * value;
        }
      }
    }
  }
  return result;
};

/**
 * v6 `matrix.pow(id, power)` — the matrix multiplied by itself `power`
 * times (binary exponentiation). `power` 0 yields the identity; negative
 * powers raise a runtime error (they would require the inverse).
 */
export const pow = (id: PineMatrix<number>, power: number): PineMatrix<number> => {
  requireSquare(id, "raise the power of");
  if (!Number.isInteger(power) || power < 0) {
    throw new RangeError("Power must be a non-negative integer");
  }
  const n = id.rowCount();
  let accumulator = identity(n);
  if (power === 0) return accumulator;
  let base = id;
  let remaining = power;
  while (remaining > 0) {
    if (remaining % 2 === 1) {
      accumulator = mult(accumulator, base) as PineMatrix<number>;
    }
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) base = mult(base, base) as PineMatrix<number>;
  }
  return accumulator;
};

const identity = (n: number): PineMatrix<number> => {
  const result = PineMatrix.create<number>(n, n, 0);
  for (let index = 0; index < n; index += 1) result.backing.rows[index]![index] = 1;
  return result;
};

/**
 * v6 `matrix.eigenvalues(id)` — an array with the eigenvalues of a square
 * matrix in ascending order, computed with the Implicit QL algorithm the
 * reference names: Householder tridiagonalization (EISPACK `tred2`)
 * followed by implicit QL shifts (`tql2`).
 */
export const eigenvalues = (id: PineMatrix<number>): PineArray<number> => {
  const { values } = eigenSolve(id);
  return PineArray.createRoot<number>(values);
};

/**
 * v6 `matrix.eigenvectors(id)` — a matrix whose *columns* are the
 * eigenvectors of `id`, permuted to match the ascending order of
 * `matrix.eigenvalues`.
 */
export const eigenvectors = (id: PineMatrix<number>): PineMatrix<number> => {
  const { vectors } = eigenSolve(id);
  return vectors;
};

// ---------------------------------------------------------------------------
// EISPACK pipeline (tred2 + tql2), faithful 0-based ports of the
// public-domain Fortran sources (Martin, Reinsch & Wilkinson 1968/1971;
// Bowdler, Martin, Reinsch & Wilkinson 1968/1971) — the "Implicit QL
// Algorithm" the v6 reference names. tred2 reads only the lower triangle,
// so non-symmetric input follows that convention; symmetric input is exact.
// ---------------------------------------------------------------------------

const eigenSolve = (
  id: PineMatrix<number>,
): {
  values: number[];
  vectors: PineMatrix<number>;
} => {
  requireSquare(id, "compute the eigenvalues of");
  const n = id.rowCount();
  const a = snapshot(id);
  const d = Array.from({ length: n }, () => 0);
  const e = Array.from({ length: n }, () => 0);
  const z = Array.from({ length: n }, (): number[] => Array.from({ length: n }, () => 0));
  tred2(a, d, e, z);
  tql2(d, e, z);
  return { values: d, vectors: PineMatrix.fromRows(z) };
};

/** Householder reduction to tridiagonal form, accumulating the transform into `z`. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- faithful 0-based port of EISPACK tred2; keep the 1:1 statement mapping
const tred2 = (a: number[][], d: number[], e: number[], z: number[][]): void => {
  const n = a.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) z[j]![i] = a[j]![i]!;
    d[i] = a[n - 1]![i]!;
  }
  for (let ii = 0; ii < n - 1; ii += 1) {
    const i = n - 1 - ii;
    const l = i - 1;
    let h = 0;
    let scale = 0;
    let skipped = l < 1;
    if (!skipped) {
      for (let k = 0; k <= l; k += 1) scale += Math.abs(d[k]!);
      skipped = scale === 0;
    }
    if (skipped) {
      e[i] = d[l]!;
      for (let j = 0; j <= l; j += 1) {
        d[j] = z[l]![j]!;
        z[i]![j] = 0;
        z[j]![i] = 0;
      }
    } else {
      for (let k = 0; k <= l; k += 1) {
        d[k] = d[k]! / scale;
        h += d[k]! * d[k]!;
      }
      const f0 = d[l]!;
      const g = f0 >= 0 ? -Math.sqrt(h) : Math.sqrt(h);
      e[i] = scale * g;
      h -= f0 * g;
      d[l] = f0 - g;
      // Form a*u.
      for (let j = 0; j <= l; j += 1) e[j] = 0;
      for (let j = 0; j <= l; j += 1) {
        const f = d[j]!;
        z[j]![i] = f;
        let g2 = e[j]! + z[j]![j]! * f;
        for (let k = j + 1; k <= l; k += 1) {
          g2 += z[k]![j]! * d[k]!;
          e[k] = e[k]! + z[k]![j]! * f;
        }
        e[j] = g2;
      }
      // Form p.
      let f = 0;
      for (let j = 0; j <= l; j += 1) {
        e[j] = e[j]! / h;
        f += e[j]! * d[j]!;
      }
      const hh = f / (h + h);
      // Form q.
      for (let j = 0; j <= l; j += 1) e[j] = e[j]! - hh * d[j]!;
      // Form reduced a.
      for (let j = 0; j <= l; j += 1) {
        const f2 = d[j]!;
        const g3 = e[j]!;
        for (let k = j; k <= l; k += 1) {
          z[k]![j] = z[k]![j]! - f2 * e[k]! - g3 * d[k]!;
        }
        d[j] = z[l]![j]!;
        z[i]![j] = 0;
      }
    }
    d[i] = h;
  }
  // Accumulation of transformation matrices.
  for (let i = 1; i < n; i += 1) {
    const l = i - 1;
    z[n - 1]![l] = z[l]![l]!;
    z[l]![l] = 1;
    const h = d[i]!;
    if (h !== 0) {
      for (let k = 0; k <= l; k += 1) d[k] = z[k]![i]! / h;
      for (let j = 0; j <= l; j += 1) {
        let g = 0;
        for (let k = 0; k <= l; k += 1) g += z[k]![i]! * z[k]![j]!;
        for (let k = 0; k <= l; k += 1) z[k]![j] = z[k]![j]! - g * d[k]!;
      }
    }
    for (let k = 0; k <= l; k += 1) z[k]![i] = 0;
  }
  for (let i = 0; i < n; i += 1) {
    d[i] = z[n - 1]![i]!;
    z[n - 1]![i] = 0;
  }
  z[n - 1]![n - 1] = 1;
  e[0] = 0;
};

/** Implicit QL with shifts; `d` leaves holding eigenvalues in ascending order, `z` the matching eigenvector columns. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- faithful 0-based port of EISPACK tql2; keep the 1:1 statement mapping
const tql2 = (d: number[], e: number[], z: number[][]): void => {
  const n = d.length;
  if (n === 1) return;
  for (let i = 1; i < n; i += 1) e[i - 1] = e[i]!;
  let f = 0;
  let tst1 = 0;
  e[n - 1] = 0;
  for (let l = 0; l < n; l += 1) {
    let j = 0;
    const norm = Math.abs(d[l]!) + Math.abs(e[l]!);
    if (tst1 < norm) tst1 = norm;
    // Look for a small sub-diagonal element (e[n-1] is always zero).
    let m = l;
    while (m < n) {
      const tst2 = tst1 + Math.abs(e[m]!);
      if (tst2 === tst1) break;
      m += 1;
    }
    if (m !== l) {
      let converged = false;
      while (!converged) {
        if (j === 30) {
          throw new RangeError("Too many iterations in eigenvalue calculation");
        }
        j += 1;
        // Form shift.
        const l1 = l + 1;
        const l2 = l1 + 1;
        const g0 = d[l]!;
        const p0 = (d[l1]! - g0) / (2 * e[l]!);
        const r0 = Math.hypot(p0, 1);
        const signed = p0 >= 0 ? r0 : -r0;
        d[l] = e[l]! / (p0 + signed);
        d[l1] = e[l]! * (p0 + signed);
        const dl1 = d[l1];
        const h0 = g0 - d[l]!;
        for (let i = l2; i < n; i += 1) d[i] = d[i]! - h0;
        f += h0;
        // QL transformation.
        let p = d[m]!;
        let c = 1;
        let c2 = c;
        const el1 = e[l1]!;
        let s = 0;
        const mml = m - l;
        let c3 = 1;
        let s2 = 0;
        for (let ii = 1; ii <= mml; ii += 1) {
          c3 = c2;
          c2 = c;
          s2 = s;
          const i = m - ii;
          const g = c * e[i]!;
          const h = c * p;
          const r = Math.hypot(p, e[i]!);
          e[i + 1] = s * r;
          s = e[i]! / r;
          c = p / r;
          p = c * d[i]! - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]!);
          for (let k = 0; k < n; k += 1) {
            const h2 = z[k]![i + 1]!;
            z[k]![i + 1] = s * z[k]![i]! + c * h2;
            z[k]![i] = c * z[k]![i]! - s * h2;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]!) / dl1;
        e[l] = s * p;
        d[l] = c * p;
        const tst2 = tst1 + Math.abs(e[l]!);
        converged = tst2 <= tst1;
      }
    }
    d[l] = d[l]! + f;
  }
  // Order eigenvalues (and eigenvectors) ascending.
  for (let ii = 1; ii < n; ii += 1) {
    const i = ii - 1;
    let k = i;
    let p = d[i]!;
    for (let jj = ii; jj < n; jj += 1) {
      if (d[jj]! < p) {
        k = jj;
        p = d[jj]!;
      }
    }
    if (k !== i) {
      d[k] = d[i]!;
      d[i] = p;
      for (let jj = 0; jj < n; jj += 1) {
        const t = z[jj]![i]!;
        z[jj]![i] = z[jj]![k]!;
        z[jj]![k] = t;
      }
    }
  }
};

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const requireSquare = (id: PineMatrix<number>, operation: string): void => {
  if (id.rowCount() !== id.columnCount()) {
    throw new RangeError(
      `Cannot ${operation} a non-square matrix (${id.rowCount()}x${id.columnCount()})`,
    );
  }
};

const snapshot = (id: PineMatrix<number>): number[][] =>
  id.backing.rows.map((row) =>
    row.map((value) => (typeof value === "number" && !Number.isNaN(value) ? value : Number.NaN)),
  );

interface LuFactors {
  readonly lu: number[][];
  readonly pivot: number[];
}

const factorLu = (a: number[][]): LuFactors | undefined => {
  const n = a.length;
  const lu = a.map((row) => [...row]);
  const pivot = Array.from({ length: n }, (_, index) => index);
  for (let col = 0; col < n; col += 1) {
    const best = pivotRow(lu, col);
    const pivotValue = lu[best]![col]!;
    if (pivotValue === 0) return undefined;
    if (best !== col) {
      const swap = lu[best]!;
      lu[best] = lu[col]!;
      lu[col] = swap;
      const swapIndex = pivot[best]!;
      pivot[best] = pivot[col]!;
      pivot[col] = swapIndex;
    }
    for (let r = col + 1; r < n; r += 1) {
      lu[r]![col] = lu[r]![col]! / lu[col]![col]!;
      for (let c = col + 1; c < n; c += 1) {
        lu[r]![c] = lu[r]![c]! - lu[r]![col]! * lu[col]![c]!;
      }
    }
  }
  return { lu, pivot };
};

const solveLu = (factors: LuFactors, b: number[]): number[] => {
  const { lu, pivot } = factors;
  const n = lu.length;
  const x = pivot.map((row) => b[row]!);
  for (let r = 1; r < n; r += 1) {
    for (let c = 0; c < r; c += 1) x[r] = x[r]! - lu[r]![c]! * x[c]!;
  }
  for (let r = n - 1; r >= 0; r -= 1) {
    for (let c = r + 1; c < n; c += 1) x[r] = x[r]! - lu[r]![c]! * x[c]!;
    x[r] = x[r]! / lu[r]![r]!;
  }
  return x;
};

interface Svd {
  readonly u: PineMatrix<number>;
  readonly sigma: number[];
  readonly v: PineMatrix<number>;
}

/**
 * Thin SVD via one-sided Jacobi rotations of the columns (Hestenes method):
 * orthogonalize column pairs until convergence, then read the singular
 * values off the column norms. Accurate and simple for the small matrices
 * Pine scripts build. `u` is `m x min(m,n)` with singular values sorted
 * descending in `sigma`; `v` is `n x n` with columns permuted to match.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- compact numerical kernel (Hestenes one-sided Jacobi)
const svd = (id: PineMatrix<number>): Svd => {
  const height = id.rowCount();
  const width = id.columnCount();
  const transposed = height < width;
  const m = transposed ? width : height;
  const n = transposed ? height : width;
  const work = transposed ? transpose(id) : id;
  const b = PineMatrix.create<number>(m, n);
  for (let r = 0; r < m; r += 1) {
    for (let c = 0; c < n; c += 1) b.backing.rows[r]![c] = work.backing.rows[r]![c]!;
  }
  const v = identity(n);

  for (let sweep = 0; sweep < 60; sweep += 1) {
    let rotated = false;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let r = 0; r < m; r += 1) {
          const cp = b.backing.rows[r]![p]!;
          const cq = b.backing.rows[r]![q]!;
          alpha += cp * cp;
          beta += cq * cq;
          gamma += cp * cq;
        }
        if (alpha + beta === 0 || Math.abs(gamma) <= Number.EPSILON * Math.sqrt(alpha * beta)) {
          continue;
        }
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let r = 0; r < m; r += 1) {
          const cp = b.backing.rows[r]![p]!;
          const cq = b.backing.rows[r]![q]!;
          b.backing.rows[r]![p] = c * cp - s * cq;
          b.backing.rows[r]![q] = s * cp + c * cq;
        }
        for (let r = 0; r < n; r += 1) {
          const vp = v.backing.rows[r]![p]!;
          const vq = v.backing.rows[r]![q]!;
          v.backing.rows[r]![p] = c * vp - s * vq;
          v.backing.rows[r]![q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }

  const columns = Array.from({ length: n }, (_, c) => {
    let norm = 0;
    for (let r = 0; r < m; r += 1) {
      const value = b.backing.rows[r]![c]!;
      norm += value * value;
    }
    return { index: c, norm: Math.sqrt(norm) };
  }).sort((left, right) => right.norm - left.norm);

  const sigma = columns.map((column) => column.norm);
  const u = PineMatrix.create<number>(m, n);
  for (let c = 0; c < columns.length; c += 1) {
    const source = columns[c]!.index;
    const norm = columns[c]!.norm;
    for (let r = 0; r < m; r += 1) {
      u.backing.rows[r]![c] = norm > 0 ? b.backing.rows[r]![source]! / norm : 0;
    }
  }
  const vSorted = PineMatrix.create<number>(n, n);
  for (let c = 0; c < columns.length; c += 1) {
    const source = columns[c]!.index;
    for (let r = 0; r < n; r += 1) {
      vSorted.backing.rows[r]![c] = v.backing.rows[r]![source]!;
    }
  }
  if (!transposed) return { u, sigma, v: vSorted };
  // For A^T = U' S V'^T (tall), A = V' S U'^T: swap the thin factors.
  return { u: vSorted, sigma, v: u };
};
