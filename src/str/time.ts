import { consumeQuotedSpan } from "./internal.js";
import type { PineString } from "./core.js";

/**
 * A resolved timezone: either a fixed UTC/GMT offset ("UTC-5", "GMT+0530")
 * or an IANA database name ("America/New_York").
 */
type Zone =
  | { readonly kind: "fixed"; readonly offsetMinutes: number }
  | { readonly kind: "iana"; readonly name: string };

const FIXED_ZONE_PATTERN = /^(?:UTC|GMT)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i;
const ZERO_ZONE_PATTERN = /^(?:UTC|GMT|Etc\/UTC|Etc\/GMT|Z)$/i;

/**
 * Normalizes a Pine timezone spec: "UTC-5", "GMT+0530", plain "UTC", or an
 * IANA name. The v6 default is `syminfo.timezone`; pine-ts scalar calls have
 * no ambient chart, so the documented default here is "UTC".
 */
const normalizeTimeZone = (timeZone: PineString): Zone => {
  const spec = (timeZone ?? "UTC").trim();
  if (spec === "" || ZERO_ZONE_PATTERN.test(spec)) {
    return { kind: "fixed", offsetMinutes: 0 };
  }
  const fixed = FIXED_ZONE_PATTERN.exec(spec);
  if (fixed !== null) {
    const sign = fixed[1] === "-" ? -1 : 1;
    const hours = Number.parseInt(fixed[2]!, 10);
    const minutes = fixed[3] === undefined ? 0 : Number.parseInt(fixed[3], 10);
    return { kind: "fixed", offsetMinutes: sign * (hours * 60 + minutes) };
  }
  // Invalid names surface as the Intl RangeError Pine raises for bad zones.
  return { kind: "iana", name: spec };
};

interface TimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: string;
}

const ianaFormatters = new Map<string, Intl.DateTimeFormat>();

const getIanaFormatter = (name: string): Intl.DateTimeFormat => {
  const cached = ianaFormatters.get(name);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: name,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  ianaFormatters.set(name, formatter);
  return formatter;
};

const getIanaParts = (time: number, name: string): TimeParts => {
  const parts = getIanaFormatter(name).formatToParts(new Date(time));
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(lookup.get("year") ?? "0", 10),
    month: Number.parseInt(lookup.get("month") ?? "0", 10),
    day: Number.parseInt(lookup.get("day") ?? "0", 10),
    hour: Number.parseInt(lookup.get("hour") ?? "0", 10),
    minute: Number.parseInt(lookup.get("minute") ?? "0", 10),
    second: Number.parseInt(lookup.get("second") ?? "0", 10),
    weekday: lookup.get("weekday") ?? "",
  };
};

const getFixedParts = (time: number, offsetMinutes: number): TimeParts => {
  const shifted = new Date(time + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][shifted.getUTCDay()] ?? "",
  };
};

const getParts = (time: number, zone: Zone): TimeParts =>
  zone.kind === "fixed" ? getFixedParts(time, zone.offsetMinutes) : getIanaParts(time, zone.name);

/**
 * Offset of the zone from UTC, in minutes, at the given instant. Fixed zones
 * are constant; IANA zones are derived by re-encoding the zone's wall clock
 * as UTC and diffing, which follows DST transitions correctly.
 */
const getOffsetMinutes = (time: number, zone: Zone): number => {
  if (zone.kind === "fixed") return zone.offsetMinutes;
  const parts = getIanaParts(time, zone.name);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((wallAsUtc - Math.floor(time / 1000) * 1000) / 60_000);
};

const WEEKDAYS_FULL: Readonly<Record<string, string>> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad2 = (value: number): string => String(value).padStart(2, "0");

const renderOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}${pad2(absolute % 60)}`;
};

interface TokenContext {
  readonly parts: TimeParts;
  readonly milliseconds: number;
  readonly offsetMinutes: number;
}

type TokenRenderer = (count: number, context: TokenContext) => string;

const renderHour12 = (hour: number): number => (hour % 12 === 0 ? 12 : hour % 12);

const TOKEN_RENDERERS: Readonly<Record<string, TokenRenderer>> = {
  y: (count, { parts }) => {
    if (count === 2) return pad2(((parts.year % 100) + 100) % 100);
    return count >= 4 ? String(parts.year).padStart(count, "0") : String(parts.year);
  },
  M: (count, { parts }) => {
    if (count === 1) return String(parts.month);
    if (count === 2) return pad2(parts.month);
    if (count === 3) return MONTHS_SHORT[parts.month - 1] ?? "";
    return MONTHS_FULL[parts.month - 1] ?? "";
  },
  d: (count, { parts }) => (count === 1 ? String(parts.day) : pad2(parts.day)),
  E: (count, { parts }) =>
    count >= 4 ? (WEEKDAYS_FULL[parts.weekday] ?? "") : (parts.weekday ?? ""),
  H: (count, { parts }) => (count === 1 ? String(parts.hour) : pad2(parts.hour)),
  h: (count, { parts }) => {
    const hour12 = renderHour12(parts.hour);
    return count === 1 ? String(hour12) : pad2(hour12);
  },
  a: (_count, { parts }) => (parts.hour < 12 ? "AM" : "PM"),
  m: (count, { parts }) => (count === 1 ? String(parts.minute) : pad2(parts.minute)),
  s: (count, { parts }) => (count === 1 ? String(parts.second) : pad2(parts.second)),
  S: (count, { milliseconds }) => String(milliseconds).padStart(3, "0").slice(0, count),
  Z: (_count, { offsetMinutes }) => renderOffset(offsetMinutes),
};

const renderToken = (letter: string, count: number, context: TokenContext): string => {
  const renderer = TOKEN_RENDERERS[letter];
  if (renderer === undefined) {
    throw new RangeError(
      `str.format_time: unsupported pattern letter "${letter}" (supported: y M d E H h a m s S Z)`,
    );
  }
  return renderer(count, context);
};

/** A run of the same pattern letter, e.g. `yyyy` or `SSS`. */
interface LetterRun {
  readonly letter: string;
  readonly count: number;
  readonly nextIndex: number;
}

const consumeLetterRun = (format: string, index: number): LetterRun => {
  const letter = format[index]!;
  let count = 1;
  while (format[index + count] === letter) count += 1;
  return { letter, count, nextIndex: index + count };
};

/**
 * Renders a SimpleDateFormat-style format string. Apostrophes quote literal
 * spans ("yyyy-MM-dd'T'HH:mm:ssZ"); pattern letters y, M, d, E, H, h, a, m,
 * s, S and Z follow the Java token meanings documented in the v6 reference.
 */
const renderFormat = (format: string, context: TokenContext): string => {
  let result = "";
  let index = 0;
  while (index < format.length) {
    const character = format[index]!;
    if (character === "'") {
      const span = consumeQuotedSpan(format, index);
      result += span.literal;
      index = span.nextIndex;
      continue;
    }

    if (/[a-z]/i.test(character)) {
      const run = consumeLetterRun(format, index);
      result += renderToken(run.letter, run.count, context);
      index = run.nextIndex;
      continue;
    }

    result += character;
    index += 1;
  }
  return result;
};

/**
 * str.format_time — converts a UNIX millisecond timestamp into a formatted
 * string. The format string uses Java SimpleDateFormat tokens (default
 * `"yyyy-MM-dd'T'HH:mm:ssZ"`); the timezone accepts UTC/GMT offsets or IANA
 * names and defaults to "UTC" — pine-ts has no ambient `syminfo.timezone` for
 * scalar calls. na time yields na.
 */
export const formatTime = (
  time: number,
  format = "yyyy-MM-dd'T'HH:mm:ssZ",
  timeZone?: PineString,
): PineString => {
  if (Number.isNaN(time)) return undefined;
  if (!Number.isFinite(time)) {
    throw new RangeError("str.format_time requires a finite UNIX millisecond timestamp");
  }
  const zone = normalizeTimeZone(timeZone);
  const context: TokenContext = {
    parts: getParts(time, zone),
    milliseconds: new Date(time).getUTCMilliseconds(),
    offsetMinutes: getOffsetMinutes(time, zone),
  };
  return renderFormat(format, context);
};
