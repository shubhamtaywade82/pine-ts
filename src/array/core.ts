import { isNa } from "../core/na.js";
import { PineArray } from "./pine-array.js";

/**
 * v6 `array.new_float(size, initial_value)` — note the float `na` element is
 * `NaN`; the generic/`new_int` constructors share the numeric representation.
 */
export type FloatArray = PineArray<number>;
export type IntArray = PineArray<number>;
export type BoolArray = PineArray<boolean>;
export type StringArray = PineArray<string>;

/**
 * Pine's `color` values in pine-ts are `#RRGGBB[AA]` strings until the
 * `color.*` namespace lands; color arrays therefore use the string backing.
 */
export type ColorArray = PineArray<string>;

/** The `na` element for a freshly sized array of each element type. */
const numericNa = Number.NaN;

export const newFloat = (size = 0, initialValue?: number): FloatArray => {
  validateSize(size);
  const array = PineArray.createRoot<number>();
  array.backing.data = Array.from({ length: size }, () => initialValue ?? numericNa);
  return array;
};

export const newInt = (size = 0, initialValue?: number): IntArray => {
  validateSize(size);
  const array = PineArray.createRoot<number>();
  array.backing.data = Array.from({ length: size }, () => initialValue ?? numericNa);
  return array;
};

export const newBool = (size = 0, initialValue?: boolean): BoolArray => {
  validateSize(size);
  const array = PineArray.createRoot<boolean>();
  array.backing.data = Array.from({ length: size }, (): boolean | undefined => initialValue);
  return array;
};

export const newString = (size = 0, initialValue?: string): StringArray => {
  validateSize(size);
  const array = PineArray.createRoot<string>();
  array.backing.data = Array.from({ length: size }, (): string | undefined => initialValue);
  return array;
};

export const newColor = (size = 0, initialValue?: string): ColorArray => {
  validateSize(size);
  const array = PineArray.createRoot<string>();
  array.backing.data = Array.from({ length: size }, (): string | undefined => initialValue);
  return array;
};

/**
 * v6 `array.new<type>(size, initial_value)`. The typed constructors above
 * pin the per-type `na` element (numbers use `NaN`); the generic form fills
 * with `undefined` when no initial value is supplied, so number arrays
 * should prefer `newFloat`/`newInt`.
 */
export const newArray = <T>(size = 0, initialValue?: T): PineArray<T> => {
  validateSize(size);
  const array = PineArray.createRoot<T>();
  array.backing.data = Array.from({ length: size }, (): T | undefined => initialValue);
  return array;
};

const validateSize = (size: number): void => {
  if (size < 0) throw new RangeError("Cannot create an array with a negative size");
  if (size > 100_000) throw new RangeError("Array is too large. Maximum size is 100000");
};

/** v6 `array.from(arg0, ...)` — infers the element type from its arguments. */
export const from = <T>(first: T, ...rest: (T | undefined)[]): PineArray<T> => {
  const array = PineArray.createRoot<T>();
  array.backing.data = [first, ...rest];
  return array;
};

/** v6 `array.copy(id)` — an independent shallow copy of the window. */
export const copy = <T>(id: PineArray<T>): PineArray<T> => PineArray.createRoot(id.toArray());

/** v6 `array.slice(id, index_from, index_to)` — a write-through view. */
export const slice = <T>(id: PineArray<T>, indexFrom: number, indexTo: number): PineArray<T> =>
  id.createView(indexFrom, indexTo);

/**
 * v6 `array.concat(id1, id2)` — pushes every element of `id2` onto `id1`
 * (mutating it, exactly as the reference documents) and returns `id1`.
 */
export const concat = <T>(id1: PineArray<T>, id2: PineArray<T>): PineArray<T> => {
  for (const element of id2.toArray()) id1.push(element);
  return id1;
};

/** v6 `array.size(id)`. */
export const size = <T>(id: PineArray<T>): number => id.size();

/** v6 `array.get(id, index)` — negative indices count back from the end. */
export const get = <T>(id: PineArray<T>, index: number): T | undefined => id.get(index);

/** v6 `array.set(id, index, value)`. */
export const set = <T>(id: PineArray<T>, index: number, value: T | undefined): void => {
  id.set(index, value);
};

/** v6 `array.push(id, value)`. */
export const push = <T>(id: PineArray<T>, value: T | undefined): void => {
  id.push(value);
};

/** v6 `array.unshift(id, value)`. */
export const unshift = <T>(id: PineArray<T>, value: T | undefined): void => {
  id.unshift(value);
};

/** v6 `array.pop(id)`. */
export const pop = <T>(id: PineArray<T>): T | undefined => id.pop();

/** v6 `array.shift(id)`. */
export const shift = <T>(id: PineArray<T>): T | undefined => id.shift();

/** v6 `array.insert(id, index, value)`. */
export const insert = <T>(id: PineArray<T>, index: number, value: T | undefined): void => {
  id.insert(index, value);
};

/** v6 `array.remove(id, index)`. */
export const remove = <T>(id: PineArray<T>, index: number): T | undefined => id.remove(index);

