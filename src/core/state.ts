export interface PersistentCell<T> {
  readonly name: string;
  readonly value: T;
  set(value: T): void;
  reset(): void;
}

class Cell<T> implements PersistentCell<T> {
  public constructor(public readonly name: string, private readonly initial: T, private current: T) {}
  public get value(): T { return this.current; }
  public set(value: T): void { this.current = value; }
  public reset(): void { this.current = this.initial; }
}

export type PineStateSnapshot = ReadonlyMap<string, unknown>;

export class PineState {
  private readonly vars = new Map<string, Cell<unknown>>();
  private readonly varips = new Map<string, Cell<unknown>>();

  public var<T>(name: string, initializer: () => T): PersistentCell<T> {
    let cell = this.vars.get(name) as Cell<T> | undefined;
    if (!cell) {
      const value = initializer();
      cell = new Cell(name, value, value);
      this.vars.set(name, cell as Cell<unknown>);
    }
    return cell;
  }

  public varip<T>(name: string, initializer: () => T): PersistentCell<T> {
    let cell = this.varips.get(name) as Cell<T> | undefined;
    if (!cell) {
      const value = initializer();
      cell = new Cell(name, value, value);
      this.varips.set(name, cell as Cell<unknown>);
    }
    return cell;
  }

  /** Snapshot `var` state. `varip` is intentionally excluded from rollback. */
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
