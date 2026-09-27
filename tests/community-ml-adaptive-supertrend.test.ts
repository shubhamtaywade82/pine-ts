import { describe, expect, it } from "vitest";
import { PineRuntime, community } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";
import { kMeansCentroids, nearestCluster } from "../src/community/ml-adaptive-supertrend.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto" };

interface Options {
  readonly atrLength: number;
  readonly factor: number;
  readonly trainingPeriod: number;
}

interface ReferenceBar {
  readonly supertrend: number;
  readonly direction: number;
  readonly cluster: number;
  readonly assigned: number;
  readonly centroids: readonly [number, number, number];
}

const nz = (value: number | undefined): number =>
  value === undefined || Number.isNaN(value) ? 0 : value;
const isNa = (value: number | undefined): boolean => value === undefined || Number.isNaN(value);
/** Pine: a comparison with na is false. */
const notEqual = (a: number | undefined, b: number | undefined): boolean =>
  !isNa(a) && !isNa(b) && a !== b;
const avg = (values: readonly number[]): number =>
  values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;

/*
 * Literal, array-based transcription of "Machine Learning Adaptive SuperTrend
 * [AlgoAlpha]" — the differential-test oracle. It shares no code with the
 * runtime implementation; each helper mirrors one block of the Pine source.
 */

/** `volatility = ta.atr(atr_len)` = `ta.rma(true range, atr_len)`, SMA-seeded. */
const referenceAtr = (bars: readonly Bar[], length: number): number[] => {
  const tr = bars.map((bar, i) => {
    const previous = bars[i - 1];
    if (previous === undefined) return bar.high - bar.low;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close),
    );
  });
  const volatility: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const previous = volatility[i - 1];
    if (!isNa(previous)) {
      volatility.push((1 / length) * (tr[i] ?? Number.NaN) + (1 - 1 / length) * nz(previous));
    } else if (i >= length - 1) {
      volatility.push(tr.slice(i - length + 1, i + 1).reduce((a, b) => a + b, 0) / length);
    } else {
      volatility.push(Number.NaN);
    }
  }
  return volatility;
};

/** `ta.highest`/`ta.lowest(volatility, training_data_period)`: na until the window is full. */
const referenceRange = (
  volatility: readonly number[],
  i: number,
  training: number,
): { readonly upper: number; readonly lower: number } => {
  const window = volatility.slice(Math.max(0, i - training + 1), i + 1);
  if (i < training - 1 || window.some(isNa)) return { upper: Number.NaN, lower: Number.NaN };
  return { upper: Math.max(...window), lower: Math.min(...window) };
};

/** The `while` loop with `amean`/`bmean`/`cmean` arrays, verbatim. */
const referenceKMeans = (
  volatility: readonly number[],
  i: number,
  training: number,
  initial: readonly [number, number, number],
): readonly [number, number, number] => {
  const amean = [initial[0]];
  const bmean = [initial[1]];
  const cmean = [initial[2]];
  const changed = (means: readonly number[]): boolean =>
    means.length === 1 ? true : notEqual(means[0], means[1]);
  while (changed(amean) || changed(bmean) || changed(cmean)) {
    const hv: number[] = [];
    const mv: number[] = [];
    const lv: number[] = [];
    for (let k = training - 1; k >= 0; k -= 1) {
      const value = volatility[i - k] ?? Number.NaN;
      const d1 = Math.abs(value - (amean[0] ?? Number.NaN));
      const d2 = Math.abs(value - (bmean[0] ?? Number.NaN));
      const d3 = Math.abs(value - (cmean[0] ?? Number.NaN));
      if (d1 < d2 && d1 < d3) hv.unshift(value);
      if (d2 < d1 && d2 < d3) mv.unshift(value);
      if (d3 < d1 && d3 < d2) lv.unshift(value);
    }
    amean.unshift(avg(hv));
    bmean.unshift(avg(mv));
    cmean.unshift(avg(lv));
  }
  return [amean[0] ?? Number.NaN, bmean[0] ?? Number.NaN, cmean[0] ?? Number.NaN];
};

/** `cluster = distances.indexof(distances.min())`. */
const referenceCluster = (vol: number, centroids: readonly number[]): number => {
  const distances = centroids.map((centroid) => Math.abs(vol - centroid));
  const defined = distances.filter((distance) => !isNa(distance));
  if (defined.length === 0) return -1;
  return distances.indexOf(Math.min(...defined));
};

interface SupertrendHistory {
  readonly upper: number[];
  readonly lower: number[];
  readonly line: number[];
  readonly atr: number[];
}

