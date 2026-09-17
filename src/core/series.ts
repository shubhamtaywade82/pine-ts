export interface Series<T> {
  readonly current: T | undefined;
  at(offset: number): T | undefined;
  readonly length: number;
  push(value: T): void;
  replaceCurrent(value: T): void;
  truncate(length: number): void;
  get(index: number): T | undefined;
  toArray(): readonly T[];
}

class MutableSeries<T> implements Series<T> {
  private readonly values: T[] = [];

  public get current(): T | undefined { return this.values[this.values.length - 1]; }
  public get length(): number { return this.values.length; }

  public at(offset: number): T | undefined {
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError("Series history offset must be a non-negative integer");
    return this.values[this.values.length - 1 - offset];
  }

  public push(value: T): void { this.values.push(value); }

  public replaceCurrent(value: T): void {
    if (this.values.length === 0) this.values.push(value);
    else this.values[this.values.length - 1] = value;
  }

  public truncate(length: number): void {
    if (!Number.isInteger(length) || length < 0 || length > this.values.length) throw new RangeError("Invalid series truncate length");
    this.values.length = length;
  }

  public get(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0) throw new RangeError("Series index must be a non-negative integer");
    return this.values[index];
  }

  public toArray(): readonly T[] { return this.values; }
}

export function createSeries<T>(seed?: Iterable<T>): Series<T> {
  const series = new MutableSeries<T>();
  if (seed !== undefined) for (const value of seed) series.push(value);
  return series;
}
