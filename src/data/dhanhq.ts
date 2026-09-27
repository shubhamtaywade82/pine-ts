import type {
  Bar,
  HistoricalBarsRequest,
  MarketDataProvider,
  StreamBarsRequest,
  SymbolInfo,
} from "../core/types.js";
import { parse } from "../time/timeframe.js";
import { ProviderCapabilityError } from "./errors.js";
import {
  NSE_SESSION,
  localDate,
  localDayStart,
  sessionBucket,
  sessionMinutes,
  sessionOfDay,
  type ExchangeSession,
} from "./exchange-session.js";
import { TickBarBuilder, type TickRejection, type TradeTick } from "./tick-bar-builder.js";

/**
 * DhanHQ v2 market-data adapter for `@nemesis-oss/dhanhq-sdk`.
 *
 * The runtime never imports the SDK. The interfaces below are the structural
 * subset of the SDK the adapter consumes — `client.charts`,
 * `client.instruments`, and `client.ws.market` — so the SDK objects can be
 * passed directly:
 *
 * ```ts
 * const client = DhanClient.fromEnv();
 * const provider = new DhanHQProvider({
 *   charts: client.charts,
 *   instruments: client.instruments,
 *   feed: client.ws.market,
 * });
 * await client.ws.connect(); // the caller owns the socket lifecycle
 * ```
 *
 * Symbols are composite keys: `"<exchangeSegment>:<securityId>"`, e.g.
 * `"IDX_I:13"` (NIFTY 50) or `"NSE_FNO:52175"`.
 *
 * Bars are session-anchored (NSE: 09:15 IST), matching TradingView. Minute
 * bars are always built from 1-minute candles (history) or trade ticks
 * (realtime) with the same bucketing, so history and realtime can never
 * disagree on bar boundaries. `tests/dhanhq.test.ts` type-checks the real SDK
 * objects against these contracts.
 */

export type DhanExchangeSegment =
  "NSE_EQ" | "NSE_FNO" | "BSE_EQ" | "BSE_FNO" | "MCX_COMM" | "IDX_I";

export type DhanChartInstrument =
  "INDEX" | "FUTIDX" | "OPTIDX" | "EQUITY" | "FUTSTK" | "OPTSTK" | "FUTCOM" | "OPTFUT";

/** Charts API response: parallel OHLCV arrays with UNIX-second timestamps. */
export interface DhanChartsResponse {
  readonly open?: readonly number[];
  readonly high?: readonly number[];
  readonly low?: readonly number[];
  readonly close?: readonly number[];
  readonly volume?: readonly number[];
  readonly timestamp?: readonly number[];
}

interface DhanChartsRequest {
  securityId: string;
  exchangeSegment: DhanExchangeSegment;
  instrument: DhanChartInstrument;
  fromDate: string;
  toDate: string;
}

/** SDK `client.charts`. */
export interface DhanChartsApi {
  intraday(request: DhanChartsRequest & { interval: "1" }): Promise<DhanChartsResponse>;
  historical(request: DhanChartsRequest): Promise<DhanChartsResponse>;
}

/** Scrip-master row fields the adapter reads (SDK `Instrument`). */
export interface DhanInstrumentRecord {
  readonly securityId: string;
  readonly instrument?: string;
  readonly tickSize?: number;
  readonly symbolName?: string;
  readonly displayName?: string;
}

/** SDK `client.instruments`. */
export interface DhanInstrumentsApi {
  findBySecurityId(
    exchangeSegment: string,
    securityId: string,
  ): Promise<DhanInstrumentRecord | undefined>;
}

export interface DhanFeedSubscription {
  readonly securityId: string;
  readonly exchangeSegment: string;
}

