import { nodeKey } from "./node-registry.js";
import { IndicatorNode } from "./series-node.js";
import type { PineSession } from "./session.js";
import { Series } from "./series.js";

export const zipSeries = <A, B, U>(
  left: Series<A>,
  right: Series<B>,
  name: string,
  combine: (left: A | undefined, right: B | undefined) => U,
): Series<U> => {
  if (left.runtime === undefined || right.runtime === undefined) {
    throw new Error("Derived series require PineSession-owned sources");
  }
  if (left.runtime !== right.runtime) {
    throw new Error("Derived series operands must belong to the same PineSession");
  }

  const runtime = left.runtime;
  return runtime.nodes.getOrCreate(nodeKey(name, left, right), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): U => combine(left.at(0), right.at(0)),
      commit: (): void => undefined,
    };
    return new Series(runtime, new IndicatorNode(definition));
  });
};

/**
 * Memoized pointwise derivation: `transform` reads the source's current value
 * (missing history arrives as `undefined`) and the result is cached per bar
 * revision through the standard node registry, so Pine's elementwise built-ins
 * (`math.*` on a series) evaluate once per revision and participate in the
 * rollback/commit lifecycle like every other derived series.
 */
export const mapSeries = <A, U>(
  source: Series<A>,
  name: string,
  transform: (value: A | undefined) => U,
): Series<U> => {
  if (source.runtime === undefined) {
    throw new Error("Derived series require PineSession-owned sources");
  }

  const runtime = source.runtime;
  return runtime.nodes.getOrCreate(nodeKey(name, source), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): U => transform(source.at(0)),
      commit: (): void => undefined,
    };
    return new Series<U>(runtime, new IndicatorNode(definition));
  });
};

export const createUserSeries = <T>(
  session: PineSession,
  key: string,
  evaluate: () => T,
): Series<T> => {
  const normalizedKey = key.trim();
  if (normalizedKey.length === 0) throw new RangeError("User series key must not be empty");

  return session.nodes.getOrCreate(nodeKey("user.series", normalizedKey), () => {
    const definition = {
      init: (): null => null,
      evaluate,
      commit: (): void => undefined,
    };
    return new Series(session, new IndicatorNode(definition));
  });
};
