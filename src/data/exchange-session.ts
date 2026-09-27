/**
 * Session-anchored bar bucketing for exchanges with a fixed trading session.
 *
 * TradingView anchors intraday bars to the session open, not to the UTC
 * epoch: NSE 60-minute bars run 09:15-10:15, ..., 15:15-15:30 IST, with the
 * last bar truncated at the session close. Epoch-aligned bucketing would put
 * the boundaries at :30 IST instead. Every timestamp here is a UNIX time in
 * seconds.
 */
export interface ExchangeSession {
  /** Session open, exchange local time, `"HH:MM"`. */
  readonly open: string;
  /** Session close (exclusive), exchange local time, `"HH:MM"`. */
  readonly close: string;
  /** Exchange UTC offset in minutes (India: +330). The session must not cross midnight. */
  readonly utcOffsetMinutes: number;
  /** IANA timezone of the exchange, reported as `syminfo.timezone`. */
  readonly timezone: string;
}

export interface SessionBucket {
  /** Bucket start (bar time), UNIX seconds. */
  readonly start: number;
  /** Bucket end (exclusive), UNIX seconds; truncated at the session close. */
  readonly end: number;
  /** Session open of the bucket's trading day, UNIX seconds. */
  readonly sessionOpen: number;
}

const SECONDS_PER_DAY = 86_400;

const parseClock = (value: string): number => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (match === null || hours > 23 || minutes > 59) {
    throw new RangeError(`Invalid session time "${value}"; expected "HH:MM"`);
  }
  return hours * 3600 + minutes * 60;
};

/** Validated session bounds in seconds after local midnight. */
const sessionBounds = (
  session: ExchangeSession,
): { open: number; close: number; offset: number } => {
  const open = parseClock(session.open);
  const close = parseClock(session.close);
  if (close <= open) throw new RangeError("Session close must be after open on the same day");
  if (!Number.isInteger(session.utcOffsetMinutes)) {
    throw new RangeError("utcOffsetMinutes must be an integer");
  }
  return { open, close, offset: session.utcOffsetMinutes * 60 };
};

/** Session length in minutes. */
export const sessionMinutes = (session: ExchangeSession): number => {
  const { open, close } = sessionBounds(session);
  return (close - open) / 60;
};

/** Start of the exchange-local calendar day containing `time`, as UNIX seconds. */
export const localDayStart = (time: number, session: ExchangeSession): number => {
  const { offset } = sessionBounds(session);
  return Math.floor((time + offset) / SECONDS_PER_DAY) * SECONDS_PER_DAY - offset;
};

/** Exchange-local calendar date of `time`, `"YYYY-MM-DD"`. */
export const localDate = (time: number, session: ExchangeSession): string => {
  const { offset } = sessionBounds(session);
  return new Date((time + offset) * 1000).toISOString().slice(0, 10);
};

/** Session open and close (UNIX seconds) of the exchange-local day containing `time`. */
export const sessionOfDay = (
  time: number,
  session: ExchangeSession,
): { readonly open: number; readonly close: number } => {
  const { open, close } = sessionBounds(session);
  const day = localDayStart(time, session);
  return { open: day + open, close: day + close };
};

/**
 * Bucket holding `time` for bars of `intervalSeconds`, or undefined when
 * `time` falls outside the session (pre-open, post-close).
 */
export const sessionBucket = (
  time: number,
  intervalSeconds: number,
  session: ExchangeSession,
): SessionBucket | undefined => {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new RangeError("intervalSeconds must be a positive integer");
  }
  const { open, close } = sessionBounds(session);
  const day = localDayStart(time, session);
  const sessionOpen = day + open;
  const sessionClose = day + close;
  if (time < sessionOpen || time >= sessionClose) return undefined;
  const start = sessionOpen + Math.floor((time - sessionOpen) / intervalSeconds) * intervalSeconds;
  return { start, end: Math.min(start + intervalSeconds, sessionClose), sessionOpen };
};

/** India Standard Time sessions (no daylight saving). */
export const NSE_SESSION: ExchangeSession = {
  open: "09:15",
  close: "15:30",
  utcOffsetMinutes: 330,
  timezone: "Asia/Kolkata",
};