/** SDK `client.ws.market` (`MarketFeedWS`). */
export interface DhanMarketFeed {
  subscribe(instruments: DhanFeedSubscription[]): void;
  unsubscribe(instruments: DhanFeedSubscription[]): void;
  getSubscriptions(): readonly DhanFeedSubscription[];
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * How the feed's `ltt` (last trade time, int32 seconds) maps to UNIX time.
 * The SDK exposes the raw value without stating its epoch base:
 * - `"utc"` — `ltt` is a UNIX timestamp;
 * - `"ist"` — `ltt` is IST wall-clock seconds (UNIX + 19800);
 * - `"auto"` — decided on the first tick by comparing with the clock; the
 *   stream fails if neither reading is within 15 minutes of now.
 */
export type DhanTradeTimeBase = "utc" | "ist" | "auto";

export interface DhanDiscardedTick {
  readonly symbol: string;
  readonly price: number;
  /** Trade time, UNIX seconds. */
  readonly time: number;
  readonly reason: TickRejection;
}

interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DhanHQProviderOptions {
  readonly charts: DhanChartsApi;
  readonly instruments: DhanInstrumentsApi;
  readonly feed?: DhanMarketFeed;
  /**
   * Trading sessions per segment. NSE/BSE cash, F&O, and indices default to
   * 09:15-15:30 IST; MCX has no default and must be configured to be used.
   */
  readonly sessions?: Partial<Record<DhanExchangeSegment, ExchangeSession>>;
  readonly tradeTimeBase?: DhanTradeTimeBase;
  /** Delay after a bucket ends before its bar is closed without a newer tick. */
  readonly closeGraceMs?: number;
  /** Furthest back a historical request reaches, in calendar days. */
  readonly maxLookbackDays?: number;
  readonly now?: () => number;
  readonly scheduler?: Scheduler;
  /** Ticks outside the session, late for a closed bar, or malformed. */
  readonly onDiscardedTick?: (tick: DhanDiscardedTick) => void;
  /**
   * Receives socket errors and exchange disconnect packets. The SDK
   * reconnects on its own, so with a handler the stream keeps running;
   * without one, the first error terminates the stream.
   */
  readonly onTransportError?: (error: unknown) => void;
}

const DEFAULT_SESSIONS: Partial<Record<DhanExchangeSegment, ExchangeSession>> = {
  NSE_EQ: NSE_SESSION,
  NSE_FNO: NSE_SESSION,
  BSE_EQ: NSE_SESSION,
  BSE_FNO: NSE_SESSION,
  IDX_I: NSE_SESSION,
};

const SEGMENTS: readonly DhanExchangeSegment[] = [
  "NSE_EQ",
  "NSE_FNO",
  "BSE_EQ",
  "BSE_FNO",
  "MCX_COMM",
  "IDX_I",
];

const CHART_INSTRUMENTS: readonly DhanChartInstrument[] = [
  "INDEX",
  "FUTIDX",
  "OPTIDX",
  "EQUITY",
  "FUTSTK",
  "OPTSTK",
  "FUTCOM",
  "OPTFUT",
];

const SYMBOL_TYPES: Readonly<Record<DhanChartInstrument, string>> = {
  INDEX: "index",
  EQUITY: "stock",
  FUTIDX: "futures",
  FUTSTK: "futures",
  FUTCOM: "futures",
  OPTIDX: "option",
  OPTSTK: "option",
  OPTFUT: "option",
};

/** The SDK clamps intraday chart requests to 90 days. */
const INTRADAY_WINDOW_DAYS = 90;
const DAILY_WINDOW_DAYS = 3650;
const DEFAULT_LIMIT = 500;
const DEFAULT_MAX_LOOKBACK_DAYS = 365;
const DEFAULT_CLOSE_GRACE_MS = 1500;
const IST_OFFSET_SECONDS = 19_800;
const CLOCK_TOLERANCE_SECONDS = 900;
const SECONDS_PER_DAY = 86_400;

interface DhanInstrumentKey {
  readonly exchangeSegment: DhanExchangeSegment;
  readonly securityId: string;
}

interface InstrumentMeta extends DhanInstrumentKey {
  readonly symbol: string;
  readonly instrument: DhanChartInstrument;
  readonly record: DhanInstrumentRecord;
  readonly session: ExchangeSession;
}

type ResolvedTimeframe =
  { readonly kind: "minutes"; readonly seconds: number } | { readonly kind: "daily" };

/** Parses `"<exchangeSegment>:<securityId>"`. */
export const parseDhanSymbol = (symbol: string): DhanInstrumentKey => {
  const [segment, securityId, ...rest] = symbol.split(":");
  const exchangeSegment = SEGMENTS.find((candidate) => candidate === segment);
  if (exchangeSegment === undefined || securityId === undefined || rest.length > 0) {
    throw new RangeError(
      `Dhan symbol "${symbol}" must be "<exchangeSegment>:<securityId>" with a segment in ${SEGMENTS.join(", ")}`,
    );
  }
  if (!/^\d+$/.test(securityId))
    throw new RangeError(`Dhan securityId "${securityId}" must be numeric`);
  return { exchangeSegment, securityId };
};

export class DhanHQProvider implements MarketDataProvider {
  private readonly now: () => number;
  private readonly scheduler: Scheduler;
  private readonly closeGraceMs: number;
  private readonly maxLookbackDays: number;
  private readonly instrumentCache = new Map<string, Promise<InstrumentMeta>>();
  /** Still-forming last bar of the latest historical request, keyed by symbol + timeframe. */
  private readonly formingBars = new Map<string, Bar>();
  private readonly subscriptionCounts = new Map<string, { count: number; owned: boolean }>();
  private tradeTimeOffset: number | undefined;

