/*
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * TypeScript port of "Machine Learning Adaptive SuperTrend [AlgoAlpha]"
 * (Pine Script v5, © AlgoAlpha), published under MPL-2.0 at
 * https://www.tradingview.com/script/CLk71Qgy-Machine-Learning-Adaptive-SuperTrend-AlgoAlpha/
 * Only the calculation is ported; plots, labels, and the table are omitted.
 */
import { requireCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import { FloatSeries, Series } from "../core/series.js";
import { atr, highest, lowest } from "../ta/core.js";
import { supertrendOver } from "../ta/supertrend-core.js";

export interface MlAdaptiveSupertrendOptions {
  /** `atr_len` — ATR length. Default 10. */
  readonly atrLength?: number;
  /** `fact` — SuperTrend factor. Default 3. */
  readonly factor?: number;
  /** `training_data_period` — K-Means training window. Default 100. */
  readonly trainingPeriod?: number;
  /** `highvol` — initial high-volatility percentile guess. Default 0.75. */
  readonly highVolatilityPercentile?: number;
  /** `midvol` — initial medium-volatility percentile guess. Default 0.5. */
  readonly mediumVolatilityPercentile?: number;
  /** `lowvol` — initial low-volatility percentile guess. Default 0.25. */
  readonly lowVolatilityPercentile?: number;
}

export interface MlAdaptiveSupertrendResult {
  /** `ST` — the SuperTrend line. */
  readonly supertrend: FloatSeries;
  /**
   * `dir` — Pine SuperTrend convention: -1 uptrend (line below price), 1
   * downtrend. The script's bullish signal is `ta.crossunder(dir, 0)` and its
   * bearish signal `ta.crossover(dir, 0)`.
   */
  readonly direction: Series<number>;
  /** `cluster` — 0 high, 1 medium, 2 low volatility; -1 when no centroid is available. */
  readonly cluster: Series<number>;
  /** `assigned_centroid` — the volatility the SuperTrend bands use. */
  readonly assignedCentroid: FloatSeries;
  readonly highCentroid: FloatSeries;
  readonly mediumCentroid: FloatSeries;
  readonly lowCentroid: FloatSeries;
  /** `volatility` — `ta.atr(atrLength)`. */
  readonly volatility: FloatSeries;
}

export type Centroids = readonly [high: number, medium: number, low: number];

/** Guard against a non-converging loop; Pine would stop the script with a runtime error. */
const MAX_KMEANS_ITERATIONS = 10_000;

/** Pine v5 `a != b`: any na operand makes the comparison false. */
const pineNotEqual = (a: number, b: number): boolean => !isNa(a) && !isNa(b) && a !== b;

/** Pine `array.avg` over values in array order; na (empty) for an empty array. */
const average = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
};

/**
 * The script's K-Means loop over one training window.
 *
 * `window` holds `volatility[0..training_data_period-1]` newest first. A value
 * joins a cluster only when it is strictly closer to that centroid than to
 * both others; ties and na distances join none. An empty cluster's mean is na,
 * and a na centroid makes every later comparison false, exactly as in Pine.
 * The loop runs until no centroid changes, where a na centroid counts as
 * unchanged.
 */
export const kMeansCentroids = (window: readonly number[], initial: Centroids): Centroids => {
  let current: Centroids = initial;
  let previous: Centroids | undefined;
  let iteration = 0;
  while (centroidsChanged(current, previous)) {
    iteration += 1;
    if (iteration > MAX_KMEANS_ITERATIONS) {
      throw new RangeError(`K-Means did not converge within ${MAX_KMEANS_ITERATIONS} iterations`);
    }
    const [high, medium, low] = assignToClusters(window, current);
    previous = current;
    current = [average(high), average(medium), average(low)];
  }
  return current;
};

/** The script's loop condition: the first pass always runs. */
const centroidsChanged = (current: Centroids, previous: Centroids | undefined): boolean =>
  previous === undefined ||
  current.some((value, index) => pineNotEqual(value, previous[index] ?? Number.NaN));

/**
 * One K-Means assignment pass. Pine iterates i = training-1 down to 0 and
 * unshifts, which leaves each cluster array ordered newest first; averaging in
 * that order keeps the floating-point sums identical.
 */
const assignToClusters = (
  window: readonly number[],
  centroids: Centroids,
): readonly [number[], number[], number[]] => {
  const high: number[] = [];
  const medium: number[] = [];
  const low: number[] = [];
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const value = window[i] ?? Number.NaN;
    const toHigh = Math.abs(value - centroids[0]);
    const toMedium = Math.abs(value - centroids[1]);
    const toLow = Math.abs(value - centroids[2]);
    if (toHigh < toMedium && toHigh < toLow) high.unshift(value);
    if (toMedium < toHigh && toMedium < toLow) medium.unshift(value);
    if (toLow < toHigh && toLow < toMedium) low.unshift(value);
  }
  return [high, medium, low];
};

