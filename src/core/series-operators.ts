import { nodeKey } from "./node-registry.js";
import { IndicatorNode } from "./series-node.js";
import { FloatSeries, Series } from "./series.js";

export const mapSeries = <T, U>(
  source: Series<T>,
  name: string,
  map: (value: T) => U,
): Series<U> => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("Derived series require a PineSession-owned source");

  return runtime.nodes.getOrCreate(nodeKey(name, source), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): U => map(source.at(0)),
      commit: (): void => undefined,
    };
    return new Series(runtime, new IndicatorNode(definition));
  });
};

export const zipSeries = <A, B, U>(
  left: Series<A>,
  right: Series<B>,
  name: string,
  combine: (left: A, right: B) => U,
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

export const mapFloatSeries = (
  source: Series<number>,
  name: string,
  map: (value: number) => number,
): FloatSeries => {
  const runtime = source.runtime;
  if (runtime === undefined) throw new Error("Derived series require a PineSession-owned source");

  return runtime.nodes.getOrCreate(nodeKey(name, source), () => {
    const definition = {
      init: (): null => null,
      evaluate: (): number => map(source.at(0)),
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  });
};