  public constructor(private readonly options: DhanHQProviderOptions) {
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.closeGraceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
    this.maxLookbackDays = options.maxLookbackDays ?? DEFAULT_MAX_LOOKBACK_DAYS;
    if (!Number.isFinite(this.closeGraceMs) || this.closeGraceMs < 0) {
      throw new RangeError("closeGraceMs must be a non-negative number");
    }
    if (!Number.isInteger(this.maxLookbackDays) || this.maxLookbackDays < 1) {
      throw new RangeError("maxLookbackDays must be a positive integer");
    }
    const base = options.tradeTimeBase ?? "auto";
    if (base !== "auto") this.tradeTimeOffset = base === "ist" ? IST_OFFSET_SECONDS : 0;
  }

  public async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const meta = await this.instrument(symbol);
    const { record } = meta;
    const minTick = record.tickSize;
    return {
      ticker: record.symbolName ?? record.displayName ?? meta.securityId,
      tickerId: symbol,
      quoteCurrency: "INR",
      timezone: meta.session.timezone,
      type: SYMBOL_TYPES[meta.instrument],
      ...(minTick !== undefined && Number.isFinite(minTick) && minTick > 0 ? { minTick } : {}),
    };
  }

  /**
   * Fetches up to `limit` bars (default 500) ending at `endTime` (default
   * now). The last bar is `isClosed: false` while its bucket is still open;
   * a following {@link streamBars} for the same symbol and timeframe continues
   * it instead of restarting it.
   */
  public async getHistoricalBars(request: HistoricalBarsRequest): Promise<readonly Bar[]> {
    const meta = await this.instrument(request.symbol);
    const timeframe = this.resolveTimeframe(request.timeframe, meta.session);
    const limit = request.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("limit must be a positive integer");

    const endSeconds = Math.floor((request.endTime ?? this.now()) / 1000);
    const startSeconds =
      request.startTime === undefined ? undefined : Math.ceil(request.startTime / 1000);
    const bars =
      timeframe.kind === "daily"
        ? await this.dailyBars(meta, request, startSeconds, endSeconds, limit)
        : await this.minuteBars(meta, request, timeframe.seconds, startSeconds, endSeconds, limit);

    const key = formingKey(request.symbol, request.timeframe);
    const last = bars.at(-1);
    if (last?.isClosed === false) this.formingBars.set(key, last);
    else this.formingBars.delete(key);
    return bars;
  }

  public streamBars(request: StreamBarsRequest): AsyncIterable<Bar> {
    const feed = this.options.feed;
    if (feed === undefined) {
      throw new ProviderCapabilityError("DhanHQProvider was created without a market feed");
    }
    const context: StreamContext = {
      request,
      prepare: () => this.prepareStream(request),
      toUnixSeconds: (tradeTime) => this.toUnixSeconds(tradeTime),
      acquire: (key) => this.acquire(feed, key),
      release: (key) => this.release(feed, key),
      now: this.now,
      scheduler: this.scheduler,
      graceMs: this.closeGraceMs,
      onDiscardedTick: this.options.onDiscardedTick,
      onTransportError: this.options.onTransportError,
    };
    return { [Symbol.asyncIterator]: () => new DhanBarStream(feed, context) };
  }

