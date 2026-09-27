import { PineArray } from "../array/pine-array.js";
import { order, type SortOrder } from "../order/index.js";
import { PineMatrix } from "./pine-matrix.js";

/** v6 `matrix<float>` — the numeric `na` element is `NaN`. */
export type FloatMatrix = PineMatrix<number>;
/** v6 `matrix<int>` — shares the numeric backing (`NaN` is `na`). */
export type IntMatrix = PineMatrix<number>;
/** v6 `matrix<bool>`. */
export type BoolMatrix = PineMatrix<boolean>;
/** v6 `matrix<string>`. */
export type StringMatrix = PineMatrix<string>;
/**
 * Pine `color` values in pine-ts are `#RRGGBB[AA]` strings until the
 * `color.*` namespace lands; color matrices use the string backing.
 */
export type ColorMatrix = PineMatrix<string>;

const numericMatrix = (rows: number, columns: number, initial: number | undefined): FloatMatrix =>
  PineMatrix.create<number>(rows, columns, initial ?? Number.NaN);

export const newFloat = (rows = 0, columns = 0, initialValue?: number): FloatMatrix =>
  numericMatrix(rows, columns, initialValue);

export const newInt = (rows = 0, columns = 0, initialValue?: number): IntMatrix =>
  numericMatrix(rows, columns, initialValue);

export const newBool = (rows = 0, columns = 0, initialValue?: boolean): BoolMatrix =>
  PineMatrix.create<boolean>(rows, columns, initialValue);

export const newString = (rows = 0, columns = 0, initialValue?: string): StringMatrix =>
  PineMatrix.create<string>(rows, columns, initialValue);

export const newColor = (rows = 0, columns = 0, initialValue?: string): ColorMatrix =>
  PineMatrix.create<string>(rows, columns, initialValue);

/**
 * v6 `matrix.new<type>(rows, columns, initial_value)` — all arguments
 * optional (defaults 0, 0, `na`). The typed constructors above pin the
 * per-type `na` element (numbers use `NaN`); the generic form fills with
 * `undefined` when no initial value is supplied.
 */
export const newMatrix = <T>(rows = 0, columns = 0, initialValue?: T): PineMatrix<T> =>
  PineMatrix.create<T>(rows, columns, initialValue);

/** v6 `matrix.get(id, row, column)`. */
export const get = <T>(id: PineMatrix<T>, row: number, column: number): T | undefined =>
  id.get(row, column);

/** v6 `matrix.set(id, row, column, value)`. */
export const set = <T>(
  id: PineMatrix<T>,
  row: number,
  column: number,
  value: T | undefined,
): void => {
  id.set(row, column, value);
};

/** v6 `matrix.rows(id)`. */
export const rows = <T>(id: PineMatrix<T>): number => id.rowCount();

/** v6 `matrix.columns(id)`. */
export const columns = <T>(id: PineMatrix<T>): number => id.columnCount();

/** v6 `matrix.elements_count(id)` — `rows * columns`. */
export const elements_count = <T>(id: PineMatrix<T>): number => id.elementsCount();

/**
 * v6 `matrix.row(id, row)` — the row's elements as a new array (a copy:
 * mutating it never touches the matrix).
 */
export const row = <T>(id: PineMatrix<T>, rowIndex: number): PineArray<T> => {
  const width = id.columnCount();
  if (rowIndex < 0 || rowIndex >= id.rowCount()) {
    throw new RangeError(
      `Index ${rowIndex} is out of bounds. Matrix size is ${id.rowCount()}x${width}`,
    );
  }
  return PineArray.createRoot<T>([...id.backing.rows[rowIndex]!]);
};

/**
 * v6 `matrix.col(id, column)` — the column's elements as a new array (a
 * copy, sized `matrix.rows(id)`).
 */
export const col = <T>(id: PineMatrix<T>, column: number): PineArray<T> => {
  const height = id.rowCount();
  if (column < 0 || column >= id.columnCount()) {
    throw new RangeError(
      `Index ${column} is out of bounds. Matrix size is ${height}x${id.columnCount()}`,
    );
  }
  return PineArray.createRoot<T>(id.backing.rows.map((rowValues) => rowValues[column]!));
};

/**
 * v6 `matrix.add_row(id, row, array_id)` — `row` defaults to the end and
 * `array_id` to a row of `na` values.
 */
export const add_row = <T>(id: PineMatrix<T>, rowIndex?: number, arrayId?: PineArray<T>): void => {
  id.addRow(rowIndex, arrayId?.toArray());
};

