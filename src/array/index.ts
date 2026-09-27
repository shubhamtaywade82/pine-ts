import { PineArray } from "./pine-array.js";

export { PineArray } from "./pine-array.js";
export * from "./search.js";
export * from "./statistics.js";

/** Creates a new float array with optional size and initial fill value. */
export const new_float = (size = 0, initial_value?: number): PineArray<number> =>
  new PineArray<number>(new Array<number>(size).fill(initial_value ?? Number.NaN));

/** Creates a new int array with optional size and initial fill value. */
export const new_int = (size = 0, initial_value?: number): PineArray<number> =>
  new PineArray<number>(new Array<number>(size).fill(initial_value ?? Number.NaN));

/** Creates a new boolean array with optional size and initial fill value. */
export const new_bool = (size = 0, initial_value = false): PineArray<boolean> =>
  new PineArray<boolean>(new Array<boolean>(size).fill(initial_value));

/** Creates a new string array with optional size and initial fill value. */
export const new_string = (size = 0, initial_value = ""): PineArray<string> =>
  new PineArray<string>(new Array<string>(size).fill(initial_value));

/** Creates a new color array with optional size and initial fill value. */
export const new_color = (size = 0, initial_value = ""): PineArray<string> =>
  new PineArray<string>(new Array<string>(size).fill(initial_value));

/** Creates a new line array with optional size and initial fill value. */
export const new_line = (size = 0, initial_value: unknown = null): PineArray<unknown> =>
  new PineArray<unknown>(new Array<unknown>(size).fill(initial_value));

/** Creates a new linefill array with optional size and initial fill value. */
export const new_linefill = (size = 0, initial_value: unknown = null): PineArray<unknown> =>
  new PineArray<unknown>(new Array<unknown>(size).fill(initial_value));

/** Creates a new label array with optional size and initial fill value. */
export const new_label = (size = 0, initial_value: unknown = null): PineArray<unknown> =>
  new PineArray<unknown>(new Array<unknown>(size).fill(initial_value));

/** Creates a new box array with optional size and initial fill value. */
export const new_box = (size = 0, initial_value: unknown = null): PineArray<unknown> =>
  new PineArray<unknown>(new Array<unknown>(size).fill(initial_value));

/** Creates a new table array with optional size and initial fill value. */
export const new_table = (size = 0, initial_value: unknown = null): PineArray<unknown> =>
  new PineArray<unknown>(new Array<unknown>(size).fill(initial_value));

/** Creates a new array populated with the given arguments. */
export const from = <T>(...elements: readonly T[]): PineArray<T> => new PineArray<T>(elements);

/** Returns the number of elements in the array. */
export const size = <T>(id: PineArray<T>): number => id.size();

/** Returns the element at the specified index. */
export const get = <T>(id: PineArray<T>, index: number): T => id.get(index);

/** Sets the element at the specified index. */
export const set = <T>(id: PineArray<T>, index: number, value: T): void => {
  id.set(index, value);
};

/** Appends an element to the end of the array. */
export const push = <T>(id: PineArray<T>, value: T): void => {
  id.push(value);
};

/** Removes and returns the last element of the array. */
export const pop = <T>(id: PineArray<T>): T => id.pop();

/** Adds an element to the beginning of the array. */
export const unshift = <T>(id: PineArray<T>, value: T): void => {
  id.unshift(value);
};

/** Removes and returns the first element of the array. */
export const shift = <T>(id: PineArray<T>): T => id.shift();

/** Inserts an element at the specified index. */
export const insert = <T>(id: PineArray<T>, index: number, value: T): void => {
  id.insert(index, value);
};

/** Removes and returns the element at the specified index. */
export const remove = <T>(id: PineArray<T>, index: number): T => id.remove(index);

/** Removes all elements from the array. */
export const clear = <T>(id: PineArray<T>): void => {
  id.clear();
};

/** Returns a shallow copy of a slice of the array. */
export const slice = <T>(id: PineArray<T>, index_from = 0, index_to?: number): PineArray<T> =>
  id.slice(index_from, index_to);

/** Returns a shallow copy of the array. */
export const copy = <T>(id: PineArray<T>): PineArray<T> => id.copy();

/** Concatenates two arrays into a new array. */
export const concat = <T>(id1: PineArray<T>, id2: PineArray<T>): PineArray<T> => id1.concat(id2);

/** Fills array elements in the specified range with a value. */
export const fill = <T>(id: PineArray<T>, value: T, index_from = 0, index_to?: number): void => {
  id.fill(value, index_from, index_to);
};

/** Returns the first element of the array. */
export const first = <T>(id: PineArray<T>): T => id.first();

/** Returns the last element of the array. */
export const last = <T>(id: PineArray<T>): T => id.last();