/** `pine_supertrend(fact, assigned_centroid)` for bar `i`, verbatim. */
const referenceSupertrendStep = (
  bars: readonly Bar[],
  i: number,
  factor: number,
  history: SupertrendHistory,
): { readonly line: number; readonly direction: number } => {
  const bar = bars[i] as Bar;
  const atrNow = history.atr[i] ?? Number.NaN;
  const src = (bar.high + bar.low) / 2;
  const closePrevious = bars[i - 1]?.close ?? Number.NaN;
  const prevLowerBand = nz(history.lower[i - 1]);
  const prevUpperBand = nz(history.upper[i - 1]);
  let lowerBand = src - factor * atrNow;
  let upperBand = src + factor * atrNow;
  lowerBand =
    lowerBand > prevLowerBand || closePrevious < prevLowerBand ? lowerBand : prevLowerBand;
  upperBand =
    upperBand < prevUpperBand || closePrevious > prevUpperBand ? upperBand : prevUpperBand;
  let direction: number;
  if (isNa(history.atr[i - 1])) direction = 1;
  else if (history.line[i - 1] === prevUpperBand) direction = bar.close > upperBand ? -1 : 1;
  else direction = bar.close < lowerBand ? 1 : -1;
  const line = direction === -1 ? lowerBand : upperBand;
  history.lower.push(lowerBand);
  history.upper.push(upperBand);
  history.line.push(line);
  return { line, direction };
};

const pineReference = (bars: readonly Bar[], options: Options): ReferenceBar[] => {
  const { atrLength, factor, trainingPeriod } = options;
  const volatility = referenceAtr(bars, atrLength);
  const history: SupertrendHistory = { upper: [], lower: [], line: [], atr: [] };
  return bars.map((_, i) => {
    const vol = volatility[i] ?? Number.NaN;
    const { upper, lower } = referenceRange(volatility, i, trainingPeriod);
    const initial = [0.75, 0.5, 0.25].map((pct) => lower + (upper - lower) * pct) as [
      number,
      number,
      number,
    ];
    const centroids =
      nz(vol) > 0 && i >= trainingPeriod - 1
        ? referenceKMeans(volatility, i, trainingPeriod, initial)
        : initial;
    const cluster = referenceCluster(vol, centroids);
    const assigned = cluster === -1 ? Number.NaN : (centroids[cluster] ?? Number.NaN);
    history.atr.push(assigned);
    const { line, direction } = referenceSupertrendStep(bars, i, factor, history);
    return { supertrend: line, direction, cluster, assigned, centroids };
  });
};

/** Bar range per regime: calm, volatile, calm, moderate. */
const regimeRange = (i: number): number => {
  if (i < 150) return 0.4;
  if (i < 230) return 4;
  if (i < 300) return 0.6;
  return 2.5;
};

/** Deterministic bars: flat opening (ATR exactly 0), then calm and volatile regimes. */
const regimeBars = (): Bar[] => {
  let seed = 11;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const bars: Bar[] = [];
  let close = 100;
  for (let i = 0; i < 360; i += 1) {
    if (i < 70) {
      bars.push({
        time: i + 1,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        isClosed: true,
      });
      continue;
    }
    const range = regimeRange(i);
    const open = close;
    close = open + (next() - 0.5) * range * 2 + (i % 40 < 20 ? 0.3 : -0.3);
    bars.push({
      time: i + 1,
      open,
      high: Math.max(open, close) + next() * range,
      low: Math.min(open, close) - next() * range,
      close,
      volume: 1,
      isClosed: true,
    });
  }
  return bars;
};

class Provider implements MarketDataProvider {
  public constructor(private readonly stream: readonly Bar[] = []) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => [];

  public streamBars = (): AsyncIterable<Bar> => {
    const stream = this.stream;
    return {
      async *[Symbol.asyncIterator]() {
        yield* stream;
      },
    };
  };

  public getSymbolInfo = async (): Promise<SymbolInfo> => info;
}

interface Observed {
  readonly supertrend: number;
  readonly direction: number;
  readonly cluster: number;
  readonly assigned: number;
  readonly centroids: readonly [number, number, number];
}

const OPTIONS: Options = { atrLength: 10, factor: 3, trainingPeriod: 50 };

const observe = (): {
  readonly script: (ctx: Parameters<Parameters<PineRuntime["run"]>[0]>[0]) => void;
  readonly rows: Observed[];
} => {
  const rows: Observed[] = [];
  return {
    rows,
    script: (ctx) => {
      const result = community.mlAdaptiveSupertrend(OPTIONS);
      if (!ctx.barstate.isconfirmed) return;
      rows.push({
        supertrend: result.supertrend.value,
        direction: result.direction.value ?? Number.NaN,
        cluster: result.cluster.value ?? Number.NaN,
        assigned: result.assignedCentroid.value,
        centroids: [
          result.highCentroid.value,
          result.mediumCentroid.value,
          result.lowCentroid.value,
        ],
      });
    },
  };
};

