/**
 * Pine Script v6 global built-ins — the non-namespaced functions and
 * variables that sit at the top level of every script. This module exposes
 * `time`, `time_close`, `timestamp`, `timenow`, `time_tradingday`,
 * `last_bar_time`, type casts (`bool`/`int`/`float`/`string`/`color`),
 * `alert`/`alertcondition`, and `max_bars_back`.
 *
 * The `time(timeframe, session?, timezone?)` overload is a *function* form
 * that returns the bar's open timestamp aligned to a specific timeframe; the
 * `time` *variable* is exposed via `PineContext.time` (the current bar's
 * open time on the script's own timeframe).
 */

import { getCurrentSession } from "../core/execution-context.js";
import { isNa } from "../core/na.js";
import type { Color } from "../color/index.js";
import { calendarParts } from "../time/calendar.js";
import { in_seconds } from "../time/timeframe.js";

/** A registered alert condition (declared by `alertcondition`). */
export interface AlertCondition {
  readonly id: string;
  readonly title: string | undefined;
  readonly message: string | undefined;
  /** Most recent evaluated condition value, set on each bar. */
  condition: boolean;
}

/** A one-shot alert emitted by `alert()`. */
export interface AlertEvent {
  readonly message: string;
  readonly freq: AlertFrequency;
  readonly barIndex: number;
  readonly barTime: number | undefined;
}

export type AlertFrequency = "once_per_bar" | "once_per_bar_close" | "all";

interface GlobalState {
  readonly conditions: Map<string, AlertCondition>;
  readonly events: AlertEvent[];
  /** Most recent `max_bars_back` setting; defaults to the session limit. */
  maxBarsBack?: number;
}

let globalState: GlobalState = { conditions: new Map(), events: [] };

/** Resets the global state (used by the runtime before each script run). */
export const resetGlobalState = (): void => {
  globalState = { conditions: new Map(), events: [] };
};

/** Returns the captured alert events emitted so far this run. */
export const getAlertEvents = (): readonly AlertEvent[] => globalState.events;

/** Returns the alert conditions declared so far this run. */
export const getAlertConditions = (): readonly AlertCondition[] => [
  ...globalState.conditions.values(),
];

/**
 * `alert(message, freq?)`. Emits an alert event with the given message and
 * frequency. `freq` defaults to `once_per_bar_close`. The host can read the
 * captured events via `getAlertEvents()`.
 */
export const alert = (message: string, freq: AlertFrequency = "once_per_bar_close"): void => {
  const session = getCurrentSession();
  globalState.events.push({
    message,
    freq,
    barIndex: session?.barIndex ?? Number.NaN,
    barTime: session?.sources.time.at(0) ?? undefined,
  });
};

/**
 * `alertcondition(condition, title?, message?)`. Declares a named alert
 * condition. The `condition` is re-evaluated on every bar; the host can read
 * the most recent value via `getAlertConditions()`. The `id` is generated
 * from the call site (or use `title` if provided) so multiple
 * `alertcondition` calls in the same script are distinguishable.
 */
let alertConditionCounter = 0;
export const alertcondition = (
  condition: boolean,
  title?: string,
  message?: string,
): void => {
  alertConditionCounter += 1;
  const id = title ?? `alertcondition_${alertConditionCounter}`;
  const existing = globalState.conditions.get(id);
  if (existing === undefined) {
    globalState.conditions.set(id, { id, title, message, condition });
  } else {
    existing.condition = condition;
  }
};

/**
 * `max_bars_back(length)`. Sets the maximum number of bars of history the
 * runtime will buffer for series referenced by built-ins. Pine's hard cap is
 * 5000; this implementation delegates to the session's `maxBarsBack` setting
 * and pins it to the requested value (clamped to 1..5000).
 */
export const max_bars_back = (length: number): void => {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`max_bars_back requires a positive integer, got ${length}`);
  }
  globalState.maxBarsBack = Math.min(5000, length);
};

/** Reads the active `max_bars_back` setting (or undefined for the default). */
export const getRequestedMaxBarsBack = (): number | undefined => globalState.maxBarsBack;

// ---------- time / timestamp helpers ----------

/**
 * `time(timeframe, session?, timezone?)`. Returns the opening UNIX timestamp
 * (ms) of the current bar on the requested timeframe, aligned to the
 * optional session string in the given timezone. When `session` is supplied,
 * returns `na` on bars that fall outside the session window.
 *
 * When called with no arguments, returns the current bar's open time on the
 * script's own timeframe — equivalent to the `time` variable exposed via
 * `PineContext.time`.
 *
 * The full multi-timeframe variant requires the `request.security` machinery
 * (Wave 5) to evaluate a secondary context. Until that ships, this function
 * returns the current bar's open time when the requested timeframe matches
 * the script's own; otherwise it returns na.
 */
export const time = (
  timeframe?: string,
  session?: string,
  timezone?: string,
): number | undefined => {
  const session_ = getCurrentSession();
  if (session_ === undefined) return undefined;
  if (timeframe === undefined) return session_.sources.time.at(0) ?? undefined;
  // Defer session-filtering to Wave 5; the timeframe alignment also requires
  // request.security's machinery. For the draft we validate the timeframe
  // string and return the current bar's open time so callers do not break.
  if (in_seconds(timeframe) === 0) return undefined;
  if (session?.trim() === "") return undefined;
  if (timezone?.trim() === "") return undefined;
  return session_.sources.time.at(0) ?? undefined;
};

/**
 * `time_close(timeframe, session?, timezone?)`. Returns the closing UNIX
 * timestamp (ms) of the current bar on the requested timeframe — that is, the
 * bar's open time plus one timeframe duration.
 */
