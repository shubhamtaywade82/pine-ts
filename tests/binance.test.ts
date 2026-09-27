import { EventEmitter } from "node:events";
import type {
  FuturesMarket,
  FuturesMarketWS,
  SpotMarket,
  SpotMarketWS,
} from "@nemesis-oss/binance-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BinanceProvider,
  PineRuntime,
  ProviderCapabilityError,
  toBinanceInterval,
} from "../src/index.js";
import type {
  BinanceExchangeInfo,
  BinanceKline,
  BinanceKlineInterval,
  BinanceKlineSocket,
  BinanceMarketRest,
} from "../src/index.js";

describe("SDK conformance", () => {
  it("accepts the real @nemesis-oss/binance-sdk market surfaces", () => {
    expectTypeOf<SpotMarket>().toExtend<BinanceMarketRest>();
    expectTypeOf<FuturesMarket>().toExtend<BinanceMarketRest>();
    expectTypeOf<SpotMarketWS>().toExtend<BinanceKlineSocket>();
    expectTypeOf<FuturesMarketWS>().toExtend<BinanceKlineSocket>();
  });
});

const MINUTE = 60_000;

const kline = (index: number, close: number): BinanceKline => ({
  openTime: index * MINUTE,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10 + index,
  closeTime: (index + 1) * MINUTE - 1,
});

const exchangeInfo: BinanceExchangeInfo = {
  timezone: "UTC",
  symbols: [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
        { filterType: "LOT_SIZE", stepSize: "0.00001000" },
      ],
    },
  ],
};

interface KlineCall {
  readonly limit?: number;
  readonly startTime?: number;
  readonly endTime?: number;
}

/** In-memory REST market holding klines 0..count-1. */
class FakeMarket implements BinanceMarketRest {
  public readonly calls: KlineCall[] = [];

  public constructor(private readonly count: number) {}

  public klines = async (
    _symbol: string,
    _interval: BinanceKlineInterval,
    options: KlineCall = {},
  ): Promise<readonly BinanceKline[]> => {
    this.calls.push(options);
    const all = Array.from({ length: this.count }, (_, index) => kline(index, 100 + index));
    const inRange = all.filter(
      (candidate) =>
        (options.startTime === undefined || candidate.openTime >= options.startTime) &&
        (options.endTime === undefined || candidate.openTime <= options.endTime),
    );
    const limit = options.limit ?? 500;
    return options.startTime === undefined ? inRange.slice(-limit) : inRange.slice(0, limit);
  };

  public exchangeInfo = async (): Promise<BinanceExchangeInfo> => exchangeInfo;
}

/** Event-emitting socket mirroring the SDK's BaseWS stream contract. */
class FakeSocket extends EventEmitter implements BinanceKlineSocket {
  public readonly subscribed: string[] = [];
  public readonly unsubscribed: string[] = [];
  public connects = 0;

  public kline = (symbol: string, interval: BinanceKlineInterval): string =>
    `${symbol.toLowerCase()}@kline_${interval}`;

  public connect = (): void => {
    this.connects += 1;
  };

  public subscribe = async (streams: string[]): Promise<void> => {
    this.subscribed.push(...streams);
  };

  public unsubscribe = async (streams: string[]): Promise<void> => {
    this.unsubscribed.push(...streams);
  };

  public push(stream: string, payload: unknown): void {
    this.emit(stream, payload);
  }
}

const wsKline = (time: number, close: number, closed: boolean): unknown => ({
  e: "kline",
  E: time,
  s: "BTCUSDT",
  k: {
    t: time,
    T: time + MINUTE - 1,
    s: "BTCUSDT",
    i: "1m",
    o: close,
    h: close,
    l: close,
    c: close,
    v: 5,
    x: closed,
  },
});

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe("toBinanceInterval", () => {
  it.each([
    ["1", "1m"],
    ["15", "15m"],
    ["60", "1h"],
    ["240", "4h"],
    ["720", "12h"],
    ["1D", "1d"],
    ["3D", "3d"],
    ["W", "1w"],
    ["1M", "1M"],
  ] as const)("maps %s to %s", (timeframe, interval) => {
    expect(toBinanceInterval(timeframe)).toBe(interval);
  });

  it.each(["7", "90", "2D", "2W", "3M", "30S", "1T"])(
    "rejects %s as provider-limited",
    (timeframe) => {
      expect(() => toBinanceInterval(timeframe)).toThrow(ProviderCapabilityError);
    },
  );
});

