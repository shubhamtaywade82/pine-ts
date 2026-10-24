/**
 * Multi-timeframe / multi-symbol execution engine that backs
 * `request.security` and `request.security_lower_tf`.
 *
 * Design:
 *
 * - A {@link RequestEngine} is owned by the {@link PineRuntime} and shared
 *   with the script via the module-global {@link setActiveRequestEngine} /
 *   {@link getActiveRequestEngine} pair (mirrors `setCurrentSession`).
 * - Each unique `(symbol, timeframe)` pair is a "secondary context". The
 *   host pre-warms it via {@link PineRuntime.prepareSecurity} before
 *   `runtime.run(script)` is called; this loads bars + symbol info via
 *   the provider and creates a secondary {@link PineSession}.
 * - When the script calls `request.security(symbol, tf, expression, opts)`,
 *   the engine finds the alignment bar in the secondary context for the
 *   caller's current bar time, drives the secondary session forward to
 *   that bar (if not already there), and evaluates `expression` in the
 *   secondary context. The result is cached per `(cacheKey, expression)`
 *   so the next caller bar with the same alignment re-uses the cached
 *   value rather than re-evaluating.
 *
 * Alignment rules (per Pine v6 Reference Manual):
 *
 * - `lookahead=off` (default): the result is the value from the
 *   most-recently-closed secondary bar at the caller's bar time. That is,
 *   the latest secondary bar whose close_time ≤ caller_time. This is the
 *   non-repainting default.
 * - `lookahead=on`: the result is the value from the secondary bar that
 *   CONTAINS the caller's bar time (open_time ≤ caller_time < close_time).
 *   This may read a still-forming secondary bar and is allowed only on
 *   confirmed HTF contexts.
 *
 * `gaps=on` (default `off`): when the secondary context has no committed
 * value at the alignment point (e.g. the alignment is before the secondary
 * data starts, or the secondary has holes), the result is `na` rather than
 * the last available value. `gaps=off` carries forward the last available
 * secondary result.
 */

import { createContext, type PineContext } from "../core/context.js";
import { getCurrentSession, setCurrentSession } from "../core/execution-context.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../core/types.js";
import { PineSession, type HistoricalBarFlags } from "../core/session.js";
import { in_seconds, parse, type TimeframeInfo } from "../time/timeframe.js";

/**
 * Cache entry for a single `(symbol, timeframe)` pair. Holds the loaded
 * bars, the secondary session, and per-expression cached results.
 */
interface SecondaryContext {
  readonly symbol: string;
  readonly timeframe: string;
  readonly tfInfo: TimeframeInfo;
  readonly tfSeconds: number;
  readonly bars: readonly Bar[];
  readonly session: PineSession;
  /**
   * Per-expression cache. The key is `expression.toString()` so two closures
   * that are source-identical (e.g. the same `(sctx) => sctx.close.at(0)`
   * literal created fresh on each caller bar) share a cache entry. This is
   * the closest practical approximation of Pine v6's call-site identity
   * model without a build-time transformer.
   */
  readonly expressionCache: Map<string, PerExpressionCache<unknown>>;
  /** How many bars of the secondary session have been driven so far. */
  processedIndex: number;
}

interface PerExpressionCache<T> {
  /** Cached per-bar evaluation results, indexed by secondary bar index. */
  readonly values: (T | undefined)[];
  /** Set when the engine has finished evaluating `expression` at bar `i`. */
  readonly evaluated: Set<number>;
}

/**
 * Cache key for an expression: its source-code string. Two closures that
 * are source-identical share a cache entry. This is an approximation of
 * Pine v6's call-site identity model — it works correctly for the common
 * case where the expression is a stable function literal in the script
 * source. Expressions that capture caller state should NOT be cached
 * across caller bars (the captured state changes); the engine still
 * evaluates them per caller bar but does not re-drive the secondary
 * session past the alignment bar.
 */
const expressionKey = (expression: ((ctx: PineContext) => unknown) | ((ctx: unknown) => unknown)): string => {
  const source = expression.toString();
  // Reset the cache when the source changes is automatic via the Map key.
  return source;
};