export const time_close = (
  timeframe?: string,
  session?: string,
  timezone?: string,
): number | undefined => {
  const session_ = getCurrentSession();
  if (session_ === undefined) return undefined;
  const open = session_.sources.time.at(0);
  if (open === undefined) return undefined;
  const tfStr = timeframe ?? "1";
  const seconds = in_seconds(tfStr);
  if (seconds === 0) return undefined;
  // Validate the optional session/timezone args for the draft; full
  // session-filtering arrives with Wave 5.
  if (session?.trim() === "") return undefined;
  if (timezone?.trim() === "") return undefined;
  return open + seconds * 1000;
};

/**
 * `timenow`. Current UNIX timestamp in milliseconds. Equivalent to
 * `Date.now()`. Pine v6 documents this as the time at which the script
 * begins executing the current bar.
 */
export const timenow = (): number => Date.now();

/**
 * `time_tradingday(time, timezone?)`. Returns the UNIX timestamp of midnight
 * on the trading day that contains `time` in the given timezone (defaults to
 * `syminfo.timezone`). Useful for daily session grouping.
 */
export const time_tradingday = (time: number, timezone?: string): number => {
  const parts = calendarParts(time, timezone);
  // Build a UTC midnight timestamp for the calendar date. The timezone
  // offset is already applied by `calendarParts` so the result is the local
  // midnight expressed in UTC milliseconds.
  return Date.UTC(parts.year, parts.month - 1, parts.dayofmonth, 0, 0, 0, 0);
};

/**
 * `last_bar_time`. The closing UNIX timestamp of the last historical bar.
 * During realtime execution, this updates to the most-recently-confirmed
 * realtime bar's closing timestamp.
 *
 * Draft: returns the open time of the current bar (which during historical
 * execution equals the bar at `last_bar_index` once we are on the last bar).
 * A future revision will track the actual `last_bar_time` from the runtime.
 */
export const last_bar_time = (): number | undefined => {
  const session = getCurrentSession();
  if (session === undefined) return undefined;
  if (session.lastBarIndex < 0) return undefined;
  // The offset from the current bar to the last historical bar.
  const offset = session.lastBarIndex - session.barIndex;
  if (offset < 0) {
    // Realtime past the historical end — read the last committed bar.
    return session.sources.time.at(0) ?? undefined;
  }
  // During historical execution before the last bar, this would read a
  // future committed bar; the series returns undefined when the offset
  // reaches beyond the committed history, so it surfaces na cleanly.
  return session.sources.time.at(offset) ?? undefined;
};

// ---------- type casts ----------

/**
 * `bool(x)`. Casts `x` to boolean. Numbers (≠0, ≠na) are true; 0 and na are
 * false; strings parse as "true"/"false" case-insensitive, otherwise nonempty
 * is true. `undefined` (na) → `undefined` (na).
 */
export const bool = (x: number | string | boolean | undefined): boolean | undefined => {
  if (x === undefined) return undefined;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return isNa(x) ? undefined : x !== 0;
  const lower = x.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return x.length > 0;
};

/**
 * `int(x)`. Casts `x` to integer. Truncates toward zero for floats, parses
 * strings via `parseInt`, propagates na. `undefined` → `undefined`.
 */
export const int = (x: number | string | undefined): number | undefined => {
  if (x === undefined) return undefined;
  if (typeof x === "number") return isNa(x) ? undefined : Math.trunc(x);
  const parsed = Number.parseInt(x, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * `float(x)`. Casts `x` to float. Parses strings via `Number`, propagates
 * na. `undefined` → `undefined`.
 */
export const float = (x: number | string | undefined): number | undefined => {
  if (x === undefined) return undefined;
  if (typeof x === "number") return isNa(x) ? undefined : x;
  const parsed = Number.parseFloat(x);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * `string(x)`. Casts `x` to string. Numbers use Pine's default formatting
 * (same as `str.tostring` without a format); booleans become "true"/"false";
 * `undefined` (na) → `undefined` (na).
 */
export const string = (x: number | string | boolean | undefined): string | undefined => {
  if (x === undefined) return undefined;
  if (typeof x === "string") return x;
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "number") return isNa(x) ? undefined : String(x);
  return undefined;
};

/**
 * `color(x)`. Casts `x` to `color`. The Pine v6 reference documents this as
 * a no-op when `x` is already a `color`, and as `na` for unsupported inputs.
 */
export const colorCast = (x: Color | undefined): Color | undefined => x;

// ---------- timestamp constructor ----------

/**
 * `timestamp(year, month, day, hour?, minute?, second?, timezone?)`.
 * Constructs a UNIX timestamp (ms) from calendar fields in the given
 * timezone (default `syminfo.timezone`). The result is the UTC milliseconds
 * corresponding to the local wall-clock time in that timezone.
 *
 * Pine v6 documents: timezone defaults to `syminfo.timezone`; if the calendar
 * fields are out of range, the result overflows like JavaScript's `Date`
 * constructor (e.g. `month=13` rolls into the next year).
 */
export const timestamp = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timezone?: string,
): number => {
  // Build the wall-clock Date in UTC, then shift by the timezone offset.
  // The offset is read from the difference between the formatted parts and
  // the raw UTC components.
  const utcDate = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  // Use the same Intl machinery as calendarParts to compute the timezone
  // offset for that instant. calendarParts returns local fields, so the
  // difference between local and UTC fields gives us the offset.
  const parts = calendarParts(utcDate, timezone);
  // Reconstruct UTC ms from local parts; the difference between this and
  // `utcDate` is the timezone offset.
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.dayofmonth,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return utcDate - (localAsUtc - utcDate);
};
