/**
 * Runtime node contract for every derived series in the session graph.
 *
 * A node participates in a three-phase, per-bar state machine:
 *
 * ```text
 * committed node state
 *        |
 *        v
 * evaluate()  -> working value (may run many times per bar, one per revision)
 *        |
 *        v
 * rollback()  -> restore committed node state (realtime revision discarded)
 *        |
 *        v
 * evaluate()  -> new working value for the revised tick
 *        |
 *        v
 * commit()    -> promote working state to committed (bar confirmed)
 * ```
 *
 * The contract that makes rollback sound:
 *
 * - `evaluate` MUST NOT permanently mutate committed state. It may compute
 *   anything from its arguments, the session's series history, and a
 *   read-only view of its own state, but by the time it returns, a
 *   subsequent `evaluate` with the same inputs must produce the same value.
 * - `commit` advances node state exactly once per confirmed bar. It is only
 *   called by the session's bar-confirmation step, never during evaluation.
 * - `rollback` restores the node to its last committed state. For the
 *   standard {@link IndicatorDef} pattern — state mutated only inside
 *   `commit` — committed state is never left, so rollback is a no-op hook.
 *   Nodes that keep working state must implement it explicitly.
 *
 * The session enforces the phases; the replay-equivalence invariant
 * (historical run == realtime ticks + rollback + final commit) in
 * `tests/invariants.test.ts` verifies every built-in node honors them.
 */
export interface SeriesNode<T> {
  evaluate(): T;
  commit(): void;
  rollback(): void;
}

export interface IndicatorDef<State, Output> {
  readonly warmupBars?: number;
  init(): State;
  evaluate(state: Readonly<State>): Output;
  commit(state: State): void;
}

export class IndicatorNode<State, Output> implements SeriesNode<Output> {
  private readonly state: State;

  public constructor(private readonly definition: IndicatorDef<State, Output>) {
    this.state = definition.init();
  }

  public evaluate(): Output {
    return this.definition.evaluate(this.state);
  }

  public commit(): void {
    this.definition.commit(this.state);
  }

  /**
   * No-op by construction: IndicatorDef state only mutates inside `commit`,
   * so committed state is never left during evaluation. The hook exists so
   * the session can drive the explicit state machine uniformly and so nodes
   * with working state can opt into real restoration.
   */
  public rollback(): void {
    // Intentionally empty — see class-level contract.
  }

  public get warmupBars(): number {
    return this.definition.warmupBars ?? 0;
  }
}
