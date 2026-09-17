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
  ) {}

  public get value(): T {
    return this.current;
  }

  public set(value: T): void {
    this.current = value;
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

export class PineState {
  private readonly vars = new Map<string, Cell<unknown>>();
  private readonly varips = new Map<string, Cell<unknown>>();

  public var<T>(name: string, initializer: () => T): PersistentCell<T> {
    const existing = this.vars.get(name);
    if (existing !== undefined) return existing;

    const value = initializer();
    const cell = new Cell(name, value, value);
    this.vars.set(name, cell);
    return cell;
  }

  public varip<T>(name: string, initializer: () => T): PersistentCell<T> {
    const existing = this.varips.get(name);
    if (existing !== undefined) return existing;

    const value = initializer();
    const cell = new Cell(name, value, value);
    this.varips.set(name, cell);
    return cell;
  }

  public rollback(): void {
    for (const cell of this.vars.values()) cell._rollback();
  }

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
