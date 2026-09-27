/**
 * Persistent script variable cell.
 *
 * - `var` cells roll back to their committed value on every realtime
 *   revision and promote on bar confirmation: at bar open the value equals
 *   the last confirmed bar's final value, exactly as in historical
 *   execution.
 * - `varip` cells are never rolled back: intrabar updates persist
 *   immediately across ticks and bars (Pine `varip` semantics).
 */
export interface PersistentCell<T> {
  readonly name: string;
  readonly value: T;
  set(value: T): void;
  reset(): void;
  _rollback(): void;
  _commit(): void;
}

class Cell<T> implements PersistentCell<T> {
  public constructor(
    public readonly name: string,
    private readonly initial: T,
    private current: T,
    private committed: T = current,
    private readonly onSet?: (value: T) => void,
  ) {}

  public get value(): T {
    return this.current;
  }

  public set(value: T): void {
    this.current = value;
    this.onSet?.(value);
  }

  public reset(): void {
    this.current = this.initial;
    this.committed = this.initial;
  }

  public _rollback(): void {
    this.current = this.committed;
  }

  public _commit(): void {
    this.committed = this.current;
  }
}

export type PineStateSnapshot = ReadonlyMap<string, unknown>;

/**
 * Duck-typed rollback-exemption hook for mutable reference values stored in
 * persistent cells. Pine arrays implement `_setVarip` so that a `varip` cell
 * (whose value survives realtime revisions without rollback) can promote the
 * backing store it references: subsequent mutations skip the session's
 * mutation journal, and mutations recorded before the promotion are made
 * permanent. `var` cells mark with `false` to (re)enable journaling, keeping
 * the assignment boundary symmetric.
 */
const markValue = (value: unknown, varip: boolean): void => {
  const marker = value as { _setVarip?: (enabled: boolean) => void } | null;
  if (
    typeof marker === "object" &&
    marker !== null &&
    typeof marker._setVarip === "function"
  ) {
    marker._setVarip(varip);
  }
};

export class PineState {
  private readonly vars = new Map<string, Cell<unknown>>();
  private readonly varips = new Map<string, Cell<unknown>>();

  public var<T>(name: string, initializer: () => T): PersistentCell<T> {
    const existing = this.vars.get(name);
    if (existing !== undefined) return existing as PersistentCell<T>;

    const value = initializer();
    markValue(value, false);
    const cell = new Cell<T>(name, value, value, undefined, (next) => markValue(next, false));
    this.vars.set(name, cell as unknown as Cell<unknown>);
    return cell;
  }

  public varip<T>(name: string, initializer: () => T): PersistentCell<T> {
    const existing = this.varips.get(name);
    if (existing !== undefined) return existing as PersistentCell<T>;

    const value = initializer();
    markValue(value, true);
    const cell = new Cell<T>(name, value, value, undefined, (next) => markValue(next, true));
    this.varips.set(name, cell as unknown as Cell<unknown>);
    return cell;
  }

  /** Restores `var` cells to their committed values. `varip` cells are intentionally untouched. */
  public rollback(): void {
    for (const cell of this.vars.values()) cell._rollback();
  }

  /** Promotes `var` cells to their working values on bar confirmation. */
  public commit(): void {
    for (const cell of this.vars.values()) cell._commit();
  }

  public snapshot(): PineStateSnapshot {
    return new Map([...this.vars.entries()].map(([name, cell]) => [name, cell.value]));
  }

  public restore(snapshot: PineStateSnapshot): void {
    for (const [name, value] of snapshot) this.vars.get(name)?.set(value);
  }

  public reset(): void {
    for (const cell of this.vars.values()) cell.reset();
    for (const cell of this.varips.values()) cell.reset();
  }
}
