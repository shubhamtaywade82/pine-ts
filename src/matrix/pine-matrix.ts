import { PineArray } from "../array/pine-array.js";

/**
 * Pine Script v6 Matrix collection with realtime rollback support.
 */
export class PineMatrix<T> {
  private data: T[][];
  private committed: T[][];
  private numRows: number;
  private numCols: number;

  public constructor(rows = 0, columns = 0, initialValue?: T) {
    this.numRows = rows;
    this.numCols = columns;
    this.data = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => initialValue as T),
    );
    this.committed = this.data.map((r) => [...r]);
  }

  public rows(): number {
    return this.numRows;
  }

  public columns(): number {
    return this.numCols;
  }

  public elements_count(): number {
    return this.numRows * this.numCols;
  }

  public get(row: number, column: number): T {
    this.assertBounds(row, column);
    return this.data[row]![column]!;
  }

  public set(row: number, column: number, value: T): void {
    this.assertBounds(row, column);
    this.data[row]![column] = value;
  }

  public fill(value: T, fromRow = 0, toRow?: number, fromCol = 0, toCol?: number): void {
    const rStart = Math.max(0, fromRow);
    const rEnd = Math.min(this.numRows, toRow ?? this.numRows);
    const cStart = Math.max(0, fromCol);
    const cEnd = Math.min(this.numCols, toCol ?? this.numCols);
    for (let r = rStart; r < rEnd; r++) {
      for (let c = cStart; c < cEnd; c++) {
        this.data[r]![c] = value;
      }
    }
  }

  public row(index: number): PineArray<T> {
    this.assertRow(index);
    return new PineArray<T>([...this.data[index]!]);
  }

  public col(index: number): PineArray<T> {
    this.assertCol(index);
    return new PineArray<T>(this.data.map((r) => r[index]!));
  }

  public add_row(index: number, arr: PineArray<T>): void {
    if (this.numCols === 0 && this.numRows === 0) {
      this.numCols = arr.size();
    } else if (arr.size() !== this.numCols) {
      throw new RangeError(`Row size ${arr.size()} does not match columns ${this.numCols}`);
    }
    const insertIdx = Math.max(0, Math.min(this.numRows, index));
    this.data.splice(insertIdx, 0, [...arr.toArray()]);
    this.numRows++;
  }

  public add_col(index: number, arr: PineArray<T>): void {
    if (this.numRows === 0 && this.numCols === 0) {
      this.numRows = arr.size();
      this.data = Array.from({ length: this.numRows }, () => []);
    } else if (arr.size() !== this.numRows) {
      throw new RangeError(`Column size ${arr.size()} does not match rows ${this.numRows}`);
    }
    const insertIdx = Math.max(0, Math.min(this.numCols, index));
    const items = arr.toArray();
    for (let r = 0; r < this.numRows; r++) {
      this.data[r]!.splice(insertIdx, 0, items[r]!);
    }
    this.numCols++;
  }

  public remove_row(index: number): PineArray<T> {
    this.assertRow(index);
    const [removed] = this.data.splice(index, 1);
    this.numRows--;
    return new PineArray<T>(removed);
  }

  public remove_col(index: number): PineArray<T> {
    this.assertCol(index);
    const removed: T[] = [];
    for (let r = 0; r < this.numRows; r++) {
      removed.push(this.data[r]!.splice(index, 1)[0]!);
    }
    this.numCols--;
    return new PineArray<T>(removed);
  }

  public swap_rows(row1: number, row2: number): void {
    this.assertRow(row1);
    this.assertRow(row2);
    const tmp = this.data[row1]!;
    this.data[row1] = this.data[row2]!;
    this.data[row2] = tmp;
  }

  public swap_columns(col1: number, col2: number): void {
    this.assertCol(col1);
    this.assertCol(col2);
    for (let r = 0; r < this.numRows; r++) {
      const tmp = this.data[r]![col1]!;
      this.data[r]![col1] = this.data[r]![col2]!;
      this.data[r]![col2] = tmp;
    }
  }

  public copy(): PineMatrix<T> {
    const copyMat = new PineMatrix<T>(this.numRows, this.numCols);
    copyMat.data = this.data.map((r) => [...r]);
    copyMat.committed = copyMat.data.map((r) => [...r]);
    return copyMat;
  }

  public concat(other: PineMatrix<T>): PineMatrix<T> {
    if (this.numCols !== other.numCols) {
      throw new RangeError("Matrix column counts must match to concatenate rows");
    }
    const result = new PineMatrix<T>(this.numRows + other.numRows, this.numCols);
    result.data = [...this.data.map((r) => [...r]), ...other.data.map((r) => [...r])];
    return result;
  }

  public submatrix(fromRow = 0, toRow?: number, fromCol = 0, toCol?: number): PineMatrix<T> {
    const rStart = Math.max(0, fromRow);
    const rEnd = Math.min(this.numRows, toRow ?? this.numRows);
    const cStart = Math.max(0, fromCol);
    const cEnd = Math.min(this.numCols, toCol ?? this.numCols);
    const newRows = Math.max(0, rEnd - rStart);
    const newCols = Math.max(0, cEnd - cStart);
    const result = new PineMatrix<T>(newRows, newCols);
    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        result.data[r]![c] = this.data[rStart + r]![cStart + c]!;
      }
    }
    return result;
  }

  public reshape(rows: number, columns: number): void {
    if (rows * columns !== this.elements_count()) {
      throw new RangeError(
        `Cannot reshape ${this.elements_count()} elements into ${rows}x${columns}`,
      );
    }
    const flat = this.flat();
    this.numRows = rows;
    this.numCols = columns;
    this.data = Array.from({ length: rows }, (_, r) => flat.slice(r * columns, (r + 1) * columns));
  }

  public reverse(): void {
    const flat = this.flat().reverse();
    this.data = Array.from({ length: this.numRows }, (_, r) =>
      flat.slice(r * this.numCols, (r + 1) * this.numCols),
    );
  }

  public sort(column = 0, order: "asc" | "desc" = "asc"): void {
    this.assertCol(column);
    const isAsc = order === "asc";
    this.data.sort((rA, rB) => {
      const a = rA[column]!;
      const b = rB[column]!;
      if (typeof a === "number" && typeof b === "number") {
        return isAsc ? a - b : b - a;
      }
      return isAsc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
    });
  }

  public flat(): T[] {
    const result: T[] = [];
    for (const r of this.data) {
      result.push(...r);
    }
    return result;
  }

  public raw(): T[][] {
    return this.data;
  }

  public _commit(): void {
    this.committed = this.data.map((r) => [...r]);
  }

  public _rollback(): void {
    this.data = this.committed.map((r) => [...r]);
    this.numRows = this.data.length;
    this.numCols = this.data[0]?.length ?? 0;
  }

  private assertBounds(row: number, col: number): void {
    this.assertRow(row);
    this.assertCol(col);
  }

  private assertRow(row: number): void {
    if (!Number.isInteger(row) || row < 0 || row >= this.numRows) {
      throw new RangeError(`Row index out of bounds: ${row} (rows: ${this.numRows})`);
    }
  }

  private assertCol(col: number): void {
    if (!Number.isInteger(col) || col < 0 || col >= this.numCols) {
      throw new RangeError(`Column index out of bounds: ${col} (cols: ${this.numCols})`);
    }
  }
}
