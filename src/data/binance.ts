import type {
  Bar,
  HistoricalBarsRequest,
  MarketDataProvider,
  StreamBarsRequest,
  SymbolInfo,
} from "../core/types.js";
import { parse } from "../time/timeframe.js";
import { ProviderCapabilityError } from "./errors.js";

/**
 * Binance market-data adapter for `@nemesis-oss/binance-sdk` (v3).
 *
 * The runtime never imports the SDK. The interfaces below are the structural
 * subset of the SDK surface the adapter consumes — `SpotMarket` /
 * `FuturesMarket` for REST and `SpotMarketWS` / `FuturesMarketWS` for kline
 * streams — so any SDK market surface can be passed directly:
 *
 * ```ts
 * const client = new BinanceClient({ ... });
 * const provider = new BinanceProvider({ market: client.spot.market, socket: client.spot.ws });
 * ```
 *
 * `tests/binance.test.ts` type-checks the real SDK classes against these
 * contracts.
 */

/** Binance kline intervals (the SDK's `KlineInterval`). */
export type BinanceKlineInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

/** REST kline as parsed by the SDK's `KlineSchema`. */
export interface BinanceKline {
  readonly openTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly closeTime: number;
}

export interface BinanceExchangeSymbol {
  readonly symbol: string;
  readonly status: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly [field: string]: unknown;
}

export interface BinanceExchangeInfo {
  readonly timezone: string;
  readonly symbols: readonly BinanceExchangeSymbol[];
}

/** REST market surface (SDK `SpotMarket` / `FuturesMarket`). */
export interface BinanceMarketRest {
  klines(
    symbol: string,
    interval: BinanceKlineInterval,
    options?: { startTime?: number; endTime?: number; limit?: number },
  ): Promise<readonly BinanceKline[]>;
  exchangeInfo(): Promise<BinanceExchangeInfo>;
}

/** Kline stream surface (SDK `SpotMarketWS` / `FuturesMarketWS`). */
export interface BinanceKlineSocket {
  kline(symbol: string, interval: BinanceKlineInterval): string;
  connect(): void;
  subscribe(streams: string[]): Promise<void>;
  unsubscribe(streams: string[]): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface BinanceProviderOptions {
  readonly market: BinanceMarketRest;
  readonly socket?: BinanceKlineSocket;
  /** Largest kline page per REST call (Binance spot allows 1000; USD-M 1500). */
  readonly pageLimit?: number;
  /** Clock used to decide whether the newest REST kline is still forming. */
  readonly now?: () => number;
  /**
   * Receives socket-level errors. The SDK reconnects on its own, so when a
   * handler is supplied the stream keeps running; without one, the first
   * transport error terminates the bar stream by rejecting the iterator.
   */
  readonly onTransportError?: (error: unknown) => void;
}

const MINUTE_INTERVALS: Readonly<Record<number, BinanceKlineInterval>> = {
  1: "1m",
  3: "3m",
  5: "5m",
  15: "15m",
  30: "30m",
  60: "1h",
  120: "2h",
  240: "4h",
  360: "6h",
  480: "8h",
  720: "12h",
};

/** Maps a Pine timeframe string to a Binance kline interval. */
export const toBinanceInterval = (timeframe: string): BinanceKlineInterval => {
  const info = parse(timeframe);
  const unsupported = (): never => {
    throw new ProviderCapabilityError(`Binance has no kline interval for timeframe "${timeframe}"`);
  };
  if (info.isminutes) return MINUTE_INTERVALS[info.multiplier] ?? unsupported();
  if (info.isdaily && info.multiplier === 1) return "1d";
  if (info.isdaily && info.multiplier === 3) return "3d";
  if (info.isweekly && info.multiplier === 1) return "1w";
  if (info.ismonthly && info.multiplier === 1) return "1M";
  return unsupported();
};

const DEFAULT_PAGE_LIMIT = 1000;

export class BinanceProvider implements MarketDataProvider {
  private readonly pageLimit: number;
  private readonly now: () => number;

