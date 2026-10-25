/**
 * Pine Script v6 `request.*` namespace — multi-timeframe, multi-symbol, and
 * external-data requests.
 *
 * The `request.security` / `request.security_lower_tf` functions are backed
 * by the {@link RequestEngine} (see `src/request/engine.ts`), which the
 * runtime pre-warms via `runtime.prepareSecurity(symbol, timeframe)` for
 * each unique `(symbol, timeframe)` pair the script will use. The engine
 * drives the secondary `PineSession` forward to the alignment bar and
 * evaluates the expression there, caching the per-bar result so subsequent
 * caller bars can re-use it.
 *
 * Provider-limited functions (`financial`, `dividends`, `splits`, `earnings`,
 * `economic`, `quandl`, `seed`, `currency_rate`, `footprint`) raise
 * `RequestNotImplemented` until a provider that exposes the dataset is wired
 * in. This is honest — Pine v6 NEVER fabricates provider-specific data.
 */

import { getActiveRequestEngine, RequestNotPrepared, type SecurityOptions } from "./engine.js";
import type { PineContext } from "../core/context.js";

// Re-exports for callers that prefer the typed namespace.
export {
  RequestEngine,
  RequestNotPrepared,
  setActiveRequestEngine,
  getActiveRequestEngine,
  withActiveRequestEngine,
  type SecurityOptions,
} from "./engine.js";

/**
 * Bar-merge look-ahead options (Pine `barmerge.lookahead_on` / `lookahead_off`).
 */
export type Lookahead = "lookahead_on" | "lookahead_off";

/**
 * Bar-merge gap handling (Pine `barmerge.gaps_on` / `gaps_off`).
 */
export type Gaps = "gaps_on" | "gaps_off";

/**
 * `barmerge.*` constants as a branded record for callers that prefer the
 * namespaced API over string literals.
 */
export const barmerge = {
  lookahead_on: "lookahead_on" as const,
  lookahead_off: "lookahead_off" as const,
  gaps_on: "gaps_on" as const,
  gaps_off: "gaps_off" as const,
} as const;

/**
 * Error raised by the provider-limited `request.*` functions until a
 * provider that exposes the dataset is wired in.
 */
export class RequestNotImplemented extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RequestNotImplemented";
  }
}

/**
 * Validates a request.* argument set and returns a `never` raising the not-implemented error.
 */
const notImplemented = (fn: string, symbol: string, dataset: string): never => {
  throw new RequestNotImplemented(
    `request.${fn}(${symbol}, ${dataset}, ...) requires a provider that exposes this dataset; ` +
      "Binance and DhanHQ do not. See docs/ROADMAP.md Phase 4 — provider-limited surface.",
  );
};

/**
 * `request.security(symbol, timeframe, expression, options?)`. Evaluates
 * `expression` on a secondary `(symbol, timeframe)` context and aligns the
 * result to the caller's current bar per the `lookahead` option.
 *
 * Default `lookahead=off` is non-repainting: the result is the value from
 * the most-recently-closed secondary bar at the caller's bar time.
 * `lookahead=on` reads the secondary bar that contains the caller's bar
 * time (may leak future info — use only on confirmed HTF contexts).
 *
 * The host MUST pre-warm the `(symbol, timeframe)` pair via
 * `runtime.prepareSecurity(symbol, timeframe)` before `runtime.run(script)`.
 * Calling `request.security` for a pair that was not pre-warmed raises
 * {@link RequestNotPrepared} so scripts fail loudly rather than silently
 * fabricate values.
 */
export const security = <T>(
  symbol: string,
  timeframe: string,
  expression: (ctx: PineContext) => T,
  options?: SecurityOptions,
): T | undefined => {
  const engine = getActiveRequestEngine();
  if (engine === undefined) {
    throw new RequestNotPrepared(symbol, timeframe);
  }
  return engine.security<T>(symbol, timeframe, expression, options);
};