  private async prepareStream(request: StreamBarsRequest): Promise<{
    readonly key: DhanInstrumentKey;
    readonly builder: TickBarBuilder;
  }> {
    const meta = await this.instrument(request.symbol);
    const timeframe = this.resolveTimeframe(request.timeframe, meta.session);
    const intervalSeconds =
      timeframe.kind === "daily" ? sessionMinutes(meta.session) * 60 : timeframe.seconds;
    const builder = new TickBarBuilder(intervalSeconds, meta.session, {
      symbol: request.symbol,
      timeframe: request.timeframe,
    });
    const forming = this.formingBars.get(formingKey(request.symbol, request.timeframe));
    if (forming !== undefined) builder.seed(forming);
    return { key: meta, builder };
  }

  /** Converts a feed trade time to UNIX seconds, calibrating once when `auto`. */
  private toUnixSeconds(tradeTime: number): number {
    if (this.tradeTimeOffset === undefined) {
      const nowSeconds = this.now() / 1000;
      if (Math.abs(tradeTime - nowSeconds) <= CLOCK_TOLERANCE_SECONDS) this.tradeTimeOffset = 0;
      else if (Math.abs(tradeTime - IST_OFFSET_SECONDS - nowSeconds) <= CLOCK_TOLERANCE_SECONDS) {
        this.tradeTimeOffset = IST_OFFSET_SECONDS;
      } else {
        throw new Error(
          `Cannot calibrate Dhan trade time ${tradeTime} against the clock; set tradeTimeBase explicitly`,
        );
      }
    }
    return tradeTime - this.tradeTimeOffset;
  }

  /**
   * Reference-counted feed subscription. The adapter never
   * unsubscribes an instrument that was subscribed before it acquired it, so
   * it cannot cut off other consumers of a shared `client.ws.market`.
   */
  private acquire(feed: DhanMarketFeed, key: DhanInstrumentKey): void {
    const id = subscriptionId(key);
    const entry = this.subscriptionCounts.get(id);
    if (entry !== undefined) {
      entry.count += 1;
      return;
    }
    const alreadySubscribed = feed
      .getSubscriptions()
      .some((existing) => subscriptionId(existing) === id);
    if (!alreadySubscribed)
      feed.subscribe([{ exchangeSegment: key.exchangeSegment, securityId: key.securityId }]);
    this.subscriptionCounts.set(id, { count: 1, owned: !alreadySubscribed });
  }

  private release(feed: DhanMarketFeed, key: DhanInstrumentKey): void {
    const id = subscriptionId(key);
    const entry = this.subscriptionCounts.get(id);
    if (entry === undefined) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    this.subscriptionCounts.delete(id);
    if (entry.owned)
      feed.unsubscribe([{ exchangeSegment: key.exchangeSegment, securityId: key.securityId }]);
  }

  private resolveTimeframe(timeframe: string, session: ExchangeSession): ResolvedTimeframe {
    const info = parse(timeframe);
    if (info.isminutes && info.multiplier <= sessionMinutes(session)) {
      return { kind: "minutes", seconds: info.multiplier * 60 };
    }
    if (info.isdaily && info.multiplier === 1) return { kind: "daily" };
    throw new ProviderCapabilityError(
      `DhanHQProvider supports minute timeframes up to one session and "1D"; got "${timeframe}"`,
    );
  }

  private instrument(symbol: string): Promise<InstrumentMeta> {
    const cached = this.instrumentCache.get(symbol);
    if (cached !== undefined) return cached;
    const pending = this.loadInstrument(symbol);
    this.instrumentCache.set(symbol, pending);
    // A failed lookup must not be cached forever.
    pending.catch(() => this.instrumentCache.delete(symbol));
    return pending;
  }

  private async loadInstrument(symbol: string): Promise<InstrumentMeta> {
    const key = parseDhanSymbol(symbol);
    const session = { ...DEFAULT_SESSIONS, ...this.options.sessions }[key.exchangeSegment];
    if (session === undefined) {
      throw new ProviderCapabilityError(
        `No trading session configured for ${key.exchangeSegment}; pass options.sessions.${key.exchangeSegment}`,
      );
    }
    const record = await this.options.instruments.findBySecurityId(
      key.exchangeSegment,
      key.securityId,
    );
    if (record === undefined) throw new Error(`Dhan scrip master has no instrument "${symbol}"`);
    const instrument = CHART_INSTRUMENTS.find((candidate) => candidate === record.instrument);
    if (instrument === undefined) {
      throw new ProviderCapabilityError(
        `Dhan instrument type "${String(record.instrument)}" of "${symbol}" has no chart data`,
      );
    }
    return { ...key, symbol, instrument, record, session };
  }