/**
 * v6 `matrix.add_col(id, column, array_id)` — `column` defaults to the end
 * and `array_id` to a column of `na` values.
 */
export const add_col = <T>(
  id: PineMatrix<T>,
  columnIndex?: number,
  arrayId?: PineArray<T>,
): void => {
  id.addColumn(columnIndex, arrayId?.toArray());
};

/**
 * v6 `matrix.remove_row(id, row)` — removes the row (the last by default)
 * and returns its elements as an array.
 */
export const remove_row = <T>(id: PineMatrix<T>, rowIndex?: number): PineArray<T> =>
  id.removeRow(rowIndex);

/**
 * v6 `matrix.remove_col(id, column)` — removes the column (the last by
 * default) and returns its elements as an array.
 */
export const remove_col = <T>(id: PineMatrix<T>, columnIndex?: number): PineArray<T> =>
  id.removeColumn(columnIndex);

/** v6 `matrix.swap_rows(id, row1, row2)`. */
export const swap_rows = <T>(id: PineMatrix<T>, row1: number, row2: number): void => {
  id.swapRows(row1, row2);
};

/** v6 `matrix.swap_columns(id, column1, column2)`. */
export const swap_columns = <T>(id: PineMatrix<T>, column1: number, column2: number): void => {
  id.swapColumns(column1, column2);
};

/**
 * v6 `matrix.fill(id, value, from_row, to_row, from_column, to_column)` —
 * the rectangle bounds are `[inclusive, exclusive)` and default to the
 * whole matrix.
 */
export const fill = <T>(
  id: PineMatrix<T>,
  value: T | undefined,
  fromRow = 0,
  toRow: number = Number.NaN,
  fromColumn = 0,
  toColumn: number = Number.NaN,
): void => {
  id.fill(value, fromRow, toRow, fromColumn, toColumn);
};

/**
 * v6 `matrix.copy(id)` — a shallow copy: a new matrix with fresh row
 * storage whose elements hold the same values or references.
 */
export const copy = <T>(id: PineMatrix<T>): PineMatrix<T> => PineMatrix.fromRows(id.toArray2D());

/**
 * v6 `matrix.submatrix(id, from_row, to_row, from_column, to_column)` — a
 * fresh copy restricted to the `[inclusive, exclusive)` rectangle; bounds
 * default to the whole matrix.
 */
export const submatrix = <T>(
  id: PineMatrix<T>,
  fromRow = 0,
  toRow: number = Number.NaN,
  fromColumn = 0,
  toColumn: number = Number.NaN,
): PineMatrix<T> => {
  const height = id.rowCount();
  const width = id.columnCount();
  const rowEnd = Number.isNaN(toRow) ? height : toRow;
  const columnEnd = Number.isNaN(toColumn) ? width : toColumn;
  if (
    fromRow < 0 ||
    fromRow > height ||
    rowEnd < fromRow ||
    rowEnd > height ||
    fromColumn < 0 ||
    fromColumn > width ||
    columnEnd < fromColumn ||
    columnEnd > width
  ) {
    throw new RangeError(`Index ${fromRow} is out of bounds. Matrix size is ${height}x${width}`);
  }
  const extracted = id.backing.rows
    .slice(fromRow, rowEnd)
    .map((rowValues) => rowValues.slice(fromColumn, columnEnd));
  return PineMatrix.fromRows(extracted);
};

/**
 * v6 `matrix.concat(id1, id2)` — appends `id2`'s rows onto `id1` (which is
 * mutated and returned), requiring identical column counts.
 */
export const concat = <T>(id1: PineMatrix<T>, id2: PineMatrix<T>): PineMatrix<T> => {
  id1.appendRows(id2.backing.rows);
  return id1;
};

/**
 * v6 `matrix.reshape(id, rows, columns)` — rebuilds to the new dimensions
 * in place, preserving row-major element order; the element count must
 * match.
 */
export const reshape = <T>(id: PineMatrix<T>, rowsCount: number, columnsCount: number): void => {
  id.reshape(rowsCount, columnsCount);
};

/**
 * v6 `matrix.reverse(id)` — the first row and column become the last, and
 * the last become the first (in place).
 */
export const reverse = <T>(id: PineMatrix<T>): void => {
  id.reverse();
};

/**
 * v6 `matrix.sort(id, column, order)` — rearranges the rows following the
 * sorted order of `column`'s values (defaults: column 0, ascending). Rows
 * whose key is `na` sink to the end in either direction.
 */
export const sort = <T>(
  id: PineMatrix<T>,
  column = 0,
  sortOrder: SortOrder = order.ascending,
): void => {
  id.sortInPlace(column, sortOrder);
};