/**
 * Raised when `request.security` is called for a `(symbol, timeframe)` pair
 * that the host did not pre-warm via `runtime.prepareSecurity()`. The
 * contract is explicit: the host knows upfront which pairs the script will
 * use, so request.* never silently fabricates values.
 */
export class RequestNotPrepared extends Error {
  public constructor(symbol: string, timeframe: string) {
    super(
      `request.security(${symbol}, ${timeframe}, ...) was not pre-warmed; ` +
        `call runtime.prepareSecurity(${JSON.stringify(symbol)}, ${JSON.stringify(timeframe)}) ` +
        "before runtime.run(script). Pine v6 never fabricates multi-timeframe data.",
    );
    this.name = "RequestNotPrepared";
  }
}

export interface SecurityOptions {
  readonly lookahead?: "lookahead_on" | "lookahead_off";
  readonly gaps?: "gaps_on" | "gaps_off";
  readonly ignore_invalid_symbol?: boolean;
}

export class RequestEngine {
  private readonly cache = new Map<string, SecondaryContext>();

  public constructor(private readonly provider: MarketDataProvider) {}

  /**
   * Pre-warms a `(symbol, timeframe)` pair: loads bars + symbol info via
   * the provider and creates the secondary `PineSession`. Must be called
   * before `runtime.run(script)` so that `request.security` calls inside
   * the script can find the pre-warmed context synchronously.
   */
  public async prepare(symbol: string, timeframe: string): Promise<void> {
    const key = cacheKey(symbol, timeframe);
    if (this.cache.has(key)) return;
    const [bars, symbolInfo] = await Promise.all([
      this.provider.getHistoricalBars({ symbol, timeframe }),
      this.provider.getSymbolInfo(symbol),
    ]);
    const tfInfo = parse(timeframe);
    const tfSeconds = in_seconds(timeframe);
    const session = new PineSession({ maxBarsBack: 5000 });
    session.setSymbolInfo(symbolInfo);
    session.expectHistoricalBars(bars.length);
    this.cache.set(key, {
      symbol,
      timeframe,
      tfInfo,
      tfSeconds,
      bars,
      session,
      expressionCache: new Map(),
      processedIndex: -1,
    });
  }

  /**
   * Returns the cached secondary context for `(symbol, timeframe)`, or
   * throws {@link RequestNotPrepared} if the host did not pre-warm it.
   */
  private requireContext(symbol: string, timeframe: string): SecondaryContext {
    const key = cacheKey(symbol, timeframe);
    const ctx = this.cache.get(key);
    if (ctx === undefined) throw new RequestNotPrepared(symbol, timeframe);
    return ctx;
  }

  /**
   * `request.security(symbol, timeframe, expression, options?)`. Returns
   * the value of `expression` evaluated on the secondary `(symbol,
   * timeframe)` context, aligned to the caller's current bar per the
   * `lookahead` option.
   *
   * The engine drives the secondary session forward to the alignment bar
   * (if not already there), evaluates `expression` at that bar, and caches
   * the result so subsequent caller bars can re-use it.
   */
  public security<T>(
    symbol: string,
    timeframe: string,
    expression: (ctx: PineContext) => T,
    options?: SecurityOptions,
  ): T | undefined {
    const ctx = this.requireContext(symbol, timeframe);
    const callerSession = getCurrentSession();
    if (callerSession === undefined) return undefined;
    const callerTime = callerSession.sources.time.at(0);
    if (callerTime === undefined) return undefined;

    const lookahead = options?.lookahead ?? "lookahead_off";
    const gaps = options?.gaps ?? "gaps_off";
    const alignmentIdx = this.findAlignmentBar(ctx, callerTime, lookahead);
    if (alignmentIdx === -1) {
      // No alignment bar available. With gaps=on the result is na. With
      // gaps=off we fall back to the most recent cached value (if any).
      if (gaps === "gaps_on") return undefined;
      return this.lastCachedValue<T>(ctx, expression);
    }

    // Drive the secondary session forward to the alignment bar and evaluate
    // the expression there (caching the result so we can re-use it on
    // subsequent caller bars).
    return this.evaluateAt<T>(ctx, expression, alignmentIdx);
  }

