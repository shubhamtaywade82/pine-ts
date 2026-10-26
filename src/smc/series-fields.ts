import { requireCurrentSession } from "../core/execution-context.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import type { PineSession } from "../core/session.js";
import { BooleanSeries, FloatSeries, Series } from "../core/series.js";

interface CarriedState<B> {
  previous: B | undefined;
}

/**
 * A per-bar record computed from the last committed record. `evaluate` may run
 * many times per realtime bar; only the confirmed bar's result is committed,
 * which is what makes rollback sound.
 */
export const carriedSeries = <B>(
  key: string,
  evaluate: (previous: B | undefined) => B,
): Series<B> => {
  const runtime = requireCurrentSession();
  return runtime.nodes.getOrCreate(key, () => {
    const next = (state: Readonly<CarriedState<B>>): B => evaluate(state.previous);
    return new Series<B>(
      runtime,
      new IndicatorNode<CarriedState<B>, B>({
        init: () => ({ previous: undefined }),
        evaluate: next,
        commit: (state) => {
          state.previous = next(state);
        },
      }),
    );
  });
};

const field = <B, T, S extends Series<T>>(
  source: Series<B>,
  label: string,
  pick: (bar: B | undefined) => T,
  create: (session: PineSession, node: IndicatorNode<null, T>) => S,
): S => {
  const runtime = requireCurrentSession();
  return runtime.nodes.getOrCreate(nodeKey(label, source), () =>
    create(
      runtime,
      new IndicatorNode({
        init: (): null => null,
        evaluate: () => pick(source.at(0)),
        commit: (): void => undefined,
      }),
    ),
  ) as S;
};

/** One numeric field of `source`'s current record; na while there is none. */
export const floatField = <B>(
  source: Series<B>,
  label: string,
  pick: (bar: B) => number,
): FloatSeries =>
  field(
    source,
    label,
    (bar) => (bar === undefined ? Number.NaN : pick(bar)),
    (session, node) => new FloatSeries(session, node),
  );

/** One boolean field of `source`'s current record; false while there is none (a v6 bool is never na). */
export const flagField = <B>(
  source: Series<B>,
  label: string,
  pick: (bar: B) => boolean,
): BooleanSeries =>
  field(
    source,
    label,
    (bar) => bar !== undefined && pick(bar),
    (session, node) => new BooleanSeries(session, node),
  );

export const valueField = <B, T>(
  source: Series<B>,
  label: string,
  pick: (bar: B) => T,
  empty: T,
): Series<T> =>
  field(
    source,
    label,
    (bar) => (bar === undefined ? empty : pick(bar)),
    (session, node) => new Series<T>(session, node),
  );
