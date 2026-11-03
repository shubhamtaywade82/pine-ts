import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { requirePositiveLength } from "./validation.js";
import { collectNonNaWindow } from "./window.js";

export interface AlmaOptions {
  readonly offset?: number;
  readonly sigma?: number;
  readonly floor?: boolean;
}

interface AlmaWeights {
  readonly weights: readonly number[];
  readonly weightSum: number;
}

const WEIGHTS_CACHE = new Map<string, AlmaWeights>();

export const getAlmaWeights = (
  length: number,
  offset: number,
  sigma: number,
  floor = false,
): AlmaWeights => {
  const cacheKey = `${length}:${offset}:${sigma}:${floor ? 1 : 0}`;
  const cached = WEIGHTS_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const mRaw = offset * (length - 1);
  const m = floor ? Math.floor(mRaw) : mRaw;
  const s = length / sigma;
  const denom = 2 * s * s;

  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < length; i += 1) {
    const dist = i - m;
    const w = Math.exp(-(dist * dist) / denom);
    weights.push(w);
    weightSum += w;
  }

  const result: AlmaWeights = { weights, weightSum };
  WEIGHTS_CACHE.set(cacheKey, result);
  return result;
};

const resolveAlmaParams = (
  offsetOrOptions?: number | AlmaOptions,
  sigmaParam?: number,
  floorParam?: boolean,
): { offset: number; sigma: number; floor: boolean } => {
  if (typeof offsetOrOptions === "object") {
    return {
      offset: offsetOrOptions.offset ?? 0.85,
      sigma: offsetOrOptions.sigma ?? 6,
      floor: offsetOrOptions.floor ?? false,
    };
  }
  return {
    offset: offsetOrOptions ?? 0.85,
    sigma: sigmaParam ?? 6,
    floor: floorParam ?? false,
  };
};

/**
 * ta.alma — Arnaud Legoux Moving Average (Pine Script v6 parity).
 *
 * Gaussian-weighted moving average where the weighting peak sits at
 * `m = offset * (length - 1)` (or floored if `floor` is true).
 * A larger `offset` shifts the peak toward recent bars; `sigma` controls Gaussian width.
 */
export const alma = (
  source: Series<number>,
  length: number,
  offsetOrOptions?: number | AlmaOptions,
  sigma?: number,
  floor?: boolean,
): FloatSeries => {
  requirePositiveLength(length);
  const runtime = source.runtime;
  if (runtime === undefined) {
    throw new Error("TA series require a PineSession-owned source series");
  }

  const { offset, sigma: sig, floor: flr } = resolveAlmaParams(offsetOrOptions, sigma, floor);
  const key = nodeKey("ta.alma", source, length, offset, sig, flr);

  return runtime.nodes.getOrCreate(key, () => {
    const { weights, weightSum } = getAlmaWeights(length, offset, sig, flr);
    const definition = {
      warmupBars: length - 1,
      init: (): null => null,
      evaluate: (): number => {
        if (isNa(source.at(0))) return Number.NaN;
        const window = collectNonNaWindow(source, length);
        if (window === undefined) return Number.NaN;

        let weighted = 0;
        for (let i = 0; i < length; i += 1) {
          const sample = window[length - 1 - i]!.value;
          weighted += weights[i]! * sample;
        }
        return weightSum === 0 ? Number.NaN : weighted / weightSum;
      },
      commit: (): void => undefined,
    };
    return new FloatSeries(runtime, new IndicatorNode(definition));
  }) as FloatSeries;
};