  private async minuteBars(
    meta: InstrumentMeta,
    request: HistoricalBarsRequest,
    intervalSeconds: number,
    startSeconds: number | undefined,
    endSeconds: number,
    limit: number,
  ): Promise<Bar[]> {
    const candles = new Map<number, Candle>();
    const earliest = startSeconds ?? endSeconds - this.maxLookbackDays * SECONDS_PER_DAY;
    let windowEnd = endSeconds;
    let bars: Bar[] = [];
    while (windowEnd >= earliest) {
      const windowStart = Math.max(earliest, windowEnd - INTRADAY_WINDOW_DAYS * SECONDS_PER_DAY);
      const response = await this.options.charts.intraday({
        ...this.chartTarget(meta),
        interval: "1",
        fromDate: localDate(windowStart, meta.session),
        toDate: localDate(windowEnd, meta.session),
      });
      for (const candle of toCandles(response)) candles.set(candle.time, candle);
      bars = aggregate(
        candles,
        intervalSeconds,
        meta.session,
        startSeconds,
        endSeconds,
        this.now(),
        request,
      );
      if (bars.length >= limit) break;
      windowEnd = localDayStart(windowStart, meta.session) - 1;
    }
    return bars.slice(-limit);
  }

  private async dailyBars(
    meta: InstrumentMeta,
    request: HistoricalBarsRequest,
    startSeconds: number | undefined,
    endSeconds: number,
    limit: number,
  ): Promise<Bar[]> {
    // Seven calendar days hold at most five sessions; pad for holidays.
    const spanDays = Math.min(DAILY_WINDOW_DAYS, Math.ceil((limit * 7) / 5) + 10);
    const fromSeconds = startSeconds ?? endSeconds - spanDays * SECONDS_PER_DAY;
    const response = await this.options.charts.historical({
      ...this.chartTarget(meta),
      fromDate: localDate(fromSeconds, meta.session),
      toDate: localDate(endSeconds, meta.session),
    });
    const nowSeconds = this.now() / 1000;
    const bars: Bar[] = [];
    for (const candle of toCandles(response)) {
      // TradingView stamps a daily bar with its session open, whatever time
      // of day the source uses for the date.
      const day = sessionOfDay(candle.time, meta.session);
      if (startSeconds !== undefined && day.open < startSeconds) continue;
      if (day.open > endSeconds) continue;
      bars.push(toBar(candle, day.open, day.close <= nowSeconds, request));
    }
    bars.sort((a, b) => a.time - b.time);
    return dedupeByTime(bars).slice(-limit);
  }

  private chartTarget(meta: InstrumentMeta): {
    securityId: string;
    exchangeSegment: DhanExchangeSegment;
    instrument: DhanChartInstrument;
  } {
    return {
      securityId: meta.securityId,
      exchangeSegment: meta.exchangeSegment,
      instrument: meta.instrument,
    };
  }
}

interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Validates parallel chart arrays; rows with non-finite prices are dropped. */
const toCandles = (response: DhanChartsResponse): Candle[] => {
  const { timestamp, open, high, low, close, volume } = response;
  if (
    timestamp === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  ) {
    return [];
  }
  const candles: Candle[] = [];
  for (const [index, rawTime] of timestamp.entries()) {
    const time = Number(rawTime);
    const candle = {
      // Millisecond timestamps (13 digits) are normalized to seconds, as the SDK does.
      time: time >= 1e12 ? Math.floor(time / 1000) : time,
      open: Number(open[index]),
      high: Number(high[index]),
      low: Number(low[index]),
      close: Number(close[index]),
      volume: Number(volume?.[index] ?? 0),
    };
    const prices = [candle.open, candle.high, candle.low, candle.close];
    if (!Number.isInteger(candle.time) || !prices.every(Number.isFinite)) continue;
    candles.push({ ...candle, volume: Number.isFinite(candle.volume) ? candle.volume : 0 });
  }
  return candles;
};

