export interface SeriesNode<T> {
  evaluate(): T;
  commit(): void;
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

  public get warmupBars(): number {
    return this.definition.warmupBars ?? 0;
  }
}