const expectSame = (actual: number, expected: number, label: string): void => {
  if (Number.isNaN(expected)) expect(actual, label).toBeNaN();
  else expect(actual, label).toBeCloseTo(expected, 9);
};

describe("community.mlAdaptiveSupertrend (AlgoAlpha)", () => {
  const bars = regimeBars();
  const reference = pineReference(bars, OPTIONS);

  it("matches a literal transcription of the Pine script bar for bar", async () => {
    const { script, rows } = observe();
    await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(
      script,
      bars,
    );

    expect(rows).toHaveLength(reference.length);
    for (const [index, expected] of reference.entries()) {
      const actual = rows[index] as Observed;
      const label = `bar ${index}`;
      expect(actual.direction, label).toBe(expected.direction);
      expect(actual.cluster, label).toBe(expected.cluster);
      expectSame(actual.supertrend, expected.supertrend, `${label} supertrend`);
      expectSame(actual.assigned, expected.assigned, `${label} assigned`);
      for (const [k, centroid] of expected.centroids.entries()) {
        expectSame(actual.centroids[k] ?? Number.NaN, centroid, `${label} centroid ${k}`);
      }
    }
  });

  it("exercises the ATR = 0 path, trend flips, and the empty-cluster na path", () => {
    // Flat opening: ATR is exactly 0, so K-Means is skipped once the training
    // window is full (bar 58) and the initial guesses (all 0) assign cluster 0.
    expect(reference.slice(58, 70).every((bar) => bar.cluster === 0 && bar.assigned === 0)).toBe(
      true,
    );
    expect(reference.slice(9, 58).every((bar) => bar.cluster === -1)).toBe(true);
    // Both trend directions occur after warm-up.
    const directions = new Set(reference.slice(70).map((bar) => bar.direction));
    expect(directions).toEqual(new Set([-1, 1]));
    // A regime switch empties a cluster, which Pine turns into an all-na bar.
    expect(reference.slice(70).some((bar) => bar.cluster === -1)).toBe(true);
  });

  it("commits the same history when the bars arrive as realtime ticks", async () => {
    const ticks: Bar[] = [];
    for (const bar of bars) {
      ticks.push({ ...bar, close: bar.open, high: bar.open, low: bar.open, isClosed: false });
      ticks.push({ ...bar, isClosed: false });
      ticks.push({ ...bar, isClosed: true });
    }
    const historical = observe();
    await new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(
      historical.script,
      bars,
    );
    const realtime = observe();
    await new PineRuntime({
      provider: new Provider(ticks),
      symbol: "TEST",
      timeframe: "1",
    }).runRealtime(realtime.script);

    expect(realtime.rows).toHaveLength(historical.rows.length);
    for (const [index, row] of historical.rows.entries()) {
      const other = realtime.rows[index] as Observed;
      expect(other.direction, `bar ${index}`).toBe(row.direction);
      expectSame(other.supertrend, row.supertrend, `bar ${index}`);
    }
  });

  it("rejects invalid options", async () => {
    const run = (options: Parameters<typeof community.mlAdaptiveSupertrend>[0]): Promise<void> =>
      new PineRuntime({ provider: new Provider(), symbol: "TEST", timeframe: "1" }).run(
        () => community.mlAdaptiveSupertrend(options),
        bars.slice(0, 2),
      );
    await expect(run({ atrLength: 0 })).rejects.toThrow(RangeError);
    await expect(run({ trainingPeriod: 1.5 })).rejects.toThrow(RangeError);
    await expect(run({ factor: Number.NaN })).rejects.toThrow(RangeError);
  });
});

describe("K-Means step", () => {
  it("drops ties: a value equidistant from two centroids joins no cluster", () => {
    // 7.5 is equidistant from 10 and 5. Joining high would move it to 8.75.
    expect(kMeansCentroids([10, 7.5, 6, 5, 4, 0], [10, 5, 0])).toEqual([10, 5, 0]);
  });

  it("turns an empty cluster into na, after which no value joins any cluster", () => {
    // Iteration 1: medium is empty -> na. Iteration 2: every comparison with the
    // na distance is false, so all three means become na.
    const centroids = kMeansCentroids([1, 1, 1, 9, 9, 9], [7, 5, 3]);
    expect(centroids.every(Number.isNaN)).toBe(true);
    expect(nearestCluster(4, centroids)).toBe(-1);
  });

  it("prefers the higher-volatility cluster on an exact distance tie", () => {
    expect(nearestCluster(5, [7, 3, 1])).toBe(0);
    expect(nearestCluster(2, [7, 3, 1])).toBe(1);
    expect(nearestCluster(4, [Number.NaN, 3, 5])).toBe(1);
  });
});
