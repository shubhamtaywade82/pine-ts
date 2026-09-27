import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, type Series } from "../core/series.js";

/**
 * Creates (or reuses) a cached float-valued derived series. Operand series and
 * `name` form the cache key, so any numeric parameter captured by `evaluate`
 * must be embedded in `name` to keep distinct parameters from colliding.
 */
export const deriveFloatSeries = (
  operands: readonly Series<number>[],
  name: string,
  evaluate: () => number,
): FloatSeries => {
  const runtime = operands[0]?.runtime;
  if (runtime === undefined) {
    throw new Error("Derived series require PineSession-owned sources");
  }
  if (operands.some((series) => series.runtime !== runtime)) {
    throw new Error("Derived series operands must belong to the same PineSession");
  }
  return runtime.nodes.getOrCreate(nodeKey(name, ...operands), () => {
    const definition = {
      init: (): null => null,
      evaluate,
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