  /**
   * `request.security_lower_tf(symbol, timeframe, expression, options?)`.
   * For a lower-timeframe request, returns the tuple of intrabar values
   * from the secondary context that fall within the caller's bar. Each
   * element is the `expression` value at the corresponding secondary bar.
   *
   * The `gaps` and `lookahead` options are accepted for API compatibility
   * but their semantics on lower-tf requests are deferred to a future
   * revision; the engine returns all intrabar values within the caller
   * bar's window regardless of those options for now.
   */
  public security_lower_tf<T>(
    symbol: string,
    timeframe: string,
    expression: (ctx: PineContext) => T,
    options?: SecurityOptions,
  ): readonly T[] {
    const ctx = this.requireContext(symbol, timeframe);
    const callerSession = getCurrentSession();
    if (callerSession === undefined) return [];
    const callerTime = callerSession.sources.time.at(0);
    if (callerTime === undefined) return [];

    // Derive the caller bar duration from the time series when a previous
    // committed bar is available; fall back to the caller session's
    // declared timeframe duration (in seconds) on the first bar.
    const previousTime = callerSession.sources.time.at(1);
    let callerBarDuration = 0;
    if (previousTime !== undefined && previousTime > 0) {
      callerBarDuration = callerTime - previousTime;
    } else if (callerSession.timeframe !== undefined) {
      callerBarDuration = in_seconds(callerSession.timeframe) * 1000;
    }
    const callerCloseTime = callerTime + callerBarDuration;

    // `gaps` and `lookahead` semantics on lower-tf are deferred; the
    // engine returns all intrabar values within the caller bar's window
    // regardless of those options for now. Validate them for forward-compat.
    if (options?.lookahead !== undefined && options.lookahead !== "lookahead_on" && options.lookahead !== "lookahead_off") {
      throw new RangeError("request.security_lower_tf: invalid lookahead option");
    }
    if (options?.gaps !== undefined && options.gaps !== "gaps_on" && options.gaps !== "gaps_off") {
      throw new RangeError("request.security_lower_tf: invalid gaps option");
    }

    // Find the secondary bars whose open_time is in [callerTime, callerCloseTime).
    const intrabarIndices: number[] = [];
    for (let i = 0; i < ctx.bars.length; i += 1) {
      const bar = ctx.bars[i]!;
      if (bar.time >= callerTime && bar.time < callerCloseTime) {
        intrabarIndices.push(i);
      } else if (bar.time >= callerCloseTime) {
        break;
      }
    }
    return intrabarIndices.map((idx) => this.evaluateAt<T>(ctx, expression, idx) as T);
  }

  /**
   * Drives the secondary session forward to `barIndex` (if not already
   * there) and evaluates `expression` at that bar. The result is cached so
   * subsequent calls for the same `(symbol, timeframe, expression, barIndex)`
   * do not re-drive the session.
   */
  private evaluateAt<T>(
    ctx: SecondaryContext,
    expression: (ctx: PineContext) => T,
    barIndex: number,
  ): T | undefined {
    const exprKey = expressionKey(expression);
    let perExpr = ctx.expressionCache.get(exprKey) as PerExpressionCache<T> | undefined;
    if (perExpr === undefined) {
      const values: (T | undefined)[] = Array.from({ length: ctx.bars.length }, () => undefined);
      perExpr = {
        values,
        evaluated: new Set(),
      };
      ctx.expressionCache.set(exprKey, perExpr);
    }
    if (perExpr.evaluated.has(barIndex)) {
      return perExpr.values[barIndex];
    }

    // Drive the secondary session from processedIndex+1 to barIndex,
    // evaluating the expression at barIndex. Bars in between are advanced
    // with a no-op execute callback (their state is committed to series
    // history but the expression is not evaluated there).
    const previousSession = setCurrentSession(ctx.session);
    try {
      for (let i = ctx.processedIndex + 1; i <= barIndex; i += 1) {
        const bar = ctx.bars[i]!;
        const flags: HistoricalBarFlags = {
          isLast: i === ctx.bars.length - 1,
          isLastConfirmedHistory: i === ctx.bars.length - 1,
        };
        if (i === barIndex) {
          let captured: T | undefined = undefined;
          ctx.session.processHistoricalBar(
            bar,
            () => {
              const pineCtx = createContext(ctx.session, bar, ctx.tfInfo);
              captured = expression(pineCtx);
            },
            flags,
          );
          perExpr.values[i] = captured;
          perExpr.evaluated.add(i);
        } else {
          // No-op execution advances the session state without evaluating
          // the expression at this bar.
          ctx.session.processHistoricalBar(bar, () => undefined, flags);
        }
      }
      ctx.processedIndex = Math.max(ctx.processedIndex, barIndex);
    } finally {
      setCurrentSession(previousSession);
    }
    return perExpr.values[barIndex];
  }