/**
 * `cluster = distances.indexof(distances.min())`: the first centroid at the
 * minimum distance (ties prefer high, then medium). na distances are skipped;
 * when every distance is na the script's `indexof(na)` finds nothing (-1).
 */
export const nearestCluster = (volatility: number, centroids: Centroids): number => {
  const distances = centroids.map((centroid) => Math.abs(volatility - centroid));
  let best = -1;
  for (const [index, distance] of distances.entries()) {
    if (isNa(distance)) continue;
    if (best === -1 || distance < (distances[best] ?? Number.NaN)) best = index;
  }
  return best;
};

interface ClusterState {
  readonly centroids: Centroids;
  readonly cluster: number;
  readonly assigned: number;
}

const requirePositiveInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
};

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
};

/**
 * Machine Learning Adaptive SuperTrend [AlgoAlpha]: a SuperTrend whose band
 * width is the K-Means centroid of the current ATR's volatility cluster
 * instead of the raw ATR.
 */
export const mlAdaptiveSupertrend = (
  options: MlAdaptiveSupertrendOptions = {},
): MlAdaptiveSupertrendResult => {
  const atrLength = options.atrLength ?? 10;
  const factor = options.factor ?? 3;
  const trainingPeriod = options.trainingPeriod ?? 100;
  const percentiles = [
    options.highVolatilityPercentile ?? 0.75,
    options.mediumVolatilityPercentile ?? 0.5,
    options.lowVolatilityPercentile ?? 0.25,
  ] as const;
  requirePositiveInteger(atrLength, "atrLength");
  requirePositiveInteger(trainingPeriod, "trainingPeriod");
  requireFinite(factor, "factor");
  for (const percentile of percentiles) requireFinite(percentile, "volatility percentile");

  const runtime = requireCurrentSession();
  const barIndex = runtime.sources.bar_index;
  const volatility = atr(atrLength);
  const upper = highest(volatility, trainingPeriod);
  const lower = lowest(volatility, trainingPeriod);
  const name = `community.mlAdaptiveSupertrend:training=${trainingPeriod}:percentiles=${percentiles.join(",")}`;

  const state = runtime.nodes.getOrCreate(
    nodeKey(`${name}.clusters`, volatility, upper, lower, barIndex),
    () => {
      const evaluate = (): ClusterState => {
        const current = volatility.at(0) ?? Number.NaN;
        const top = upper.at(0) ?? Number.NaN;
        const bottom = lower.at(0) ?? Number.NaN;
        const initial = percentiles.map((percentile) => bottom + (top - bottom) * percentile);
        let centroids: Centroids = [
          initial[0] ?? Number.NaN,
          initial[1] ?? Number.NaN,
          initial[2] ?? Number.NaN,
        ];
        const index = barIndex.at(0) ?? -1;
        // `if nz(volatility) > 0 and bar_index >= training_data_period-1`
        if ((isNa(current) ? 0 : current) > 0 && index >= trainingPeriod - 1) {
          const window = Array.from(
            { length: trainingPeriod },
            (_, offset) => volatility.at(offset) ?? Number.NaN,
          );
          centroids = kMeansCentroids(window, centroids);
        }
        const cluster = nearestCluster(current, centroids);
        return {
          centroids,
          cluster,
          assigned: cluster === -1 ? Number.NaN : (centroids[cluster] ?? Number.NaN),
        };
      };
      return new Series<ClusterState>(
        runtime,
        new IndicatorNode({ init: (): null => null, evaluate, commit: (): void => undefined }),
      );
    },
  );

  const field = (label: string, pick: (value: ClusterState) => number): FloatSeries =>
    runtime.nodes.getOrCreate(nodeKey(`${name}.${label}`, state), () => {
      const evaluate = (): number => {
        const value = state.at(0);
        return value === undefined ? Number.NaN : pick(value);
      };
      return new FloatSeries(
        runtime,
        new IndicatorNode({ init: (): null => null, evaluate, commit: (): void => undefined }),
      );
    }) as FloatSeries;

  const assignedCentroid = field("assigned", (value) => value.assigned);
  const { supertrend, direction } = supertrendOver(
    runtime,
    factor,
    assignedCentroid,
    `${name}.supertrend`,
    // The script defines its own pine_supertrend, so TradingView runs the
    // transcription as written, warm-up included.
    "transcription",
  );

  return {
    supertrend,
    direction,
    cluster: field("cluster", (value) => value.cluster),
    assignedCentroid,
    highCentroid: field("high", (value) => value.centroids[0]),
    mediumCentroid: field("medium", (value) => value.centroids[1]),
    lowCentroid: field("low", (value) => value.centroids[2]),
    volatility,
  };
};
