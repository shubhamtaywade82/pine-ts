/**
 * Keeps a concise indicator current as a live chart's bars change, without
 * re-executing all history on every update. A tick on the forming bar re-runs
 * just that bar (the session rolls back its working state first); the next
 * bar opening confirms the closed bar with its final values, then runs the
 * new one. Anything else — older history prepended, a gap, a new
 * higher-timeframe bar for `security()` — falls back to a full run, which is
 * exactly what `run()` would produce.
 */

import type { PineRuntime, PineScript } from "../core/runtime.js";
import type { Bar } from "../core/types.js";
import type { SecurityResolver } from "./security.js";

export interface LiveRun<TOutput> {
  readonly output: () => TOutput;
  readonly script: PineScript;
  readonly runtime: PineRuntime;
  readonly security: SecurityResolver;
}

export interface LiveIndicator<TOutput> {
  /**
   * Brings the run up to date with `bars` (the chart's full bar list) and
   * returns the output. Calls must not overlap; await each one.
   */
  update(bars: readonly Bar[]): Promise<TOutput>;
}

type Change = "tick" | "append" | "reset";

const classify = (known: readonly Bar[], next: readonly Bar[]): Change => {
  if (known.length === 0 || known[0]?.time !== next[0]?.time) return "reset";
  const lastTime = known.at(-1)?.time;
  if (next.length === known.length && next.at(-1)?.time === lastTime) return "tick";
  if (next.length === known.length + 1 && next.at(-2)?.time === lastTime) return "append";
  return "reset";
};

export const startLive = async <TOutput>(
  bars: readonly Bar[],
  runAll: (bars: readonly Bar[]) => Promise<LiveRun<TOutput>>,
): Promise<LiveIndicator<TOutput>> => {
  let known = bars;
  let run = await runAll(bars);
  return {
    update: async (next) => {
      const change = classify(known, next);
      const opensHtfBar =
        change === "append" && run.security.opensNewBucket(known.at(-1)!.time, next.at(-1)!.time);
      if (change === "reset" || opensHtfBar) {
        run = await runAll(next);
      } else {
        // The closing values may never have arrived as a tick (snapshots are throttled).
        if (change === "append")
          await run.runtime.feed(run.script, { ...next.at(-2)!, isClosed: true });
        await run.runtime.feed(run.script, next.at(-1)!);
      }
      known = next;
      return run.output();
    },
  };
};
