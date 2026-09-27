import { getCurrentSession } from "../core/execution-context.js";

/**
 * Pine v6 calendar functions: `year(time, timezone)`, `month(...)`, ...
 *
 * Every function takes a UNIX timestamp in milliseconds and an optional
 * timezone. Per the v6 Reference Manual the timezone accepts UTC/GMT offset
 * notation (`"UTC-5"`, `"GMT+5:30"`) or an IANA name (`"Asia/Kolkata"`), and
 * defaults to `syminfo.timezone`. Outside a running script there is no symbol,
 * so the default falls back to UTC.
 */

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly dayofmonth: number;
  /** Pine numbering: 1 = Sunday ... 7 = Saturday. */
  readonly dayofweek: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const OFFSET_NOTATION = /^(?:UTC|GMT)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/i;

/** Converts Pine timezone notation into an `Intl` time zone identifier. */
const normalizeTimezone = (timezone: string): string => {
  const trimmed = timezone.trim();
  const offset = OFFSET_NOTATION.exec(trimmed);
  if (offset === null) return trimmed;
  const [, sign, hours, minutes] = offset;
  if (sign === undefined || hours === undefined) return "UTC";
  const hh = hours.padStart(2, "0");
  const mm = minutes ?? "00";
  if (Number(hh) > 14 || Number(mm) > 59)
    throw new RangeError(`Invalid timezone offset "${timezone}"`);
  return `${sign}${hh}:${mm}`;
};

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 1,
  Mon: 2,
  Tue: 3,
  Wed: 4,
  Thu: 5,
  Fri: 6,
  Sat: 7,
};

// Formatters are pure, stateless converters keyed only by timezone id; the
// cache holds no runtime, series, or trading state.
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  formatters.set(timeZone, formatter);
  return formatter;
};

const resolveTimezone = (timezone: string | undefined): string =>
  normalizeTimezone(timezone ?? getCurrentSession()?.timezone ?? "UTC");

export const calendarParts = (time: number, timezone?: string): CalendarParts => {
  if (!Number.isFinite(time)) throw new RangeError("time must be a finite UNIX timestamp in ms");
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(resolveTimezone(timezone)).formatToParts(time)) {
    values[part.type] = part.value;
  }
  const weekday = WEEKDAYS[values.weekday ?? ""];
  if (weekday === undefined) throw new Error(`Unexpected weekday "${values.weekday}"`);
  return {
    year: Number(values.year),
    month: Number(values.month),
    dayofmonth: Number(values.day),
    dayofweek: weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

/** Year of `time` in `timezone` (default `syminfo.timezone`). */
export const year = (time: number, timezone?: string): number => calendarParts(time, timezone).year;

/** Month (1-12) of `time` in `timezone`. */
export const month = (time: number, timezone?: string): number =>
  calendarParts(time, timezone).month;

/** Day of month (1-31) of `time` in `timezone`. */
export const dayofmonth = (time: number, timezone?: string): number =>
  calendarParts(time, timezone).dayofmonth;

/** Day of week of `time` in `timezone`: 1 = Sunday ... 7 = Saturday. */
export const dayofweek = (time: number, timezone?: string): number =>
  calendarParts(time, timezone).dayofweek;

/** Hour (0-23) of `time` in `timezone`. */
export const hour = (time: number, timezone?: string): number => calendarParts(time, timezone).hour;

/** Minute (0-59) of `time` in `timezone`. */
export const minute = (time: number, timezone?: string): number =>
  calendarParts(time, timezone).minute;

/** Second (0-59) of `time` in `timezone`. */
export const second = (time: number, timezone?: string): number =>
  calendarParts(time, timezone).second;

/**
 * Week number of `time` in `timezone`.
 *
 * Implemented as the ISO-8601 week of the local calendar date. The v6
 * Reference Manual does not state the week-numbering convention, so this is
 * unverified against TradingView output.
 */
export const weekofyear = (time: number, timezone?: string): number => {
  const parts = calendarParts(time, timezone);
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.dayofmonth));
  const isoWeekday = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - isoWeekday + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayWeekday + 3);
  return 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / 604_800_000);
};