  public constructor(private readonly options: BinanceProviderOptions) {
    this.pageLimit = options.pageLimit ?? DEFAULT_PAGE_LIMIT;
    if (!Number.isInteger(this.pageLimit) || this.pageLimit < 1) {
      throw new RangeError("pageLimit must be a positive integer");
    }
    this.now = options.now ?? Date.now;
  }

  /**
   * Fetches `limit` klines (default one page), paging when `limit` exceeds
   * one page. The newest kline is marked `isClosed: false` while its close time is
   * in the future, so the runtime executes it as the open realtime bar.
   */
  public async getHistoricalBars(request: HistoricalBarsRequest): Promise<readonly Bar[]> {
    const interval = toBinanceInterval(request.timeframe);
    const wanted = request.limit ?? this.pageLimit;
    if (!Number.isInteger(wanted) || wanted < 1)
      throw new RangeError("limit must be a positive integer");

    const klines = await this.fetchKlines(request, interval, wanted);
    const now = this.now();
    return klines.map((kline) => toBar(kline, request, kline.closeTime < now));
  }

  /**
   * Without a start time, pages backwards from `endTime` (newest data first);
   * with one, pages forwards from `startTime`. Pages never overlap.
   */
  private async fetchKlines(
    request: HistoricalBarsRequest,
    interval: BinanceKlineInterval,
    wanted: number,
  ): Promise<readonly BinanceKline[]> {
    const forward = request.startTime !== undefined;
    const pages: (readonly BinanceKline[])[] = [];
    let remaining = wanted;
    let startTime = request.startTime;
    let endTime = request.endTime;
    while (remaining > 0) {
      const limit = Math.min(remaining, this.pageLimit);
      const page = await this.options.market.klines(request.symbol, interval, {
        limit,
        ...(startTime === undefined ? {} : { startTime }),
        ...(endTime === undefined ? {} : { endTime }),
      });
      const oldest = page[0];
      const newest = page.at(-1);
      if (oldest === undefined || newest === undefined) break;
      if (forward) pages.push(page);
      else pages.unshift(page);
      remaining -= page.length;
      if (page.length < limit) break;
      if (forward) startTime = newest.closeTime + 1;
      else endTime = oldest.openTime - 1;
    }
    return pages.flat();
  }

  public streamBars(request: StreamBarsRequest): AsyncIterable<Bar> {
    const socket = this.options.socket;
    if (socket === undefined) {
      throw new ProviderCapabilityError("BinanceProvider was created without a kline socket");
    }
    const interval = toBinanceInterval(request.timeframe);
    return {
      [Symbol.asyncIterator]: () =>
        new KlineStreamIterator(socket, request, interval, this.options.onTransportError),
    };
  }

  public async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const info = await this.options.market.exchangeInfo();
    const wanted = symbol.toUpperCase();
    const entry = info.symbols.find((candidate) => candidate.symbol.toUpperCase() === wanted);
    if (entry === undefined) throw new Error(`Binance exchangeInfo has no symbol "${symbol}"`);

    const minTick = filterNumber(entry, "PRICE_FILTER", "tickSize");
    const minContract = filterNumber(entry, "LOT_SIZE", "stepSize");
    return {
      ticker: entry.symbol,
      tickerId: `BINANCE:${entry.symbol}`,
      baseCurrency: entry.baseAsset,
      quoteCurrency: entry.quoteAsset,
      timezone: info.timezone,
      type: "crypto",
      ...(minTick === undefined ? {} : { minTick }),
      ...(minContract === undefined ? {} : { minContract }),
    };
  }
}

const toBar = (
  kline: BinanceKline,
  request: { readonly symbol: string; readonly timeframe: string },
  isClosed: boolean,
): Bar => ({
  time: kline.openTime,
  open: kline.open,
  high: kline.high,
  low: kline.low,
  close: kline.close,
  volume: kline.volume,
  isClosed,
  symbol: request.symbol,
  timeframe: request.timeframe,
});

