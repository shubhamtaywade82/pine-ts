/**
 * Higher-timeframe values for concise indicators, built from the chart's own
 * bars — the `request.security(syminfo.tickerid, tf, expr[1],
 * lookahead=barmerge.lookahead_on)` idiom: on every chart bar the expression's
 * value from the previous, fully closed higher-timeframe bar. The forming
 * higher-timeframe bar is never read, so nothing repaints.
 *
 * Chart bars are bucketed by UTC-aligned timeframe boundaries (Binance's 4H
 * and 1D candles align the same way). The expression runs on its own runtime
 * over the resampled bars, so `ta.*` history and state inside it are the
 * higher timeframe's.
 */

import type { Bar } from "../core/types.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Pine timeframe strings: minutes ("15", "240"), "D"/"1D", "W"/"1W". Months are rejected (not fixed-length). */
export const timeframeMs = (timeframe: string): number => {
  const match = /^(\d*)([DW]?)$/.exec(timeframe.trim().toUpperCase());
  const multiplier = match?.[1] === "" ? 1 : Number(match?.[1]);
  if (match === null || !Number.isInteger(multiplier) || multiplier <= 0) {
    throw new RangeError(`Unsupported timeframe "${timeframe}"; use minutes ("60"), "D" or "W"`);
  }
  if (match[2] === "D") return multiplier * DAY_MS;
  if (match[2] === "W") return multiplier * 7 * DAY_MS;
  return multiplier * MINUTE_MS;
};

const bucketStart = (time: number, ms: number): number => Math.floor(time / ms) * ms;

/** Aggregates chart bars into higher-timeframe bars; every bucket but the last counts as closed. */
export const resampleBars = (bars: readonly Bar[], ms: number): Bar[] => {
  const result: Bar[] = [];
  for (const bar of bars) {
    const start = bucketStart(bar.time, ms);
    const last = result.at(-1);
    if (last?.time !== start) {
      if (last !== undefined) result[result.length - 1] = { ...last, isClosed: true };
      result.push({ ...bar, time: start, isClosed: bar.isClosed !== false });
      continue;
    }
    result[result.length - 1] = {
      ...last,
      high: Math.max(last.high, bar.high),
      low: Math.min(last.low, bar.low),
      close: bar.close,
      volume: last.volume + bar.volume,
      isClosed: bar.isClosed !== false,
    };
  }
  return result;
};

/** Runs `expression` once per higher-timeframe bar and returns its value per bar. */
export type HtfEvaluator = (
  bars: readonly Bar[],
  expression: unknown,
) => Promise<readonly unknown[]>;

interface Resolved {
  readonly ms: number;
  /** Higher-timeframe bucket start → index into `values`. */
  readonly indexByStart: ReadonlyMap<number, number>;
  readonly values: readonly unknown[];
}

/**
 * Collects `security()` calls on a first pass (returning undefined), then
 * evaluates them on resampled bars so a second pass can read the values.
 * Calls are keyed by call order within a bar plus timeframe, like Pine call sites.
 */
export class SecurityResolver {
  private readonly requested = new Map<string, { timeframe: string; expression: unknown }>();
  private readonly resolved = new Map<string, Resolved>();
  private callIndex = 0;

  public constructor(private readonly chartBars: readonly Bar[]) {}

  public beginBar(): void {
    this.callIndex = 0;
  }

  public get hasPending(): boolean {
    return [...this.requested.keys()].some((key) => !this.resolved.has(key));
  }

  public request<T>(timeframe: string, expression: unknown, barTime: number): T | undefined {
    const key = `${this.callIndex}:${timeframe}`;
    this.callIndex += 1;
    const resolved = this.resolved.get(key);
    if (resolved === undefined) {
      if (!this.requested.has(key)) this.requested.set(key, { timeframe, expression });
      return undefined;
    }
    const index = resolved.indexByStart.get(bucketStart(barTime, resolved.ms));
    if (index === undefined || index === 0) return undefined;
    return resolved.values[index - 1] as T;
  }

  /** Whether moving from `fromTime` to `toTime` opens a new bar on any requested timeframe. */
  public opensNewBucket(fromTime: number, toTime: number): boolean {
    return [...this.resolved.values()].some(
      ({ ms }) => bucketStart(fromTime, ms) !== bucketStart(toTime, ms),
    );
  }

  public async resolve(evaluate: HtfEvaluator): Promise<void> {
    for (const [key, { timeframe, expression }] of this.requested) {
      if (this.resolved.has(key)) continue;
      const ms = timeframeMs(timeframe);
      const htfBars = resampleBars(this.chartBars, ms);
      const values = await evaluate(htfBars, expression);
      const indexByStart = new Map(htfBars.map((bar, i) => [bar.time, i]));
      this.resolved.set(key, { ms, indexByStart, values });
    }
  }
}
