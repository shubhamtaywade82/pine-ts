import type { PineArray } from "../array/pine-array.js";
import { PineMatrix } from "./pine-matrix.js";

export { PineMatrix } from "./pine-matrix.js";
export * from "./math.js";
export * from "./predicates.js";
export * from "./statistics.js";

/** Creates a new Pine Script matrix with optional dimensions and initial value. */
export const new_matrix = <T>(rows = 0, columns = 0, initial_value?: T): PineMatrix<T> =>
  new PineMatrix<T>(rows, columns, initial_value);

/** Returns the number of rows in the matrix. */
export const rows = <T>(id: PineMatrix<T>): number => id.rows();

/** Returns the number of columns in the matrix. */
export const columns = <T>(id: PineMatrix<T>): number => id.columns();

/** Returns the total number of elements in the matrix (rows * columns). */
export const elements_count = <T>(id: PineMatrix<T>): number => id.elements_count();

/** Returns the element at the specified row and column. */
export const get = <T>(id: PineMatrix<T>, row: number, column: number): T => id.get(row, column);

/** Sets the element at the specified row and column. */
export const set = <T>(id: PineMatrix<T>, row: number, column: number, value: T): void => {
  id.set(row, column, value);
};

/** Fills a sub-area of the matrix with a value. */
export const fill = <T>(
  id: PineMatrix<T>,
  value: T,
  from_row = 0,
  to_row?: number,
  from_column = 0,
  to_column?: number,
): void => {
  id.fill(value, from_row, to_row, from_column, to_column);
};

/** Returns an array containing the elements of the specified row. */
export const row = <T>(id: PineMatrix<T>, index: number): PineArray<T> => id.row(index);

/** Returns an array containing the elements of the specified column. */
export const col = <T>(id: PineMatrix<T>, index: number): PineArray<T> => id.col(index);

/** Inserts a row array at the specified index. */
export const add_row = <T>(id: PineMatrix<T>, index: number, array: PineArray<T>): void => {
  id.add_row(index, array);
};

/** Inserts a column array at the specified index. */
export const add_col = <T>(id: PineMatrix<T>, index: number, array: PineArray<T>): void => {
  id.add_col(index, array);
};

/** Removes and returns the row array at the specified index. */
export const remove_row = <T>(id: PineMatrix<T>, index: number): PineArray<T> =>
  id.remove_row(index);

/** Removes and returns the column array at the specified index. */
export const remove_col = <T>(id: PineMatrix<T>, index: number): PineArray<T> =>
  id.remove_col(index);

/** Swaps two rows in the matrix. */
export const swap_rows = <T>(id: PineMatrix<T>, row1: number, row2: number): void => {
  id.swap_rows(row1, row2);
};

/** Swaps two columns in the matrix. */
export const swap_columns = <T>(id: PineMatrix<T>, col1: number, col2: number): void => {
  id.swap_columns(col1, col2);
};

/** Returns a shallow copy of the matrix. */
export const copy = <T>(id: PineMatrix<T>): PineMatrix<T> => id.copy();

/** Concatenates two matrices vertically (attaches rows of id2 to id1). */
export const concat = <T>(id1: PineMatrix<T>, id2: PineMatrix<T>): PineMatrix<T> => id1.concat(id2);

/** Extracts a submatrix within the specified row and column boundaries. */
export const submatrix = <T>(
  id: PineMatrix<T>,
  from_row = 0,
  to_row?: number,
  from_column = 0,
  to_column?: number,
): PineMatrix<T> => id.submatrix(from_row, to_row, from_column, to_column);

/** Reshapes the matrix to new dimensions keeping total element count constant. */
export const reshape = <T>(id: PineMatrix<T>, rows: number, columns: number): void => {
  id.reshape(rows, columns);
};

/** Reverses the order of all elements in the matrix. */
export const reverse = <T>(id: PineMatrix<T>): void => {
  id.reverse();
};

/** Sorts the matrix rows according to the specified column and order. */
export const sort = <T>(id: PineMatrix<T>, column = 0, order: "asc" | "desc" = "asc"): void => {
  id.sort(column, order);
};