const filterNumber = (
  entry: BinanceExchangeSymbol,
  filterType: string,
  field: string,
): number | undefined => {
  const filters = entry["filters"];
  if (!Array.isArray(filters)) return undefined;
  const filter: unknown = filters.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>)["filterType"] === filterType,
  );
  if (typeof filter !== "object" || filter === null) return undefined;
  const value = Number((filter as Record<string, unknown>)[field]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const KLINE_FIELDS = ["t", "o", "h", "l", "c", "v"] as const;

/** Validates an SDK `WsKlinePayload` and converts it into a bar. */
const klinePayloadToBar = (payload: unknown, request: StreamBarsRequest): Bar => {
  const kline =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)["k"]
      : undefined;
  if (typeof kline !== "object" || kline === null) {
    throw new TypeError("Binance kline payload is missing its `k` object");
  }
  const fields = kline as Record<string, unknown>;
  const numbers: Partial<Record<(typeof KLINE_FIELDS)[number], number>> = {};
  for (const field of KLINE_FIELDS) {
    const value = fields[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`Binance kline payload field "${field}" is not a finite number`);
    }
    numbers[field] = value;
  }
  if (typeof fields["x"] !== "boolean") {
    throw new TypeError('Binance kline payload field "x" is not a boolean');
  }
  return {
    time: numbers.t ?? Number.NaN,
    open: numbers.o ?? Number.NaN,
    high: numbers.h ?? Number.NaN,
    low: numbers.l ?? Number.NaN,
    close: numbers.c ?? Number.NaN,
    volume: numbers.v ?? Number.NaN,
    isClosed: fields["x"],
    symbol: request.symbol,
    timeframe: request.timeframe,
  };
};

/**
 * Pull-based iterator over pushed kline events. Updates are queued in
 * arrival order and never coalesced: every tick is a realtime revision.
 */
class KlineStreamIterator implements AsyncIterator<Bar> {
  private readonly stream: string;
  private readonly queue: Bar[] = [];
  private failure: { readonly error: unknown } | undefined;
  private waiter: { resolve(): void } | undefined;
  private started: Promise<void> | undefined;
  private finished = false;

  private readonly onMessage = (payload: unknown): void => {
    try {
      this.queue.push(klinePayloadToBar(payload, this.request));
    } catch (error) {
      this.fail(error);
      return;
    }
    this.wake();
  };

  private readonly onError = (error: unknown): void => {
    if (this.onTransportError === undefined) {
      this.fail(error);
      return;
    }
    this.onTransportError(error);
  };

  public constructor(
    private readonly socket: BinanceKlineSocket,
    private readonly request: StreamBarsRequest,
    interval: BinanceKlineInterval,
    private readonly onTransportError: ((error: unknown) => void) | undefined,
  ) {
    this.stream = socket.kline(request.symbol, interval);
  }

  public async next(): Promise<IteratorResult<Bar>> {
    this.started ??= this.start();
    await this.started;
    for (;;) {
      const bar = this.queue.shift();
      if (bar !== undefined) return { value: bar, done: false };
      if (this.failure !== undefined) {
        const { error } = this.failure;
        await this.stop();
        throw error;
      }
      if (this.finished) return { value: undefined, done: true };
      await new Promise<void>((resolve) => {
        this.waiter = { resolve };
      });
    }
  }

  public async return(): Promise<IteratorResult<Bar>> {
    await this.stop();
    return { value: undefined, done: true };
  }

  private async start(): Promise<void> {
    this.socket.on(this.stream, this.onMessage);
    this.socket.on("error", this.onError);
    this.socket.connect();
    await this.socket.subscribe([this.stream]);
  }

  private async stop(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.socket.off(this.stream, this.onMessage);
    this.socket.off("error", this.onError);
    this.wake();
    await this.socket.unsubscribe([this.stream]);
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