  /**
   * Returns the most recent cached value for `expression`, used as the
   * `gaps=off` fallback when no alignment bar is available.
   */
  private lastCachedValue<T>(
    ctx: SecondaryContext,
    expression: (ctx: PineContext) => T,
  ): T | undefined {
    const exprKey = expressionKey(expression);
    const perExpr = ctx.expressionCache.get(exprKey) as PerExpressionCache<T> | undefined;
    if (perExpr === undefined) return undefined;
    for (let i = perExpr.values.length - 1; i >= 0; i -= 1) {
      if (perExpr.evaluated.has(i)) return perExpr.values[i];
    }
    return undefined;
  }

  /**
   * Finds the secondary bar index to align to, based on `lookahead`:
   *
   * - `lookahead_off`: the latest secondary bar whose close_time ≤
   *   callerTime.
   * - `lookahead_on`: the secondary bar whose open_time ≤ callerTime <
   *   close_time (the bar CONTAINING callerTime).
   *
   * Returns -1 when no bar matches.
   */
  private findAlignmentBar(
    ctx: SecondaryContext,
    callerTime: number,
    lookahead: "lookahead_on" | "lookahead_off",
  ): number {
    const barDuration = ctx.tfSeconds * 1000;
    if (lookahead === "lookahead_on") {
      for (let i = ctx.bars.length - 1; i >= 0; i -= 1) {
        const bar = ctx.bars[i]!;
        const closeTime = bar.time + barDuration;
        if (bar.time <= callerTime && callerTime < closeTime) return i;
      }
      return -1;
    }
    // lookahead_off: latest bar whose close_time ≤ callerTime
    for (let i = ctx.bars.length - 1; i >= 0; i -= 1) {
      const bar = ctx.bars[i]!;
      const closeTime = bar.time + barDuration;
      if (closeTime <= callerTime) return i;
    }
    return -1;
  }
}

const cacheKey = (symbol: string, timeframe: string): string => `${symbol}|${timeframe}`;

// ---------- module-global active engine accessor ----------

let activeEngine: RequestEngine | undefined;

/**
 * Installs the active {@link RequestEngine} for the current script
 * invocation. The runtime calls this around `execute(script, bar)` so that
 * `request.*` calls inside the script can reach the engine synchronously.
 */
export const setActiveRequestEngine = (engine: RequestEngine | undefined): void => {
  activeEngine = engine;
};

/** Returns the active {@link RequestEngine}, or `undefined` if none is set. */
export const getActiveRequestEngine = (): RequestEngine | undefined => activeEngine;

// Re-exports for callers that prefer the typed namespace.
export type { PineContext, Bar, SymbolInfo, MarketDataProvider };

/**
 * Helper used by the runtime to scope an active engine around a script
 * invocation. Saves/restores the previous engine so nested contexts
 * (e.g. a secondary runtime driving its own script) do not clobber the
 * outer engine.
 */
export const withActiveRequestEngine = <T>(engine: RequestEngine | undefined, body: () => T): T => {
  const previous = activeEngine;
  setActiveRequestEngine(engine);
  try {
    return body();
  } finally {
    setActiveRequestEngine(previous);
  }
};
