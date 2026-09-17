import type { PineSession } from "./session.js";
import type { SeriesNode } from "./series-node.js";

export class Series<T> {
  private static nextId = 1;

  public readonly id = Series.nextId++;
  private readonly committedValues: T[] = [];
  private workingValue?: T;
  private workingRevision = -1;

  public constructor(
    private readonly session?: PineSession,
    private readonly node?: SeriesNode<T>,
  ) {
    session?.registerSeries(this);
  }

  public get current(): T | undefined {
    return this.at(0);
  }

  public get value(): T | undefined {
    return this.at(0);
  }

  public get length(): number {
    return this.committedValues.length + (this.workingValue === undefined ? 0 : 1);
  }

  public at(offset: number): T | undefined {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError("Series history offset must be a non-negative integer");
    }

    if (offset === 0) {
      const revision = this.session?.revision ?? 0;
      if (this.workingRevision !== revision) {
        this.workingValue = this.node?.evaluate();
        this.workingRevision = revision;
      }
      return this.workingValue;
    }

    const index = this.committedValues.length - offset;
    return index < 0 ? undefined : this.committedValues[index];
  }

  public history(): readonly T[] {
    return this.committedValues;
  }

  public push(value: T): void {
    this.workingValue = value;
    this.workingRevision = this.session?.revision ?? 0;
    if (this.session === undefined) this.committedValues.push(value);
  }

  public replaceCurrent(value: T): void {
    this.workingValue = value;
    this.workingRevision = this.session?.revision ?? 0;
    if (this.session === undefined) {
      if (this.committedValues.length === 0) this.committedValues.push(value);
      else this.committedValues[this.committedValues.length - 1] = value;
    }
  }

  public truncate(length: number): void {
    if (!Number.isInteger(length) || length < 0 || length > this.committedValues.length) {
      throw new RangeError("Invalid series truncate length");
    }
    this.committedValues.length = length;
  }

  public get(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError("Series index must be a non-negative integer");
    }
    return this.committedValues[index];
  }

  public toArray(): readonly T[] {
    return this.committedValues;
  }

  public _push(value: T): void {
    if (this.session === undefined) throw new Error("Source mutation requires a PineSession");
    this.workingValue = value;
    this.workingRevision = this.session.revision;
  }

  public _commit(): void {
    const value = this.at(0);
    if (value !== undefined) this.committedValues.push(value);
    this.node?.commit();
  }

  public _resetWorking(): void {
    this.workingValue = undefined;
    this.workingRevision = -1;
  }

  public get runtime(): PineSession | undefined {
    return this.session;
  }
}

export class FloatSeries extends Series<number> {
  public valueOf(): number {
    return this.at(0) ?? Number.NaN;
  }
}

export function createSeries<T>(seed?: Iterable<T>): Series<T>;
export function createSeries<T>(session: PineSession, seed?: Iterable<T>): Series<T>;
export function createSeries<T>(
  sessionOrSeed?: PineSession | Iterable<T>,
  seed?: Iterable<T>,
): Series<T> {
  const isSession =
    typeof sessionOrSeed === "object" &&
    sessionOrSeed !== null &&
    "registerSeries" in sessionOrSeed;
  const session = isSession ? (sessionOrSeed as PineSession) : undefined;
  const values = isSession ? seed : sessionOrSeed;
  const series = new Series<T>(session);

  if (values !== undefined) {
    for (const value of values) series.push(value);
  }
  return series;
}

export const createFloatSeries = (session: PineSession): FloatSeries => new FloatSeries(session);
