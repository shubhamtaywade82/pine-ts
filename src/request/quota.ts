/**
 * `request.*()` call-site quota — Pine Script's per-script limit on distinct
 * `request.*()` call sites (40 on TradingView's highest tier).
 *
 * Pine counts *call sites*, not invocations: a `request.security` inside a
 * loop still counts once. This module approximates call-site identity the
 * same way the engines do — the (call order, timeframe, symbol, function)
 * tuple of the first invocation per script run — and throws a
 * {@link RequestQuotaExceeded} error when the configured budget is spent.
 *
 * The quota is module-global like the rest of the execution context and is
 * reset by {@link resetRequestQuota} at the start of every script run
 * (`PineRuntime`/`runHistorical` call it; hosts never need to).
 */

/** TradingView Ultimate's `request.*()` call-site quota. */
export const DEFAULT_REQUEST_QUOTA = 40;

/** Raised when a script declares more `request.*()` call sites than the budget. */
export class RequestQuotaExceeded extends Error {
  public constructor(limit: number) {
    super(
      `Too many request.*() call sites: the quota is ${limit}. ` +
        "Consolidate requests (fewer symbols/timeframes, computed inside one expression), " +
        "or raise the budget on the runtime when running your own infrastructure.",
    );
    this.name = "RequestQuotaExceeded";
  }
}

interface QuotaState {
  /** Distinct call sites seen this run: key → nothing (a set with stable ordering). */
  readonly sites: Set<string>;
  limit: number;
  /** Throw on breach (Pine behavior). When false, callers may degrade instead. */
  throwOnExceed: boolean;
}

const state: QuotaState = {
  sites: new Set<string>(),
  limit: DEFAULT_REQUEST_QUOTA,
  throwOnExceed: true,
};

/** Resets the per-run call-site set. Called before every script run. */
export const resetRequestQuota = (): void => {
  state.sites.clear();
};

/** Configures the budget (also re-arms the counter). */
export const configureRequestQuota = (limit: number, throwOnExceed = true): void => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("request.*() quota limit must be a positive integer");
  }
  state.limit = limit;
  state.throwOnExceed = throwOnExceed;
  resetRequestQuota();
};

/**
 * Counts one `request.*()` call site. `siteKey` identifies the call site
 * (call order + symbol + timeframe + function name, as the engines derive
 * it). Throws {@link RequestQuotaExceeded} when the budget is spent;
 * returns false instead when `throwOnExceed` was disabled.
 */
export const countRequestSite = (siteKey: string): boolean => {
  if (state.sites.has(siteKey)) return true; // Existing call site: free.
  if (state.sites.size >= state.limit) {
    if (state.throwOnExceed) throw new RequestQuotaExceeded(state.limit);
    return false;
  }
  state.sites.add(siteKey);
  return true;
};

/** Number of distinct call sites counted so far this run. */
export const requestSitesUsed = (): number => state.sites.size;

/** The active limit. */
export const requestQuotaLimit = (): number => state.limit;
