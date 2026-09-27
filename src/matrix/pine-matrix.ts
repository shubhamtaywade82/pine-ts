import { getCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { PineArray } from "../array/pine-array.js";

/** The maximum number of elements any single Pine matrix may hold. */
export const MAX_MATRIX_ELEMENTS = 100_000;

/**
 * Backing storage owned by a root matrix. The representation is row-major:
 * `rows[i][j]` is the element at row `i`, column `j`. Every row always has
 * the same length — mutations preserve that invariant — so a matrix with no
 * rows reports zero columns (a `matrix.new(r, 0)` keeps its `r` empty rows,
 * while `matrix.new(0, c)` collapses to the empty 0x0 matrix).
 */
export class MatrixBacking<T> {
  public rows: (T | undefined)[][] = [];
  /** When true (varip promotion) mutations skip the session's undo journal. */
  public varip = false;
}

const signedNumeric = (left: number, right: number): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const signedTextual = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/**
 * A Pine `matrix<T>`: a two-dimensional rectangular collection whose
 * in-place mutations are journaled on the owning session so realtime
 * revisions roll them back — the matrix counterpart of a `var` cell
 * restoring its committed value. Structural edits (`add_row`, `remove_col`,
 * `reshape`, `sort`, …) each record a precise inverse, so undoing a bar is
 * replay-equivalent without full-matrix snapshots.
 *
 * Matrices are root-only: `matrix.submatrix` and `matrix.copy` return fresh
 * shallow copies (the v6 reference documents submatrices as sliced copies,
 * not write-through views like `array.slice`).
 */
export class PineMatrix<T> {
  public readonly backing: MatrixBacking<T>;

  public constructor(backing: MatrixBacking<T> = new MatrixBacking<T>()) {
    this.backing = backing;
  }

  /** Creates a matrix from existing row arrays (copied; must be rectangular). */
  public static fromRows<T>(rowValues: readonly (readonly (T | undefined)[])[]): PineMatrix<T> {
    const backing = new MatrixBacking<T>();
    const width = rowValues[0]?.length ?? 0;
    for (const row of rowValues) {
      if (row.length !== width) {
        throw new RangeError("Matrix rows must all have the same length");
      }
    }
    if (rowValues.length * width > MAX_MATRIX_ELEMENTS) {
      throw new RangeError(`Matrix is too large. Maximum size is ${MAX_MATRIX_ELEMENTS}`);
    }
    backing.rows = rowValues.map((row) => [...row]);
    return new PineMatrix<T>(backing);
  }

  /**
   * Appends copies of `rowValues` at the end (used by `matrix.concat`),
   * journaling a truncation undo.
   */
  public appendRows(rowValues: readonly (readonly (T | undefined)[])[]): void {
    const start = this.rowCount();
    for (const row of rowValues) {
      if (row.length !== this.columnCount()) {
        throw new RangeError(
          `Cannot concatenate matrices with different column counts: ${this.columnCount()} and ${row.length}`,
        );
      }
    }
    this.assertCapacity(rowValues.reduce((total, row) => total + row.length, 0));
    for (const row of rowValues) this.backing.rows.push([...row]);
    this.journal(() => {
      this.backing.rows.length = start;
    });
  }

  /** Creates a matrix of `rows` x `columns` filled with `initial` (na by default). */
  public static create<T>(rows: number, columns: number, initial?: T): PineMatrix<T> {
    validateDimensions(rows, columns);
    const backing = new MatrixBacking<T>();
    backing.rows = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, (): T | undefined => initial),
    );
    return new PineMatrix<T>(backing);
  }

  /**
   * `varip` promotion: mutations stop journaling (and already-journaled
   * mutations become permanent), so updates finalize on every tick. Pine's
   * `varip` rules restrict matrix elements to fundamental values, so —
   * unlike arrays — there is no nested collection promotion to walk.
   */
  public _setVarip(enabled: boolean): void {
    this.backing.varip = enabled;
    if (!enabled) return;
    const session = getCurrentSession();
    if (session !== undefined) session.purgeArrayMutations(this.backing);
  }

  /** The number of rows. */
  public rowCount(): number {
    return this.backing.rows.length;
  }

  /** The number of columns (zero when there are no rows). */
  public columnCount(): number {
    return this.backing.rows[0]?.length ?? 0;
  }

  /** The total number of elements (`rows * columns`). */
  public elementsCount(): number {
    return this.rowCount() * this.columnCount();
  }

  /** Reads the element at `[row, column]`; out-of-range indices throw. */
  public get(row: number, column: number): T | undefined {
    this.assertIndex(row, column);
    return this.backing.rows[row]![column];
  }

  /** Writes the element at `[row, column]` (journaled). */
  public set(row: number, column: number, value: T | undefined): void {
    this.assertIndex(row, column);
    const previous = this.backing.rows[row]![column];
    this.journal(() => {
      this.backing.rows[row]![column] = previous;
    });
    this.backing.rows[row]![column] = value;
  }

  /**
   * Inserts a row at `index` (0..rows). With `values` the row takes those
   * elements — any size on an empty matrix, else exactly `columns` long.
   * Without `values` a row of `na` is inserted.
   */
  public addRow(index: number | undefined, values?: readonly (T | undefined)[]): void {
    const at = index ?? this.rowCount();
    const rows = this.rowCount();
    if (at < 0 || at > rows) {
      throw new RangeError(
        `Index ${at} is out of bounds. Matrix size is ${rows}x${this.columnCount()}`,
      );
    }
    let inserted: (T | undefined)[];
    if (values === undefined) {
      inserted = Array.from({ length: this.columnCount() }, (): T | undefined => undefined);
    } else if (rows === 0) {
      inserted = [...values];
    } else if (values.length !== this.columnCount()) {
      throw new RangeError(
        `Array size ${values.length} does not match matrix columns ${this.columnCount()}`,
      );
    } else {
      inserted = [...values];
    }
    this.assertCapacity(inserted.length);
    this.backing.rows.splice(at, 0, inserted);
    this.journal(() => {
      this.backing.rows.splice(at, 1);
    });
  }

  /**
   * Inserts a column at `index` (0..columns). With `values` the column takes
   * those elements — any size on a matrix with no rows (bootstrapping the
   * row count), else exactly `rows` long. Without `values` a column of `na`
   * is inserted.
   */
  public addColumn(index: number | undefined, values?: readonly (T | undefined)[]): void {
    const at = index ?? this.columnCount();
    const columns = this.columnCount();
    const rows = this.rowCount();
    if (at < 0 || at > columns) {
      throw new RangeError(`Index ${at} is out of bounds. Matrix size is ${rows}x${columns}`);
    }
    if (values === undefined) {
      const filled = Array.from({ length: rows }, (): (T | undefined)[] =>
        Array.from({ length: 1 }, (): T | undefined => undefined),
      );
      this.assertCapacity(rows);
      for (let r = 0; r < rows; r += 1) this.backing.rows[r]!.splice(at, 0, filled[r]![0]);
      this.journal(() => {
        for (let r = 0; r < rows; r += 1) this.backing.rows[r]!.splice(at, 1);
      });
      return;
    }
    if (rows === 0) {
      this.assertCapacity(values.length);
      this.backing.rows = values.map((value) => [value]);
      this.journal(() => {
        this.backing.rows = [];
      });
      return;
    }
    if (values.length !== rows) {
      throw new RangeError(`Array size ${values.length} does not match matrix rows ${rows}`);
    }
    this.assertCapacity(rows);
    for (let r = 0; r < rows; r += 1) this.backing.rows[r]!.splice(at, 0, values[r]);
    this.journal(() => {
      for (let r = 0; r < rows; r += 1) this.backing.rows[r]!.splice(at, 1);
    });
  }

  /**
   * Removes the row at `index` (the last row by default) and returns its
   * elements as a new array.
   */
  public removeRow(index: number | undefined): PineArray<T> {
    const rows = this.rowCount();
    if (rows === 0) {
      throw new RangeError(`Index ${index ?? 0} is out of bounds. Matrix size is 0x0`);
    }
    const at = index ?? rows - 1;
    if (at < 0 || at >= rows) {
      throw new RangeError(
        `Index ${at} is out of bounds. Matrix size is ${rows}x${this.columnCount()}`,
      );
    }
    const removed = this.backing.rows.splice(at, 1)[0]!;
    this.journal(() => {
      this.backing.rows.splice(at, 0, removed);
    });
    return PineArray.createRoot<T>([...removed]);
  }

  /**
   * Removes the column at `index` (the last column by default) and returns
   * its elements as a new array.
   */
  public removeColumn(index: number | undefined): PineArray<T> {
    const rows = this.rowCount();
    const columns = this.columnCount();
    if (columns === 0) {
      throw new RangeError(
        `Index ${index ?? 0} is out of bounds. Matrix size is ${rows}x${columns}`,
      );
    }
    const at = index ?? columns - 1;
    if (at < 0 || at >= columns) {
      throw new RangeError(`Index ${at} is out of bounds. Matrix size is ${rows}x${columns}`);
    }
    const removed = this.backing.rows.map((row) => row.splice(at, 1)[0]!);
    this.journal(() => {
      for (let r = 0; r < rows; r += 1) this.backing.rows[r]!.splice(at, 0, removed[r]!);
    });
    return PineArray.createRoot<T>(removed);
  }

  /** Swaps the rows at `row1` and `row2` (journaled; the swap is its own inverse). */
  public swapRows(row1: number, row2: number): void {
    const rows = this.rowCount();
    for (const index of [row1, row2]) {
      if (index < 0 || index >= rows) {
        throw new RangeError(
          `Index ${index} is out of bounds. Matrix size is ${rows}x${this.columnCount()}`,
        );
      }
    }
    if (row1 === row2) return;
    this.journal(() => {
      this.swapRowsUnjournaled(row1, row2);
    });
    this.swapRowsUnjournaled(row1, row2);
  }

  /** Swaps the columns at `column1` and `column2` (journaled; self-inverse). */
  public swapColumns(column1: number, column2: number): void {
    const columns = this.columnCount();
    for (const index of [column1, column2]) {
      if (index < 0 || index >= columns) {
        throw new RangeError(
          `Index ${index} is out of bounds. Matrix size is ${this.rowCount()}x${columns}`,
        );
      }
    }
    if (column1 === column2) return;
    this.journal(() => {
      this.swapColumnsUnjournaled(column1, column2);
    });
    this.swapColumnsUnjournaled(column1, column2);
  }

  /** Writes `value` across the `[from_row, to_row) x [from_column, to_column)` rectangle. */
  public fill(
    value: T | undefined,
    fromRow = 0,
    toRow: number = Number.NaN,
    fromColumn = 0,
    toColumn: number = Number.NaN,
  ): void {
    const rows = this.rowCount();
    const columns = this.columnCount();
    const rowEnd = isNa(toRow) ? rows : toRow;
    const columnEnd = isNa(toColumn) ? columns : toColumn;
    if (
      fromRow < 0 ||
      fromRow > rows ||
      rowEnd < fromRow ||
      rowEnd > rows ||
      fromColumn < 0 ||
      fromColumn > columns ||
      columnEnd < fromColumn ||
      columnEnd > columns
    ) {
      throw new RangeError(`Index ${fromRow} is out of bounds. Matrix size is ${rows}x${columns}`);
    }
    if (rowEnd === fromRow || columnEnd === fromColumn) return;
    const previous = this.backing.rows.map((row, r) =>
      r >= fromRow && r < rowEnd ? row.slice(fromColumn, columnEnd) : undefined,
    );
    this.journal(() => {
      for (let r = fromRow; r < rowEnd; r += 1) {
        this.backing.rows[r]!.splice(fromColumn, columnEnd - fromColumn, ...previous[r]!);
      }
    });
    for (let r = fromRow; r < rowEnd; r += 1) {
      this.backing.rows[r]!.fill(value, fromColumn, columnEnd);
    }
  }

  /**
   * Rebuilds the matrix to `rows` x `columns` in place, preserving the
   * row-major element order. The total element count must be unchanged.
   */
  public reshape(rows: number, columns: number): void {
    validateDimensions(rows, columns);
    if (rows * columns !== this.elementsCount()) {
      throw new RangeError(
        `Cannot reshape a matrix with ${this.elementsCount()} elements into ${rows}x${columns}`,
      );
    }
    const previousRows = this.rowCount();
    const previousColumns = this.columnCount();
    const flat = this.backing.rows.flat();
    this.backing.rows = Array.from({ length: rows }, (_, r) =>
      flat.slice(r * columns, (r + 1) * columns),
    );
    this.journal(() => {
      const flatAgain = this.backing.rows.flat();
      this.backing.rows = Array.from({ length: previousRows }, (_, r) =>
        flatAgain.slice(r * previousColumns, (r + 1) * previousColumns),
      );
    });
  }

  /**
   * Reverses the order of rows and columns in place: the first row and
   * column become the last (a 180-degree rotation, which is its own
   * inverse — the journal entry simply reverses again).
   */
  public reverse(): void {
    this.journal(() => {
      this.reverseUnjournaled();
    });
    this.reverseUnjournaled();
  }

  /**
   * Rearranges the rows in place following the sorted order of `column`'s
   * values, with `na` rows sinking to the end in either direction — the
   * matrix counterpart of the `array.sort` na rule.
   */
  public sortInPlace(column: number, order: "ascending" | "descending"): void {
    const columns = this.columnCount();
    if (column < 0 || column >= columns) {
      throw new RangeError(
        `Index ${column} is out of bounds. Matrix size is ${this.rowCount()}x${columns}`,
      );
    }
    const previous = [...this.backing.rows];
    this.journal(() => {
      this.backing.rows = previous;
    });
    const direction = order === "descending" ? -1 : 1;
    this.backing.rows = [...this.backing.rows].sort((left, right) => {
      const leftValue = left[column];
      const rightValue = right[column];
      const leftNa = isNa(leftValue as number | undefined);
      const rightNa = isNa(rightValue as number | undefined);
      if (leftNa && rightNa) return 0;
      if (leftNa) return 1;
      if (rightNa) return -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return signedNumeric(leftValue, rightValue) * direction;
      }
      if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
        return signedNumeric(Number(leftValue), Number(rightValue)) * direction;
      }
      return signedTextual(String(leftValue), String(rightValue)) * direction;
    });
  }

  /** A deep-value snapshot: row arrays copied, elements as stored. */
  public toArray2D(): (T | undefined)[][] {
    return this.backing.rows.map((row) => [...row]);
  }

  /** Iterates `[index, rowArray]` pairs, mirroring Pine's `for [i, row] in m`. */
  public rowEntries(): [number, (T | undefined)[]][] {
    return this.backing.rows.map((row, index) => [index, [...row]]);
  }

  /** Iterates row-array copies in order, mirroring Pine's `for row in m`. */
  public [Symbol.iterator](): Iterator<(T | undefined)[]> {
    return this.backing.rows.map((row) => [...row])[Symbol.iterator]();
  }

  private swapRowsUnjournaled(row1: number, row2: number): void {
    const rows = this.backing.rows;
    const swap = rows[row1]!;
    rows[row1] = rows[row2]!;
    rows[row2] = swap;
  }

  private swapColumnsUnjournaled(column1: number, column2: number): void {
    for (const row of this.backing.rows) {
      const swap = row[column1]!;
      row[column1] = row[column2]!;
      row[column2] = swap;
    }
  }

  private reverseUnjournaled(): void {
    this.backing.rows.reverse();
    for (const row of this.backing.rows) row.reverse();
  }

  private assertIndex(row: number, column: number): void {
    const rows = this.rowCount();
    const columns = this.columnCount();
    if (row < 0 || row >= rows || column < 0 || column >= columns) {
      throw new RangeError(
        `Index [${row}, ${column}] is out of bounds. Matrix size is ${rows}x${columns}`,
      );
    }
  }

  private assertCapacity(added: number): void {
    if (this.elementsCount() + added > MAX_MATRIX_ELEMENTS) {
      throw new RangeError(`Matrix is too large. Maximum size is ${MAX_MATRIX_ELEMENTS}`);
    }
  }

  private journal(undo: () => void): void {
    const session = getCurrentSession();
    if (session === undefined || this.backing.varip) return;
    session.journalArrayMutation(this.backing, undo);
  }
}

const validateDimensions = (rows: number, columns: number): void => {
  if (rows < 0 || columns < 0) {
    throw new RangeError("Cannot create a matrix with negative dimensions");
  }
  if (rows * columns > MAX_MATRIX_ELEMENTS) {
    throw new RangeError(`Matrix is too large. Maximum size is ${MAX_MATRIX_ELEMENTS}`);
  }
};