/** v6 `array.clear(id)`. */
export const clear = <T>(id: PineArray<T>): void => {
  id.clear();
};

/** v6 `array.fill(id, value, index_from, index_to)`. */
export const fill = <T>(
  id: PineArray<T>,
  value: T | undefined,
  indexFrom?: number,
  indexTo?: number,
): void => {
  id.fill(value, indexFrom, indexTo);
};

/** v6 `array.reverse(id)`. */
export const reverse = <T>(id: PineArray<T>): void => {
  id.reverse();
};

/** v6 `array.first(id)`. */
export const first = <T>(id: PineArray<T>): T | undefined => id.first();

/** v6 `array.last(id)`. */
export const last = <T>(id: PineArray<T>): T | undefined => id.last();

/**
 * na-aware element equality: `na` matches `na`, numbers match by value,
 * everything else by identity (`===`).
 */
const elementsEqual = <T>(left: T | undefined, right: T | undefined): boolean => {
  if (isNa(left as number | undefined) && isNa(right as number | undefined)) return true;
  return left === right;
};

/** v6 `array.includes(id, value)`. */
export const includes = <T>(id: PineArray<T>, value: T | undefined): boolean => {
  return id.toArray().some((element) => elementsEqual(element, value));
};

/** v6 `array.indexof(id, value)` — first match, or -1. */
export const indexof = <T>(id: PineArray<T>, value: T | undefined): number => {
  const elements = id.toArray();
  for (let index = 0; index < elements.length; index += 1) {
    if (elementsEqual(elements[index]!, value)) return index;
  }
  return -1;
};

/** v6 `array.lastindexof(id, value)` — last match, or -1. */
export const lastindexof = <T>(id: PineArray<T>, value: T | undefined): number => {
  const elements = id.toArray();
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (elementsEqual(elements[index]!, value)) return index;
  }
  return -1;
};

/**
 * Element truthiness for `every`/`some`: booleans pass through, numeric zero
 * is false, every non-zero number is true, and `na` elements are false (an
 * `na` condition is never true) — the v6 reference remarks.
 */
const isTruthyElement = (element: boolean | number | undefined): boolean => {
  if (typeof element === "boolean") return element;
  if (isNa(element)) return false;
  return element !== 0;
};

/** v6 `array.every(id)` — true when every element is truthy. */
export const every = (id: PineArray<boolean | number>): boolean => {
  return id.toArray().every(isTruthyElement);
};

/** v6 `array.some(id)` — true when at least one element is truthy. */
export const some = (id: PineArray<boolean | number>): boolean => {
  return id.toArray().some(isTruthyElement);
};

/**
 * v6 `array.join(id, separator)` — stringifies with `str.tostring` na
 * formatting: numeric `na` prints as `NaN`.
 */
export const join = (id: PineArray<number | string>, separator = ""): string => {
  return id
    .toArray()
    .map((element) =>
      typeof element === "number" ? floatToString(element) : element === undefined ? "NaN" : element,
    )
    .join(separator);
};

const floatToString = (value: number): string => {
  if (Number.isNaN(value)) return "NaN";
  return String(value);
};

/**
 * v6 `array.sort(id, order)` — numeric arrays by value, string arrays
 * lexicographically; `na` elements sink to the end in either direction.
 */
export const sort = (
  id: PineArray<number | string>,
  order: "ascending" | "descending" = "ascending",
): void => {
  id.sortInPlace(order);
};

/**
 * v6 `array.sort_indices(id, order)` — the index permutation that reads the
 * array in sorted order, with `na` element indices last. The array itself is
 * not modified.
 */
export const sort_indices = (
  id: PineArray<number | string>,
  order: "ascending" | "descending" = "ascending",
): PineArray<number> => {
  const elements = id.toArray();
  const indices = elements.map((_, index) => index);
  const direction = order === "descending" ? -1 : 1;
  const compareValues = (
    left: number | string | undefined,
    right: number | string | undefined,
  ): number => {
    const leftNa = isNa(left as number | undefined);
    const rightNa = isNa(right as number | undefined);
    if (leftNa && rightNa) return 0;
    if (leftNa) return 1;
    if (rightNa) return -1;
    if (typeof left === "number" && typeof right === "number") {
      return (left === right ? 0 : left < right ? -1 : 1) * direction;
    }
    const leftText = String(left);
    const rightText = String(right);
    return (leftText === rightText ? 0 : leftText < rightText ? -1 : 1) * direction;
  };
  indices.sort((left, right) => compareValues(elements[left]!, elements[right]!));
  return PineArray.createRoot<number>(indices);
};

/**
 * v6 `array.abs(id)` — a new array of element-wise absolute values with `na`
 * preserved. Per the v6 Arrays page rule, an empty or all-`na` input returns
 * `na` (an undefined array id) rather than an array.
 */
export const abs = (id: PineArray<number>): PineArray<number> | undefined => {
  const elements = id.toArray();
  const hasValue = elements.some((element) => !isNa(element));
  if (!hasValue) return undefined;
  return PineArray.createRoot<number>(
    elements.map((element) => (isNa(element) ? Number.NaN : Math.abs(element))),
  );
};
