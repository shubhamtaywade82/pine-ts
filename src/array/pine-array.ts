import { getCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";

/** The maximum number of elements any single Pine array may hold. */
export const MAX_ARRAY_SIZE = 100_000;

/**
 * Backing storage shared between a root array and every slice view taken
 * from it. Mutations made through any view write into `data` directly, which
 * is what makes Pine slices observe — and propagate — each other's changes.
 */
export class ArrayBacking<T> {
  public data: (T | undefined)[] = [];
  /** When true (varip promotion) mutations skip the session's undo journal. */
  public varip = false;
}

/**
 * A Pine `array<T>`: a mutable reference type whose in-place mutations are
 * journaled on the owning session so realtime revisions roll them back —
 * the array counterpart of a `var` cell restoring its committed value.
 *
 * A `PineArray` is a *view*: roots own their backing and derive their size
 * from it, while slices (`array.slice`) hold an absolute `[from, to)` window
 * into a parent's backing. Writes through a slice land in the parent at the
 * window position, and — exactly as the v6 reference documents — slice
 * windows are never remapped when the parent mutates, so a parent that
 * shrinks can leave a slice pointing outside its bounds.
 */
export class PineArray<T> {
  public readonly backing: ArrayBacking<T>;

  private readonly from: number;
  private to: number;
  private readonly root: boolean;

  private constructor(backing: ArrayBacking<T>, from: number, to: number, root: boolean) {
    this.backing = backing;
    this.from = from;
    this.to = to;
    this.root = root;
  }

  /** Creates a root array over a fresh backing store. */
  public static createRoot<T>(initial?: Iterable<T | undefined>): PineArray<T> {
    const backing = new ArrayBacking<T>();
    if (initial !== undefined) backing.data = [...initial];
    return new PineArray<T>(backing, 0, backing.data.length, true);
  }

  /**
   * Creates a slice view over this array's backing. `indexFrom`/`indexTo`
   * are window-relative and follow the v6 `array.slice` contract:
   * `0 <= indexFrom < size` and `indexFrom < indexTo <= size`.
   */
  public createView(indexFrom: number, indexTo: number): PineArray<T> {
    this.touch();
    const size = this.size();
    if (indexFrom < 0 || indexFrom >= size) {
      throw new RangeError(`Index ${indexFrom} is out of bounds. Array size is ${size}`);
    }
    if (indexTo <= indexFrom || indexTo > size) {
      throw new RangeError("Index 'from' should be less than index 'to'");
    }
    return new PineArray<T>(this.backing, this.from + indexFrom, this.from + indexTo, false);
  }

  /**
   * Marks this array — and, recursively, arrays held as elements — as a
   * `varip` collection: mutations stop journaling (and any already-journaled
   * mutations become permanent), so updates finalize on every tick.
   */
  public _setVarip(enabled: boolean): void {
    this.backing.varip = enabled;
    if (!enabled) return;
    const session = getCurrentSession();
    if (session !== undefined) session.purgeArrayMutations(this.backing);
    for (const element of this.backing.data) {
      if (element instanceof PineArray && !element.backing.varip) {
        element._setVarip(enabled);
      }
    }
  }

  /** Current element count. Slices derive it from their window. */
  public size(): number {
    this.touch();
    return this.root ? this.backing.data.length : this.to - this.from;
  }

  /** Reads the element at `index`; negative indices count back from the end. */
  public get(index: number): T | undefined {
    this.touch();
    return this.backing.data[this.from + this.resolveIndex(index)]!;
  }

  /** Writes the element at `index`; negative indices count back from the end. */
  public set(index: number, value: T | undefined): void {
    this.touch();
    const absolute = this.from + this.resolveIndex(index);
    const previous = this.backing.data[absolute];
    this.journal(() => {
      this.backing.data[absolute] = previous!;
    });
    this.backing.data[absolute] = value;
  }

  /** Appends `value` at the end of the window (the parent for slices). */
  public push(value: T | undefined): void {
    this.touch();
    this.insertWithin(this.root ? this.backing.data.length : this.to, value);
  }

  /** Prepends `value` at the start of the window. */
  public unshift(value: T | undefined): void {
    this.touch();
    this.insertWithin(this.from, value);
  }

  /** Removes and returns the last element. */
  public pop(): T | undefined {
    this.touch();
    if (this.size() === 0) throw new RangeError("Cannot use pop() if array is empty.");
    return this.removeWithin((this.root ? this.backing.data.length : this.to) - 1);
  }

  /** Removes and returns the first element. */
  public shift(): T | undefined {
    this.touch();
    if (this.size() === 0) throw new RangeError("Cannot use shift() if array is empty.");
    return this.removeWithin(this.from);
  }

  /** Inserts `value` before the element at `index` (negative counts back). */
  public insert(index: number, value: T | undefined): void {
    this.touch();
    const size = this.size();
    const resolved = index >= 0 ? index : size + index;
    if (resolved < 0 || resolved >= size) {
      throw new RangeError(`Index ${index} is out of bounds. Array size is ${size}`);
    }
    this.insertWithin(this.from + resolved, value);
  }

  /** Removes and returns the element at `index`. */
  public remove(index: number): T | undefined {
    this.touch();
    return this.removeWithin(this.from + this.resolveIndex(index));
  }

  /** Removes every element from the window. */
  public clear(): void {
    this.touch();
    const count = this.size();
    if (count === 0) return;
    const removed = this.backing.data.splice(this.from, count);
    const previousTo = this.to;
    this.journal(() => {
      this.backing.data.splice(this.from, 0, ...removed);
      this.to = previousTo;
    });
    this.to = this.from;
  }

  /** Writes `value` across `[indexFrom, indexTo)` (defaults: `0` to `size`). */
  public fill(value: T | undefined, indexFrom: number = 0, indexTo: number = Number.NaN): void {
    this.touch();
    const size = this.size();
    const end = isNa(indexTo) ? size : indexTo;
    if (indexFrom < 0 || indexFrom > size || end < indexFrom || end > size) {
      throw new RangeError(`Index ${indexFrom} is out of bounds. Array size is ${size}`);
    }
    if (end === indexFrom) return;
    const absoluteFrom = this.from + indexFrom;
    const previous = this.backing.data.slice(absoluteFrom, this.from + end);
    this.journal(() => {
      this.backing.data.splice(absoluteFrom, previous.length, ...previous);
    });
    this.backing.data.fill(value, absoluteFrom, this.from + end);
  }

  /** Reverses the window in place. */
  public reverse(): void {
    this.touch();
    const previous = this.snapshotWindow();
    this.journal(() => {
      this.restoreWindow(previous);
    });
    const data = this.backing.data;
    for (let left = this.from, right = this.to - 1; left < right; left += 1, right -= 1) {
      const swap = data[left]!;
      data[left] = data[right]!;
      data[right] = swap;
    }
  }

  /** The first element; a runtime error on an empty array. */
  public first(): T | undefined {
    this.touch();
    if (this.size() === 0) throw new RangeError("Cannot use first() if array is empty.");
    return this.backing.data[this.from]!;
  }

  /** The last element; a runtime error on an empty array. */
  public last(): T | undefined {
    this.touch();
    if (this.size() === 0) throw new RangeError("Cannot use last() if array is empty.");
    return this.backing.data[(this.root ? this.backing.data.length : this.to) - 1]!;
  }

  /** Snapshots the window contents (used by copy and undo entries). */
  public toArray(): (T | undefined)[] {
    this.touch();
    return this.root ? [...this.backing.data] : this.backing.data.slice(this.from, this.to);
  }

  /** Iterates the window contents in order. */
  public [Symbol.iterator](): Iterator<T | undefined> {
    return this.toArray()[Symbol.iterator]();
  }

  /**
   * Sorts the window in place with the v6 `array.sort` semantics: numeric
   * arrays compare by value, string arrays lexicographically, and `na`
   * elements always sink to the end regardless of the requested order.
   */
  public sortInPlace(order: "ascending" | "descending"): void {
    this.touch();
    const previous = this.snapshotWindow();
    this.journal(() => {
      this.restoreWindow(previous);
    });
    const direction = order === "descending" ? -1 : 1;
    const compare = (left: T | undefined, right: T | undefined): number => {
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
    const window = this.toArray();
    window.sort(compare);
    this.restoreWindowValues(window);
  }

  /**
   * Mutation hook for `varip` promotion: returns the backing token used as
   * the journal owner. Exposed for internal tooling.
   */
  public _backingOwner(): object {
    return this.backing;
  }

  /**
   * Validates that a slice window still lies inside its parent's backing.
   * The v6 reference documents that shrinking a parent can leave a slice
   * pointing outside it; any subsequent use of that slice raises
   * "Slice is out of bounds of the parent array".
   */
  private touch(): void {
    if (!this.root && this.to > this.backing.data.length) {
      throw new RangeError("Slice is out of bounds of the parent array");
    }
  }

  /**
   * Resolves a Pine index: non-negative counts forward from 0, negative
   * counts back from -1 (the last element), exactly as the v6 reference
   * specifies for `array.get`/`set`/`insert`/`remove`.
   */
  private resolveIndex(index: number): number {
    const size = this.size();
    const resolved = index >= 0 ? index : size + index;
    if (resolved < 0 || resolved >= size) {
      throw new RangeError(`Index ${index} is out of bounds. Array size is ${size}`);
    }
    return resolved;
  }

  private insertWithin(absolute: number, value: T | undefined): void {
    if (this.backing.data.length >= MAX_ARRAY_SIZE) {
      throw new RangeError(`Array is too large. Maximum size is ${MAX_ARRAY_SIZE}`);
    }
    this.backing.data.splice(absolute, 0, value);
    this.journal(() => {
      this.backing.data.splice(absolute, 1);
      if (!this.root) this.to -= 1;
    });
    if (!this.root) this.to += 1;
  }

  private removeWithin(absolute: number): T | undefined {
    const removed = this.backing.data.splice(absolute, 1)[0]!;
    this.journal(() => {
      this.backing.data.splice(absolute, 0, removed);
      if (!this.root) this.to += 1;
    });
    if (!this.root) this.to -= 1;
    return removed;
  }

  private journal(undo: () => void): void {
    const session = getCurrentSession();
    if (session === undefined || this.backing.varip) return;
    session.journalArrayMutation(this.backing, undo);
  }

  private snapshotWindow(): (T | undefined)[] {
    return this.root ? [...this.backing.data] : this.backing.data.slice(this.from, this.to);
  }

  private restoreWindow(previous: readonly (T | undefined)[]): void {
    if (this.root) {
      this.backing.data.length = 0;
      this.backing.data.push(...previous);
      return;
    }
    this.backing.data.splice(this.from, this.to - this.from, ...previous);
    this.to = this.from + previous.length;
  }

  private restoreWindowValues(sorted: readonly (T | undefined)[]): void {
    if (this.root) {
      this.backing.data.length = 0;
      this.backing.data.push(...sorted);
      return;
    }
    this.backing.data.splice(this.from, this.to - this.from, ...sorted);
  }
}
