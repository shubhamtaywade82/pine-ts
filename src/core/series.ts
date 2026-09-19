import type { PineSession } from "./session.js";
import type { SeriesNode } from "./series-node.js";

/**
 * A Pine-like time series owned by a {@link PineSession}.
 *
 * State machine (see docs/SEMANTICS.md for the full contract):
 *
 * - `committedValues` — closed bars only. This is the series history that
 *   `at(offset > 0)` reads and `history()` exposes.
 * - `workingValue` — the current bar's not-yet-confirmed value. Updated by
 *   source pushes, or lazily by evaluating the backing node.
 * - `workingRevision` — the session revision the working value was computed
 *   at. Whenever the session advances the revision (new bar or realtime
 *   tick), the next `at(0)` re-evaluates.
 * - `committedRevision` — the revision at which the last commit happened;
 *   distinguishes "current bar still open" from "bar confirmed" when
 *   resolving history offsets.
 *
 * On every confirmed bar a session-owned series commits exactly one value:
 * the working value if the script read it during the bar, otherwise the
 * node's evaluation at commit time. History offsets therefore mean "n bars
 * ago" unconditionally, the same way Pine series indexing does.
 */
export class Series<T> {
  private static nextId = 1;

  public readonly id: number = Series.nextId++;
  private readonly committedValues: T[] = [];
  private workingValue: T | undefined;
  private hasWorkingValue = false;
  private workingRevision = -1;
  private committedRevision = -1;

  public constructor(
    private readonly session: PineSession | undefined = undefined,
    private readonly node: SeriesNode<T> | undefined = undefined,
  ) {
    this.session?.registerSeries(this);
  }

  public get current(): T | undefined {
    return this.at(0);
  }

  public get value(): T | undefined {
    return this.at(0);
  }

  public get length(): number {
    return this.committedValues.length + (this.hasWorkingValue ? 1 : 0);
  }

  public at(offset: number): T | undefined {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError("Series history offset must be a non-negative integer");
    }

    if (offset === 0) return this.currentValue();

    // While the current bar is open, the newest committed value belongs to the
    // previous bar — even when the series has not evaluated a working value at
    // this revision yet (for example a node reading its own history mid
    // evaluation). Once the bar committed, or for standalone series without a
    // commit lifecycle, the newest committed value is the current value.
    const currentBarOpen =
      this.session !== undefined && this.committedRevision !== this.session.revision;
    const index = currentBarOpen
      ? this.committedValues.length - offset
      : this.committedValues.length - 1 - offset;
    return index < 0 ? undefined : this.committedValues[index];
  }

  private currentValue(): T | undefined {
    const revision = this.session?.revision ?? 0;
    // Derived series re-evaluate whenever the session revision advances, even
    // after a working-value reset, so historical bars never observe the stale
    // committed value from the previous bar.
    if (this.node !== undefined && this.workingRevision !== revision) {
      this.workingValue = this.node.evaluate();
      this.hasWorkingValue = true;
      this.workingRevision = revision;
    }
    if (this.hasWorkingValue) return this.workingValue;
    return this.committedValues[this.committedValues.length - 1];
  }

  public history(): readonly T[] {
    return this.committedValues;
  }

  public push(value: T): void {
    // Standalone (session-less) series have no commit lifecycle, so the pushed
    // value is immediately the committed current value.
    if (this.session === undefined) {
      this.committedValues.push(value);
      return;
    }
    this.workingValue = value;
    this.hasWorkingValue = true;
    this.workingRevision = this.session.revision;
  }

  public replaceCurrent(value: T): void {
    if (this.session === undefined) {
      if (this.committedValues.length === 0) this.committedValues.push(value);
      else this.committedValues[this.committedValues.length - 1] = value;
      return;
    }
    this.workingValue = value;
    this.hasWorkingValue = true;
    this.workingRevision = this.session.revision;
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
    this.hasWorkingValue = true;
    this.workingRevision = this.session.revision;
  }

  public _commit(): void {
    // Pine semantics: every session-owned series produces one committed
    // value per confirmed bar, even when the script did not read it during
    // the bar. Evaluating a node-backed series here keeps history offsets
    // aligned across all series in the graph. Dependencies still hold their
    // working values at this point because the session commits in reverse
    // registration order, so the evaluation observes the same dependency
    // state as during script execution.
    if (this.session !== undefined && this.node !== undefined && !this.hasWorkingValue) {
      this.currentValue();
    }
    if (!this.hasWorkingValue) return;
    this.committedValues.push(this.workingValue as T);
    if (this.session !== undefined) this.committedRevision = this.session.revision;
    this.node?.commit();
  }

  public _resetWorking(): void {
    this.workingValue = undefined;
    this.hasWorkingValue = false;
    this.workingRevision = -1;
  }

  /**
   * Realtime revision discard: drop the working value and restore the
   * backing node to its committed state. Committed history is untouched —
   * an unconfirmed tick never becomes visible in `at(offset > 0)`.
   */
  public _rollback(): void {
    this._resetWorking();
    this.node?.rollback();
  }

  public get runtime(): PineSession | undefined {
    return this.session;
  }
}

export class FloatSeries extends Series<number> {
  // `current`/`value` follow Pine float semantics: a missing value reads as `na`
  // (NaN). History offsets keep `undefined` so callers can distinguish missing
  // history from a computed na value.
  public override get current(): number {
    return this.at(0) ?? Number.NaN;
  }

  public override get value(): number {
    return this.at(0) ?? Number.NaN;
  }
}

export class BooleanSeries extends Series<boolean> {
  public override get current(): boolean {
    return this.at(0) ?? false;
  }

  public override get value(): boolean {
    return this.at(0) ?? false;
  }
}

export function createSeries<T>(seed?: Iterable<T>): Series<T>;
export function createSeries<T>(session: PineSession, seed?: Iterable<T>): Series<T>;
export function createSeries<T>(
  sessionOrSeed?: PineSession | Iterable<T>,
  seed?: Iterable<T>,
): Series<T> {
  const isSession = typeof sessionOrSeed === "object" && "registerSeries" in sessionOrSeed;
  const session = isSession ? sessionOrSeed : undefined;
  const values = isSession ? seed : sessionOrSeed;
  const series = new Series<T>(session);

  if (values !== undefined) {
    for (const value of values) series.push(value);
  }
  return series;
}

export const createFloatSeries = (session: PineSession): FloatSeries => new FloatSeries(session);
