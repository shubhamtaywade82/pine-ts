/**
 * Pine Script v6 `syminfo.*` namespace — symbol metadata variables.
 *
 * Each variable reads from the active session's `SymbolInfo` (set by the
 * runtime via `provider.getSymbolInfo(symbol)`). When a field is not set
 * by the provider, the corresponding function returns the Pine v6 default
 * for that field type (e.g. `syminfo.mintick` returns `0` when the
 * provider did not supply a minimum tick).
 *
 * The provider contract for `SymbolInfo` is provider-limited: a crypto
 * provider like Binance cannot supply `syminfo.root` (futures root) or
 * `syminfo.current_contract` (current futures month). The accessor returns
 * the field when present; otherwise it returns the type-appropriate empty
 * value (`undefined` for strings, `NaN` for numbers, `false` for booleans).
 *
 * Fundamentals fields (`syminfo.employees`, `syminfo.shares_outstanding_*`,
 * `syminfo.target_price_*`, `syminfo.recommendations_*`) are NOT exposed
 * here; they are surfaced through `request.financial` (provider-limited,
 * raises `RequestNotImplemented` until a fundamentals-capable provider is
 * wired in).
 */

import { getCurrentSession } from "../core/execution-context.js";

/**
 * Returns the active session's `SymbolInfo`. Throws if no script is running
 * (the host must wrap script execution in `runtime.run(script)`).
 */
const requireSymbolInfo = () => getCurrentSession()?.getSymbolInfo();

/** `syminfo.ticker` — the symbol's ticker (e.g. "AAPL", "BTCUSDT"). */
export const ticker = (): string => requireSymbolInfo()?.ticker ?? "";

/** `syminfo.tickerid` — `<prefix>:<ticker>` composite key (e.g. "NASDAQ:AAPL"). */
export const tickerid = (): string => requireSymbolInfo()?.tickerId ?? "";

/** `syminfo.basecurrency` — base currency for crypto pairs (e.g. "BTC"). */
export const basecurrency = (): string => requireSymbolInfo()?.baseCurrency ?? "";

/** `syminfo.currency` — quote currency ISO code (e.g. "USD"). */
export const currency = (): string => requireSymbolInfo()?.currency ?? requireSymbolInfo()?.quoteCurrency ?? "";

/** `syminfo.mintick` — minimum price tick (e.g. 0.01 for USD stocks). */
export const mintick = (): number => requireSymbolInfo()?.minTick ?? Number.NaN;

/** `syminfo.pointvalue` — $-value of one point (1 for stocks, 100 for some futures). */
export const pointvalue = (): number => requireSymbolInfo()?.pointValue ?? 1;

/** `syminfo.pricescale` — number of price units per point (100 for 0.01 ticks). */
export const pricescale = (): number => requireSymbolInfo()?.priceScale ?? 100;

/** `syminfo.minmove` — minimum price movement in points. */
export const minmove = (): number => requireSymbolInfo()?.minMove ?? 1;

/** `syminfo.timezone` — IANA or UTC-offset timezone string. */
export const timezone = (): string => requireSymbolInfo()?.timezone ?? "UTC";

/** `syminfo.session` — regular session string (e.g. "0930-1600"). */
export const session = (): string => requireSymbolInfo()?.session ?? "";

/** `syminfo.volumetype` — "cash" | "contracts" | "shares" | etc. */
export const volumetype = (): string => requireSymbolInfo()?.volumeType ?? "";

/** `syminfo.root` — futures root ticker (e.g. "ES" for ES1!). */
export const root = (): string => requireSymbolInfo()?.root ?? "";

/** `syminfo.prefix` — vendor prefix (e.g. "NASDAQ", "SSE"). */
export const prefix = (): string => requireSymbolInfo()?.prefix ?? "";

/** `syminfo.main_tickerid` — composite key of the main ticker. */
export const main_tickerid = (): string => requireSymbolInfo()?.mainTickerId ?? "";

/** `syminfo.current_contract` — current futures contract month (e.g. "F24"). */
export const current_contract = (): string => requireSymbolInfo()?.currentContract ?? "";

/** `syminfo.type` — "stock" | "futures" | "crypto" | "forex" | etc. */
export const type = (): string => requireSymbolInfo()?.type ?? "";

/** `syminfo.description` — human-readable description. */
export const description = (): string => requireSymbolInfo()?.description ?? "";

/**
 * `syminfo.mincontract` — minimum contract size for futures. Provider-specific.
 */
export const mincontract = (): number => requireSymbolInfo()?.minContract ?? Number.NaN;

/**
 * Returns the full `SymbolInfo` object for advanced host-side access. Scripts
 * usually call the individual accessors above; this is for internal/test use.
 */
export const getSymbolInfo = (): import("../core/types.js").SymbolInfo | undefined =>
  requireSymbolInfo();