/** Session-anchored aggregation of 1-minute candles into `intervalSeconds` bars. */
const aggregate = (
  candles: ReadonlyMap<number, Candle>,
  intervalSeconds: number,
  session: ExchangeSession,
  startSeconds: number | undefined,
  endSeconds: number,
  nowMs: number,
  request: HistoricalBarsRequest,
): Bar[] => {
  const ordered = [...candles.values()].sort((a, b) => a.time - b.time);
  const bars: Bar[] = [];
  let bucketEnd = 0;
  for (const candle of ordered) {
    if (candle.time > endSeconds) continue;
    const bucket = sessionBucket(candle.time, intervalSeconds, session);
    if (bucket === undefined) continue;
    if (startSeconds !== undefined && bucket.start < startSeconds) continue;
    const last = bars.at(-1);
    if (last?.time === bucket.start * 1000) {
      bars[bars.length - 1] = {
        ...last,
        high: Math.max(last.high, candle.high),
        low: Math.min(last.low, candle.low),
        close: candle.close,
        volume: last.volume + candle.volume,
      };
      continue;
    }
    if (last !== undefined)
      bars[bars.length - 1] = { ...last, isClosed: bucketEnd * 1000 <= nowMs };
    bars.push(toBar(candle, bucket.start, false, request));
    bucketEnd = bucket.end;
  }
  const last = bars.at(-1);
  if (last !== undefined) bars[bars.length - 1] = { ...last, isClosed: bucketEnd * 1000 <= nowMs };
  return bars;
};

const toBar = (
  candle: Candle,
  startSeconds: number,
  isClosed: boolean,
  request: { readonly symbol: string; readonly timeframe: string },
): Bar => ({
  time: startSeconds * 1000,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  volume: candle.volume,
  isClosed,
  symbol: request.symbol,
  timeframe: request.timeframe,
});

const dedupeByTime = (bars: readonly Bar[]): Bar[] =>
  bars.filter((bar, index) => index === 0 || bars[index - 1]?.time !== bar.time);

const formingKey = (symbol: string, timeframe: string): string => `${symbol}|${timeframe}`;

const subscriptionId = (key: DhanFeedSubscription): string =>
  `${key.exchangeSegment}:${key.securityId}`;

/** Validated trade print from an SDK `tick` event, or undefined for non-trade packets. */
const tradeFromPacket = (
  packet: unknown,
  key: DhanInstrumentKey,
):
  | { readonly price: number; readonly tradeTime: number; readonly cumulativeVolume?: number }
  | undefined => {
  if (typeof packet !== "object" || packet === null) return undefined;
  const fields = packet as Record<string, unknown>;
  if (
    fields["exchangeSegment"] !== key.exchangeSegment ||
    fields["securityId"] !== key.securityId
  ) {
    return undefined;
  }
  const type = fields["type"];
  if (type !== "ticker" && type !== "quote" && type !== "full") return undefined;
  const price = fields["ltp"];
  const tradeTime = fields["ltt"];
  if (typeof price !== "number" || typeof tradeTime !== "number") {
    throw new TypeError(`Dhan ${String(type)} packet has non-numeric ltp/ltt`);
  }
  const volume = fields["volume"];
  if (type === "ticker") return { price, tradeTime };
  if (typeof volume !== "number") throw new TypeError(`Dhan ${type} packet has non-numeric volume`);
  return { price, tradeTime, cumulativeVolume: volume };
};

interface StreamContext {
  readonly request: StreamBarsRequest;
  readonly prepare: () => Promise<{
    readonly key: DhanInstrumentKey;
    readonly builder: TickBarBuilder;
  }>;
  readonly toUnixSeconds: (tradeTime: number) => number;
  readonly acquire: (key: DhanInstrumentKey) => void;
  readonly release: (key: DhanInstrumentKey) => void;
  readonly now: () => number;
  readonly scheduler: Scheduler;
  readonly graceMs: number;
  readonly onDiscardedTick: ((tick: DhanDiscardedTick) => void) | undefined;
  readonly onTransportError: ((error: unknown) => void) | undefined;
}