/**
 * `request.security_lower_tf(symbol, timeframe, expression, options?)`.
 * Returns the tuple of intrabar values from the lower-timeframe secondary
 * context that fall within the caller's bar. Each element is the
 * `expression` value at the corresponding secondary bar.
 *
 * Like `security`, requires `runtime.prepareSecurity(symbol, timeframe)` to
 * have been called for the pair before `runtime.run(script)`.
 */
export const security_lower_tf = <T>(
  symbol: string,
  timeframe: string,
  expression: (ctx: PineContext) => T,
  options?: SecurityOptions,
): readonly T[] => {
  const engine = getActiveRequestEngine();
  if (engine === undefined) {
    throw new RequestNotPrepared(symbol, timeframe);
  }
  return engine.security_lower_tf<T>(symbol, timeframe, expression, options);
};

/**
 * `request.financial(symbol, financial_id, period, gaps?)`. Provider-limited;
 * Binance and DhanHQ do not expose fundamentals.
 */
export const financial = (
  symbol: string,
  financialId: string,
  period: string,
): number | undefined => {
  if (typeof financialId !== "string" || financialId.trim() === "") {
    throw new RequestNotImplemented("request.financial: financial_id required");
  }
  if (typeof period !== "string" || period.trim() === "") {
    throw new RequestNotImplemented("request.financial: period required");
  }
  return notImplemented("financial", symbol, "fundamentals");
};

/**
 * `request.dividends(symbol)`. Provider-limited.
 */
export const dividends = (symbol: string): readonly number[] =>
  notImplemented("dividends", symbol, "dividends");

/**
 * `request.splits(symbol)`. Provider-limited.
 */
export const splits = (symbol: string): readonly number[] =>
  notImplemented("splits", symbol, "splits");

/**
 * `request.earnings(symbol)`. Provider-limited.
 */
export const earnings = (symbol: string): readonly { date: number; value: number }[] =>
  notImplemented("earnings", symbol, "earnings");

/**
 * `request.economic(country, currency, indicator_id)`. Provider-limited.
 */
export const economic = (
  country: string,
  currency: string,
  indicatorId: string,
): number | undefined => {
  if (typeof country !== "string" || country.trim() === "") {
    throw new RequestNotImplemented("request.economic: country required");
  }
  if (typeof currency !== "string" || currency.trim() === "") {
    throw new RequestNotImplemented("request.economic: currency required");
  }
  if (typeof indicatorId !== "string" || indicatorId.trim() === "") {
    throw new RequestNotImplemented("request.economic: indicator_id required");
  }
  return notImplemented("economic", country, currency);
};

/**
 * `request.quandl(ticker)`. Provider-limited.
 */
export const quandl = (ticker: string): number | undefined => {
  if (typeof ticker !== "string" || ticker.trim() === "") {
    throw new RequestNotImplemented("request.quandl: ticker required");
  }
  return notImplemented("quandl", ticker, "quandl");
};

/**
 * `request.seed(symbol, price_source, currency)`. Provider-limited.
 */
export const seed = (symbol: string, priceSource: string, currency: string): number | undefined => {
  if (typeof priceSource !== "string" || priceSource.trim() === "") {
    throw new RequestNotImplemented("request.seed: price_source required");
  }
  if (typeof currency !== "string" || currency.trim() === "") {
    throw new RequestNotImplemented("request.seed: currency required");
  }
  return notImplemented("seed", symbol, "seed");
};

/**
 * `request.currency_rate(from, to)`. Provider-limited.
 */
export const currency_rate = (from: string, to: string): number | undefined => {
  if (typeof from !== "string" || from.trim() === "") {
    throw new RequestNotImplemented("request.currency_rate: from required");
  }
  if (typeof to !== "string" || to.trim() === "") {
    throw new RequestNotImplemented("request.currency_rate: to required");
  }
  return notImplemented("currency_rate", from, to);
};

/**
 * `request.footprint(symbol)`. Provider-limited (requires tick-level data).
 */
export const footprint = (symbol: string): unknown =>
  notImplemented("footprint", symbol, "footprint");
