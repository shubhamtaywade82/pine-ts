export class PineArray<T> implements Iterable<T> {
  private items: T[];
  private committed: T[];

  public constructor(initialValues: readonly T[] = []) {
    this.items = [...initialValues];
    this.committed = [...initialValues];
  }

  public size(): number {
    return this.items.length;
  }

  public get(index: number): T {
    this.assertValidIndex(index, false);
    return this.items[index]!;
  }

  public set(index: number, value: T): void {
    this.assertValidIndex(index, false);
    this.items[index] = value;
  }

  public push(value: T): void {
    this.items.push(value);
  }

  public pop(): T {
    if (this.items.length === 0) throw new RangeError("Cannot pop from an empty array");
    return this.items.pop()!;
  }

  public unshift(value: T): void {
    this.items.unshift(value);
  }

  public shift(): T {
    if (this.items.length === 0) throw new RangeError("Cannot shift from an empty array");
    return this.items.shift()!;
  }

  public insert(index: number, value: T): void {
    this.assertValidIndex(index, true);
    this.items.splice(index, 0, value);
  }

  public remove(index: number): T {
    this.assertValidIndex(index, false);
    const [removed] = this.items.splice(index, 1);
    return removed!;
  }

  public clear(): void {
    this.items.length = 0;
  }

  public slice(indexFrom = 0, indexTo?: number): PineArray<T> {
    const from = Math.max(0, indexFrom);
    const to = Math.min(this.items.length, indexTo ?? this.items.length);
    return new PineArray<T>(this.items.slice(from, to));
  }

  public copy(): PineArray<T> {
    return new PineArray<T>([...this.items]);
  }

  public concat(other: PineArray<T>): PineArray<T> {
    return new PineArray<T>([...this.items, ...other.items]);
  }

  public fill(value: T, indexFrom = 0, indexTo?: number): void {
    const from = Math.max(0, indexFrom);
    const to = Math.min(this.items.length, indexTo ?? this.items.length);
    for (let i = from; i < to; i++) {
      this.items[i] = value;
    }
  }

  public first(): T {
    if (this.items.length === 0) throw new RangeError("Cannot get first element of an empty array");
    return this.items[0]!;
  }

  public last(): T {
    if (this.items.length === 0) throw new RangeError("Cannot get last element of an empty array");
    return this.items[this.items.length - 1]!;
  }

  public toArray(): readonly T[] {
    return [...this.items];
  }

  public raw(): T[] {
    return this.items;
  }

  public _commit(): void {
    this.committed = [...this.items];
  }

  public _rollback(): void {
    this.items = [...this.committed];
  }

  public [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }

  private assertValidIndex(index: number, allowEnd: boolean): void {
    const max = allowEnd ? this.items.length : this.items.length - 1;
    if (!Number.isInteger(index) || index < 0 || index > max) {
      throw new RangeError(`Array index out of bounds: ${index} (size: ${this.items.length})`);
    }
  }
}