/**
 * Pull-based bar stream over pushed feed ticks. Every accepted tick yields
 * the open bar's new state; a bar closes on the first tick of a later bucket
 * or, without one, `closeGraceMs` after its bucket ends.
 */
class DhanBarStream implements AsyncIterator<Bar> {
  private readonly queue: Bar[] = [];
  private failure: { readonly error: unknown } | undefined;
  private waiter: { resolve(): void } | undefined;
  private started: Promise<void> | undefined;
  private finished = false;
  private key: DhanInstrumentKey | undefined;
  private builder: TickBarBuilder | undefined;
  private timer: unknown;

  private readonly onTick = (packet: unknown): void => {
    const { key, builder } = this;
    if (key === undefined || builder === undefined || this.finished) return;
    try {
      const trade = tradeFromPacket(packet, key);
      if (trade === undefined) return;
      const tick: TradeTick = {
        price: trade.price,
        time: this.context.toUnixSeconds(trade.tradeTime),
        ...(trade.cumulativeVolume === undefined
          ? {}
          : { cumulativeVolume: trade.cumulativeVolume }),
      };
      const outcome = builder.onTick(tick);
      if (outcome.kind === "rejected") {
        this.context.onDiscardedTick?.({
          symbol: this.context.request.symbol,
          price: tick.price,
          time: tick.time,
          reason: outcome.reason,
        });
        return;
      }
      this.queue.push(...outcome.bars);
      this.scheduleClose();
      this.wake();
    } catch (error) {
      this.fail(error);
    }
  };

  private readonly onError = (error: unknown): void => {
    const handler = this.context.onTransportError;
    if (handler === undefined) this.fail(error);
    else handler(error);
  };

  private readonly onDisconnect = (packet: unknown): void => {
    this.onError(
      new Error(`Dhan market feed disconnect packet: ${JSON.stringify(packet, dropRaw)}`),
    );
  };

  public constructor(
    private readonly feed: DhanMarketFeed,
    private readonly context: StreamContext,
  ) {}

  public async next(): Promise<IteratorResult<Bar>> {
    this.started ??= this.start();
    await this.started;
    for (;;) {
      const bar = this.queue.shift();
      if (bar !== undefined) return { value: bar, done: false };
      if (this.failure !== undefined) {
        const { error } = this.failure;
        this.stop();
        throw error;
      }
      if (this.finished) return { value: undefined, done: true };
      await new Promise<void>((resolve) => {
        this.waiter = { resolve };
      });
    }
  }

  public return(): Promise<IteratorResult<Bar>> {
    this.stop();
    return Promise.resolve({ value: undefined, done: true });
  }

  private async start(): Promise<void> {
    const { key, builder } = await this.context.prepare();
    this.key = key;
    this.builder = builder;
    this.feed.on("tick", this.onTick);
    this.feed.on("disconnect", this.onDisconnect);
    this.feed.on("error", this.onError);
    this.context.acquire(key);
    this.scheduleClose();
  }

  private scheduleClose(): void {
    const end = this.builder?.openBarEnd;
    const { scheduler, now, graceMs } = this.context;
    if (this.timer !== undefined) scheduler.clearTimeout(this.timer);
    this.timer = undefined;
    if (end === undefined || this.finished) return;
    const delay = Math.max(0, end * 1000 + graceMs - now());
    this.timer = scheduler.setTimeout(() => {
      this.timer = undefined;
      const closed = this.builder?.closeDue(Math.floor((now() - graceMs) / 1000));
      if (closed === undefined) {
        this.scheduleClose();
        return;
      }
      this.queue.push(closed);
      this.wake();
    }, delay);
  }

  private stop(): void {
    if (this.finished) return;
    this.finished = true;
    const { scheduler } = this.context;
    if (this.timer !== undefined) scheduler.clearTimeout(this.timer);
    this.timer = undefined;
    this.feed.off("tick", this.onTick);
    this.feed.off("disconnect", this.onDisconnect);
    this.feed.off("error", this.onError);
    if (this.key !== undefined) this.context.release(this.key);
    this.wake();
  }

  private fail(error: unknown): void {
    this.failure ??= { error };
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.resolve();
  }
}

const dropRaw = (key: string, value: unknown): unknown => (key === "raw" ? undefined : value);
