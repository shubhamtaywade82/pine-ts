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
 * On every confirmed bar a session-owned series commits exactly one value, so
 * history offsets mean "n bars ago" unconditionally, the same way Pine series
 * indexing does:
 *
 * - source series commit the pushed bar value;
 * - node-backed series whose call executed on the bar (resolved through the
 *   node registry or evaluated) commit the node's value and advance the
 *   node's state;
 * - node-backed series whose call did NOT execute on the bar carry their last
 *   committed value forward without advancing node state. This is Pine's
 *   local-scope rule: a call inside a branch that did not run commits no new
 *   state, and `x[n]` returns "the last committed value as of the bar at the
 *   specified offset".
 *
 * Committed history is bounded by the session's `maxBarsBack` (Pine's
 * `max_bars_back`, at most 5000): offsets beyond it raise a RangeError, the
 * equivalent of Pine runtime error RE10143.
 */
export class Series<T> {
  public readonly id: number;
  private committedValues: T[] = [];
  private workingValue: T | undefined;
  private hasWorkingValue = false;
  private workingRevision = -1;
  private committedRevision = -1;
  private executedRevision = -1;

  public constructor(
    private readonly session: PineSession | undefined = undefined,
    private readonly node: SeriesNode<T> | undefined = undefined,
  ) {
    // Ids are only meaningful inside one session's node keys; session-less
    // series never participate in node keys.
    this.id = session?.allocateSeriesId() ?? 0;
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
    const limit = this.session?.maxBarsBack;
    if (limit !== undefined && offset > limit) {
      throw new RangeError(
        `Series history offset ${offset} exceeds max_bars_back (${limit}); raise RuntimeOptions.maxBarsBack`,
      );
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
      this.executedRevision = revision;
      this.workingValue = this.node.evaluate();
      this.hasWorkingValue = true;
      this.workingRevision = revision;
    }
    if (this.hasWorkingValue) return this.workingValue;
    return this.committedValues[this.committedValues.length - 1];
  }

  /** Retained committed history, oldest first (bounded by `maxBarsBack + 1`). */
  public history(): readonly T[] {
    const limit = this.session?.maxBarsBack;
    if (limit === undefined || this.committedValues.length <= limit + 1)
      return this.committedValues;
    return this.committedValues.slice(-(limit + 1));
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

  /** Truncates the retained committed history to `length` values. */
  public truncate(length: number): void {
    const retained = this.history();
    if (!Number.isInteger(length) || length < 0 || length > retained.length) {
      throw new RangeError("Invalid series truncate length");
    }
    this.committedValues = retained.slice(0, length);
  }

  /** Reads the retained committed history by position, oldest first. */
  public get(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError("Series index must be a non-negative integer");
    }
    return this.history()[index];
  }

  public toArray(): readonly T[] {
    return this.history();
  }

  public _push(value: T): void {
    if (this.session === undefined) throw new Error("Source mutation requires a PineSession");
    this.workingValue = value;
    this.hasWorkingValue = true;
    this.workingRevision = this.session.revision;
  }

  /** Records that the call backing this series executed on the current revision. */
  public _markExecuted(): void {
    if (this.session !== undefined) this.executedRevision = this.session.revision;
  }

  public _commit(): void {
    if (this.session !== undefined && this.node !== undefined && !this.hasWorkingValue) {
      if (this.executedRevision !== this.session.revision) {
        this.carryForward();
        return;
      }
      // Executed but never read: evaluate now. Dependencies still hold their
      // working values because the session commits in reverse registration
      // order, so this observes the same state as during script execution.
      this.currentValue();
    }
    if (!this.hasWorkingValue) return;
    this.appendCommitted(this.workingValue as T);
    if (this.session !== undefined) this.committedRevision = this.session.revision;
    this.node?.commit();
  }

  private carryForward(): void {
    if (this.session === undefined) return;
    this.appendCommitted(this.committedValues.at(-1) as T);
    this.committedRevision = this.session.revision;
  }

  private appendCommitted(value: T): void {
    this.committedValues.push(value);
    const limit = this.session?.maxBarsBack;
    // Amortized trim: keep the newest `limit + 1` values (current committed
    // bar plus `limit` bars of history) once the buffer doubles.
    if (limit !== undefined && this.committedValues.length > 2 * (limit + 1)) {
      this.committedValues = this.committedValues.slice(-(limit + 1));
    }
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