describe("BinanceProvider REST", () => {
  it("maps klines to bars and marks a still-forming newest kline as open", async () => {
    const market = new FakeMarket(3);
    // Now is inside kline 2's interval.
    const provider = new BinanceProvider({ market, now: () => 2 * MINUTE + 5 });
    const bars = await provider.getHistoricalBars({ symbol: "BTCUSDT", timeframe: "1", limit: 3 });

    expect(bars.map((bar) => [bar.time, bar.close, bar.isClosed])).toEqual([
      [0, 100, true],
      [MINUTE, 101, true],
      [2 * MINUTE, 102, false],
    ]);
    expect(bars[0]).toMatchObject({ open: 99, high: 101, low: 98, volume: 10, symbol: "BTCUSDT" });
  });

  it("pages backwards when the limit exceeds one page", async () => {
    const market = new FakeMarket(10);
    const provider = new BinanceProvider({ market, pageLimit: 4, now: () => 100 * MINUTE });
    const bars = await provider.getHistoricalBars({ symbol: "BTCUSDT", timeframe: "1", limit: 9 });

    expect(bars.map((bar) => bar.time / MINUTE)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(market.calls).toEqual([
      { limit: 4 },
      { limit: 4, endTime: 6 * MINUTE - 1 },
      { limit: 1, endTime: 2 * MINUTE - 1 },
    ]);
  });

  it("pages forwards from startTime", async () => {
    const market = new FakeMarket(10);
    const provider = new BinanceProvider({ market, pageLimit: 3, now: () => 100 * MINUTE });
    const bars = await provider.getHistoricalBars({
      symbol: "BTCUSDT",
      timeframe: "1",
      startTime: 2 * MINUTE,
      limit: 7,
    });

    expect(bars.map((bar) => bar.time / MINUTE)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(market.calls).toEqual([
      { limit: 3, startTime: 2 * MINUTE },
      { limit: 3, startTime: 5 * MINUTE },
      { limit: 1, startTime: 8 * MINUTE },
    ]);
  });

  it("stops paging when history runs out", async () => {
    const market = new FakeMarket(5);
    const provider = new BinanceProvider({ market, pageLimit: 4, now: () => 100 * MINUTE });
    const bars = await provider.getHistoricalBars({ symbol: "BTCUSDT", timeframe: "1", limit: 20 });

    expect(bars.map((bar) => bar.time / MINUTE)).toEqual([0, 1, 2, 3, 4]);
  });

  it("builds SymbolInfo from exchangeInfo filters", async () => {
    const provider = new BinanceProvider({ market: new FakeMarket(0) });
    await expect(provider.getSymbolInfo("btcusdt")).resolves.toEqual({
      ticker: "BTCUSDT",
      tickerId: "BINANCE:BTCUSDT",
      baseCurrency: "BTC",
      quoteCurrency: "USDT",
      timezone: "UTC",
      type: "crypto",
      minTick: 0.01,
      minContract: 0.00001,
    });
    await expect(provider.getSymbolInfo("NOPE")).rejects.toThrow(/no symbol/);
  });

  it("rejects invalid options", async () => {
    expect(() => new BinanceProvider({ market: new FakeMarket(0), pageLimit: 0 })).toThrow(
      RangeError,
    );
    const provider = new BinanceProvider({ market: new FakeMarket(0) });
    await expect(
      provider.getHistoricalBars({ symbol: "BTCUSDT", timeframe: "1", limit: 0 }),
    ).rejects.toThrow(RangeError);
  });
});

describe("BinanceProvider stream", () => {
  it("yields every kline update in order and unsubscribes on return", async () => {
    const socket = new FakeSocket();
    const provider = new BinanceProvider({ market: new FakeMarket(0), socket });
    const iterator = provider
      .streamBars({ symbol: "BTCUSDT", timeframe: "1" })
      [Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    expect(socket.subscribed).toEqual(["btcusdt@kline_1m"]);
    expect(socket.connects).toBe(1);

    socket.push("btcusdt@kline_1m", wsKline(0, 10, false));
    socket.push("btcusdt@kline_1m", wsKline(0, 11, true));
    socket.push("ethusdt@kline_1m", wsKline(0, 99, true));

    await expect(first).resolves.toMatchObject({
      done: false,
      value: { time: 0, close: 10, isClosed: false },
    });
    await expect(iterator.next()).resolves.toMatchObject({ value: { close: 11, isClosed: true } });

    await iterator.return?.();
    expect(socket.unsubscribed).toEqual(["btcusdt@kline_1m"]);
    expect(socket.listenerCount("btcusdt@kline_1m")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
  });

  it("rejects the iterator on a malformed payload", async () => {
    const socket = new FakeSocket();
    const provider = new BinanceProvider({ market: new FakeMarket(0), socket });
    const iterator = provider
      .streamBars({ symbol: "BTCUSDT", timeframe: "1" })
      [Symbol.asyncIterator]();

    const pending = iterator.next();
    await flush();
    socket.push("btcusdt@kline_1m", { e: "kline", k: { t: 0, o: "1" } });
    await expect(pending).rejects.toThrow(TypeError);
    expect(socket.unsubscribed).toEqual(["btcusdt@kline_1m"]);
  });

  it("terminates on a transport error unless a handler is supplied", async () => {
    const failing = new FakeSocket();
    const strict = new BinanceProvider({ market: new FakeMarket(0), socket: failing });
    const strictIterator = strict
      .streamBars({ symbol: "BTCUSDT", timeframe: "1" })
      [Symbol.asyncIterator]();
    const strictNext = strictIterator.next();
    await flush();
    failing.emit("error", new Error("socket reset"));
    await expect(strictNext).rejects.toThrow("socket reset");

    const reported: unknown[] = [];
    const tolerant = new FakeSocket();
    const lenient = new BinanceProvider({
      market: new FakeMarket(0),
      socket: tolerant,
      onTransportError: (error) => reported.push(error),
    });
    const lenientIterator = lenient
      .streamBars({ symbol: "BTCUSDT", timeframe: "1" })
      [Symbol.asyncIterator]();
    const lenientNext = lenientIterator.next();
    await flush();
    tolerant.emit("error", new Error("socket reset"));
    tolerant.push("btcusdt@kline_1m", wsKline(0, 12, true));
    await expect(lenientNext).resolves.toMatchObject({ value: { close: 12 } });
    expect(reported).toHaveLength(1);
    await lenientIterator.return?.();
  });

  it("requires a socket to stream", () => {
    const provider = new BinanceProvider({ market: new FakeMarket(0) });
    expect(() => provider.streamBars({ symbol: "BTCUSDT", timeframe: "1" })).toThrow(
      ProviderCapabilityError,
    );
  });
});

describe("BinanceProvider with PineRuntime", () => {
  it("hands a still-forming REST kline to the realtime stream", async () => {
    const socket = new FakeSocket();
    const provider = new BinanceProvider({
      market: new FakeMarket(3),
      socket,
      now: () => 2 * MINUTE + 5,
    });
    const runtime = new PineRuntime({ provider, symbol: "BTCUSDT", timeframe: "1" });
    const seen: Array<[number, boolean, boolean]> = [];
    const script = (ctx: Parameters<Parameters<PineRuntime["run"]>[0]>[0]): void => {
      seen.push([ctx.close.value, ctx.barstate.isrealtime, ctx.barstate.isconfirmed]);
    };

    await runtime.run(script);
    expect(seen).toEqual([
      [100, false, true],
      [101, false, true],
      [102, true, false],
    ]);

    const realtime = runtime.runRealtime(script);
    await flush();
    socket.push("btcusdt@kline_1m", wsKline(2 * MINUTE, 103, true));
    socket.push("btcusdt@kline_1m", wsKline(3 * MINUTE, 104, false));
    await flush();
    expect(seen.slice(3)).toEqual([
      [103, true, true],
      [104, true, false],
    ]);
    expect(runtime.sources.close.history()).toEqual([100, 101, 103]);

    // Terminate the stream so the realtime loop settles.
    socket.emit("error", new Error("stop"));
    await expect(realtime).rejects.toThrow("stop");
  });
});
