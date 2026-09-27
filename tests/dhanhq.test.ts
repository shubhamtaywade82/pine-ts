import { EventEmitter } from "node:events";
import type { DhanClient } from "@nemesis-oss/dhanhq-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DhanHQProvider,
  NSE_SESSION,
  PineRuntime,
  ProviderCapabilityError,
  parseDhanSymbol,
} from "../src/index.js";
import type {
  DhanChartsApi,
  DhanChartsResponse,
  DhanDiscardedTick,
  DhanFeedSubscription,
  DhanHQProviderOptions,
  DhanInstrumentRecord,
  DhanInstrumentsApi,
  DhanMarketFeed,
} from "../src/index.js";
import { sessionBucket } from "../src/data/exchange-session.js";
import { TickBarBuilder } from "../src/data/tick-bar-builder.js";

describe("SDK conformance", () => {
  it("accepts the real @nemesis-oss/dhanhq-sdk client surfaces", () => {
    expectTypeOf<DhanClient["charts"]>().toExtend<DhanChartsApi>();
    expectTypeOf<DhanClient["instruments"]>().toExtend<DhanInstrumentsApi>();
    expectTypeOf<DhanClient["ws"]["market"]>().toExtend<DhanMarketFeed>();
  });
});

/** UNIX seconds for an IST wall-clock time on 2026-09-28 (a Monday) plus `days`. */
const ist = (hhmm: string, days = 0): number => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 28 + days, (hours ?? 0) - 5, (minutes ?? 0) - 30) / 1000;
};

describe("session-anchored buckets", () => {
  it("anchors NSE 60-minute bars at 09:15 IST and truncates the last bar at 15:30", () => {
    const starts: number[] = [];
    for (let time = ist("09:15"); time < ist("15:30"); time += 60) {
      const bucket = sessionBucket(time, 3600, NSE_SESSION);
      if (bucket !== undefined && starts.at(-1) !== bucket.start) starts.push(bucket.start);
    }
    expect(starts).toEqual(
      ["09:15", "10:15", "11:15", "12:15", "13:15", "14:15", "15:15"].map((clock) => ist(clock)),
    );
    expect(sessionBucket(ist("15:20"), 3600, NSE_SESSION)?.end).toBe(ist("15:30"));
  });

  it("returns no bucket before the open or at and after the close", () => {
    expect(sessionBucket(ist("09:14"), 60, NSE_SESSION)).toBeUndefined();
    expect(sessionBucket(ist("15:30"), 60, NSE_SESSION)).toBeUndefined();
    expect(sessionBucket(ist("09:15"), 60, NSE_SESSION)?.start).toBe(ist("09:15"));
  });

  it("supports intervals that do not divide the session (25 minutes)", () => {
    expect(sessionBucket(ist("09:41"), 1500, NSE_SESSION)?.start).toBe(ist("09:40"));
    expect(sessionBucket(ist("15:29"), 1500, NSE_SESSION)).toMatchObject({
      start: ist("15:05"),
      end: ist("15:30"),
    });
  });
});

describe("TickBarBuilder", () => {
  const builder = (): TickBarBuilder =>
    new TickBarBuilder(300, NSE_SESSION, { symbol: "NSE_EQ:2885", timeframe: "5" });

  it("builds OHLC and per-bar volume from cumulative session volume", () => {
    const bars = builder();
    bars.onTick({ price: 100, time: ist("09:15"), cumulativeVolume: 1000 });
    bars.onTick({ price: 103, time: ist("09:16"), cumulativeVolume: 1500 });
    const update = bars.onTick({ price: 99, time: ist("09:19"), cumulativeVolume: 1800 });

    expect(update).toMatchObject({
      kind: "bars",
      bars: [
        {
          time: ist("09:15") * 1000,
          open: 100,
          high: 103,
          low: 99,
          close: 99,
          volume: 800,
          isClosed: false,
        },
      ],
    });

    const next = bars.onTick({ price: 101, time: ist("09:20"), cumulativeVolume: 2000 });
    expect(next).toMatchObject({
      kind: "bars",
      bars: [
        { time: ist("09:15") * 1000, close: 99, volume: 800, isClosed: true },
        { time: ist("09:20") * 1000, open: 101, volume: 200, isClosed: false },
      ],
    });
  });

  it("closes the open bar when its bucket ends and rejects late ticks afterwards", () => {
    const bars = builder();
    bars.onTick({ price: 100, time: ist("09:15") });
    expect(bars.closeDue(ist("09:19"))).toBeUndefined();
    expect(bars.closeDue(ist("09:20"))).toMatchObject({ isClosed: true, close: 100 });
    expect(bars.onTick({ price: 101, time: ist("09:19") })).toEqual({
      kind: "rejected",
      reason: "late",
    });
  });

  it("rejects out-of-session, older-bucket, and malformed ticks", () => {
    const bars = builder();
    expect(bars.onTick({ price: 100, time: ist("09:10") })).toEqual({
      kind: "rejected",
      reason: "outside_session",
    });
    bars.onTick({ price: 100, time: ist("09:25") });
    expect(bars.onTick({ price: 100, time: ist("09:21") })).toEqual({
      kind: "rejected",
      reason: "late",
    });
    expect(bars.onTick({ price: 0, time: ist("09:26") })).toEqual({
      kind: "rejected",
      reason: "invalid",
    });
    expect(bars.onTick({ price: Number.NaN, time: ist("09:26") })).toEqual({
      kind: "rejected",
      reason: "invalid",
    });
  });

  it("continues a seeded bar and attributes the seed volume", () => {
    const bars = builder();
    bars.seed({
      time: ist("09:15") * 1000,
      open: 100,
      high: 105,
      low: 98,
      close: 104,
      volume: 700,
      isClosed: false,
    });
    const update = bars.onTick({ price: 106, time: ist("09:18"), cumulativeVolume: 5000 });
    bars.onTick({ price: 103, time: ist("09:19"), cumulativeVolume: 5100 });
    expect(update).toMatchObject({
      bars: [{ open: 100, high: 106, low: 98, close: 106, volume: 700 }],
    });
    expect(bars.closeDue(ist("09:20"))).toMatchObject({
      open: 100,
      high: 106,
      low: 98,
      close: 103,
      volume: 800,
    });
  });

  it("restarts the volume base on a new session", () => {
    const bars = builder();
    bars.onTick({ price: 100, time: ist("15:25"), cumulativeVolume: 90_000 });
    bars.onTick({ price: 100, time: ist("15:29"), cumulativeVolume: 91_000 });
    const nextDay = bars.onTick({ price: 101, time: ist("09:16", 1), cumulativeVolume: 400 });
    expect(nextDay).toMatchObject({ bars: [{ volume: 1000, isClosed: true }, { volume: 400 }] });
  });
});

interface IntradayCall {
  readonly fromDate: string;
  readonly toDate: string;
}

/** 1-minute candles for full sessions on the given day offsets. */
const minuteCandles = (dayOffsets: readonly number[]): Required<DhanChartsResponse> => {
  const response = {
    open: [] as number[],
    high: [] as number[],
    low: [] as number[],
    close: [] as number[],
    volume: [] as number[],
    timestamp: [] as number[],
  };
  for (const day of dayOffsets) {
    for (
      let time = ist("09:15", day), index = 0;
      time < ist("15:30", day);
      time += 60, index += 1
    ) {
      const price = 1000 + day * 10 + index * 0.5;
      response.timestamp.push(time);
      response.open.push(price);
      response.high.push(price + 1);
      response.low.push(price - 1);
      response.close.push(price + 0.25);
      response.volume.push(10);
    }
  }
  return response;
};

class FakeCharts implements DhanChartsApi {
  public readonly intradayCalls: IntradayCall[] = [];
  public readonly historicalCalls: IntradayCall[] = [];

  public constructor(
    private readonly minute: Required<DhanChartsResponse>,
    private readonly daily: DhanChartsResponse = {},
  ) {}

  public intraday = async (request: IntradayCall): Promise<DhanChartsResponse> => {
    this.intradayCalls.push({ fromDate: request.fromDate, toDate: request.toDate });
    const inRange = (time: number): boolean => {
      const date = new Date((time + 19_800) * 1000).toISOString().slice(0, 10);
      return date >= request.fromDate && date <= request.toDate;
    };
    const keep = this.minute.timestamp.map(inRange);
    const pick = (values: readonly number[]): number[] => values.filter((_, index) => keep[index]);
    return {
      timestamp: pick(this.minute.timestamp),
      open: pick(this.minute.open),
      high: pick(this.minute.high),
      low: pick(this.minute.low),
      close: pick(this.minute.close),
      volume: pick(this.minute.volume),
    };
  };

  public historical = async (request: IntradayCall): Promise<DhanChartsResponse> => {
    this.historicalCalls.push({ fromDate: request.fromDate, toDate: request.toDate });
    return this.daily;
  };
}

const records: Readonly<Record<string, DhanInstrumentRecord>> = {
  "IDX_I:13": { securityId: "13", instrument: "INDEX", symbolName: "NIFTY", tickSize: 0.05 },
  "NSE_FNO:52175": {
    securityId: "52175",
    instrument: "OPTIDX",
    symbolName: "NIFTY-OPT",
    tickSize: 0.05,
  },
  "NSE_EQ:2885": {
    securityId: "2885",
    instrument: "EQUITY",
    symbolName: "RELIANCE",
    tickSize: 0.1,
  },
  "MCX_COMM:1": { securityId: "1", instrument: "FUTCOM", symbolName: "CRUDE" },
  "NSE_EQ:9": { securityId: "9", instrument: "BOND" },
};

const instruments: DhanInstrumentsApi = {
  findBySecurityId: async (segment, securityId) => records[`${segment}:${securityId}`],
};

class ManualScheduler {
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  public constructor(private readonly clock: { now: number }) {}

  public setTimeout = (callback: () => void, delayMs: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.clock.now + delayMs, callback });
    return id;
  };

  public clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  public advanceTo(timeMs: number): void {
    this.clock.now = timeMs;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > timeMs) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }
}

class FakeFeed extends EventEmitter implements DhanMarketFeed {
  public readonly subscriptions: DhanFeedSubscription[] = [];
  public readonly unsubscribed: DhanFeedSubscription[] = [];

  public subscribe = (instruments: DhanFeedSubscription[]): void => {
    this.subscriptions.push(...instruments);
  };

  public unsubscribe = (instruments: DhanFeedSubscription[]): void => {
    this.unsubscribed.push(...instruments);
    for (const instrument of instruments) {
      const index = this.subscriptions.findIndex(
        (existing) =>
          existing.exchangeSegment === instrument.exchangeSegment &&
          existing.securityId === instrument.securityId,
      );
      if (index >= 0) this.subscriptions.splice(index, 1);
    }
  };

  public getSubscriptions = (): readonly DhanFeedSubscription[] => this.subscriptions;

  public quote(
    securityId: string,
    segment: string,
    ltp: number,
    ltt: number,
    volume: number,
  ): void {
    this.emit("tick", {
      type: "quote",
      exchangeSegment: segment,
      securityId,
      ltp,
      ltt,
      volume,
      raw: Buffer.alloc(0),
    });
  }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

const providerWith = (overrides: Partial<DhanHQProviderOptions> = {}): DhanHQProvider =>
  new DhanHQProvider({ charts: new FakeCharts(minuteCandles([0])), instruments, ...overrides });

describe("parseDhanSymbol", () => {
  it("parses segment:securityId composite keys", () => {
    expect(parseDhanSymbol("IDX_I:13")).toEqual({ exchangeSegment: "IDX_I", securityId: "13" });
  });

  it.each(["NIFTY", "NSE:13", "IDX_I:abc", "IDX_I:13:x", "IDX_I:"])("rejects %s", (symbol) => {
    expect(() => parseDhanSymbol(symbol)).toThrow(RangeError);
  });
});

describe("DhanHQProvider symbol info", () => {
  it("maps scrip-master metadata to SymbolInfo", async () => {
    const provider = providerWith();
    await expect(provider.getSymbolInfo("IDX_I:13")).resolves.toEqual({
      ticker: "NIFTY",
      tickerId: "IDX_I:13",
      quoteCurrency: "INR",
      timezone: "Asia/Kolkata",
      type: "index",
      minTick: 0.05,
    });
    await expect(provider.getSymbolInfo("NSE_FNO:52175")).resolves.toMatchObject({
      type: "option",
    });
  });

  it("fails explicitly for unknown instruments, chartless types, and unconfigured sessions", async () => {
    const provider = providerWith();
    await expect(provider.getSymbolInfo("NSE_EQ:404")).rejects.toThrow(/no instrument/);
    await expect(provider.getSymbolInfo("NSE_EQ:9")).rejects.toThrow(ProviderCapabilityError);
    await expect(provider.getSymbolInfo("MCX_COMM:1")).rejects.toThrow(ProviderCapabilityError);
    const configured = providerWith({
      sessions: {
        MCX_COMM: {
          open: "09:00",
          close: "23:30",
          utcOffsetMinutes: 330,
          timezone: "Asia/Kolkata",
        },
      },
    });
    await expect(configured.getSymbolInfo("MCX_COMM:1")).resolves.toMatchObject({
      type: "futures",
    });
  });
});

describe("DhanHQProvider history", () => {
  it("aggregates 1-minute candles into session-anchored bars and marks the forming bar open", async () => {
    const charts = new FakeCharts(minuteCandles([0]));
    // 10:07 IST: the 10:00 bucket (09:15 + 3 x 15m) is still forming.
    const provider = providerWith({ charts, now: () => ist("10:07") * 1000 });
    const bars = await provider.getHistoricalBars({
      symbol: "IDX_I:13",
      timeframe: "15",
      endTime: ist("10:07") * 1000,
    });

    expect(bars.map((bar) => bar.time / 1000)).toEqual([
      ist("09:15"),
      ist("09:30"),
      ist("09:45"),
      ist("10:00"),
    ]);
    expect(bars.map((bar) => bar.isClosed)).toEqual([true, true, true, false]);
    // First bucket: minutes 0..14 of the session.
    expect(bars[0]).toMatchObject({
      open: 1000,
      high: 1008,
      low: 999,
      close: 1007.25,
      volume: 150,
    });
    // Forming bucket holds 10:00..10:07 (8 minutes).
    expect(bars[3]).toMatchObject({ open: 1022.5, close: 1026.25, volume: 80 });
    expect(charts.intradayCalls[0]).toEqual({ fromDate: "2026-06-30", toDate: "2026-09-28" });
  });

  it("pages back in 90-day windows until the limit is met", async () => {
    const charts = new FakeCharts(minuteCandles([-120, -1, 0]));
    const provider = providerWith({ charts, now: () => ist("16:00") * 1000 });
    const bars = await provider.getHistoricalBars({
      symbol: "IDX_I:13",
      timeframe: "60",
      limit: 15,
      endTime: ist("16:00") * 1000,
    });

    // Seven hourly bars per session: two recent sessions give 14, the 15th is
    // the last bar of the session 120 days back, in the second window.
    expect(bars).toHaveLength(15);
    expect(bars[0]?.time).toBe(ist("15:15", -120) * 1000);
    expect(bars.every((bar) => bar.isClosed)).toBe(true);
    expect(charts.intradayCalls).toEqual([
      { fromDate: "2026-06-30", toDate: "2026-09-28" },
      { fromDate: "2026-03-31", toDate: "2026-06-29" },
    ]);
  });

  it("stamps daily bars with the session open of their IST date", async () => {
    const daily: DhanChartsResponse = {
      // Dhan-style dates at 00:00 IST (18:30 UTC of the previous day).
      timestamp: [ist("00:00", -1), ist("00:00")],
      open: [100, 110],
      high: [105, 115],
      low: [95, 108],
      close: [104, 112],
      volume: [1, 2],
    };
    const provider = providerWith({
      charts: new FakeCharts(minuteCandles([]), daily),
      now: () => ist("12:00") * 1000,
    });
    const bars = await provider.getHistoricalBars({
      symbol: "NSE_EQ:2885",
      timeframe: "1D",
      endTime: ist("12:00") * 1000,
    });

    expect(bars.map((bar) => [bar.time / 1000, bar.isClosed])).toEqual([
      [ist("09:15", -1), true],
      [ist("09:15"), false],
    ]);
  });

  it.each(["30S", "1W", "1M", "400"])("rejects unsupported timeframe %s", async (timeframe) => {
    await expect(
      providerWith().getHistoricalBars({ symbol: "IDX_I:13", timeframe }),
    ).rejects.toThrow(ProviderCapabilityError);
  });
});

describe("DhanHQProvider stream", () => {
  const setup = (overrides: Partial<DhanHQProviderOptions> = {}) => {
    const clock = { now: ist("10:07") * 1000 };
    const scheduler = new ManualScheduler(clock);
    const feed = new FakeFeed();
    const discarded: DhanDiscardedTick[] = [];
    const provider = providerWith({
      feed,
      now: () => clock.now,
      scheduler,
      closeGraceMs: 1000,
      tradeTimeBase: "utc",
      onDiscardedTick: (tick) => discarded.push(tick),
      ...overrides,
    });
    return { clock, scheduler, feed, discarded, provider };
  };

  it("streams tick-built bars and closes a bar by timer when no newer tick arrives", async () => {
    const { scheduler, feed, provider } = setup();
    const iterator = provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    const first = iterator.next();
    await flush();
    expect(feed.subscriptions).toEqual([{ exchangeSegment: "NSE_EQ", securityId: "2885" }]);

    feed.quote("2885", "NSE_EQ", 2500, ist("10:07"), 10_000);
    feed.quote("9999", "NSE_EQ", 1, ist("10:07"), 1);
    feed.quote("2885", "NSE_EQ", 2505, ist("10:08"), 10_300);
    await expect(first).resolves.toMatchObject({
      value: { time: ist("10:05") * 1000, close: 2500, isClosed: false },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { close: 2505, volume: 300, isClosed: false },
    });

    scheduler.advanceTo(ist("10:10") * 1000 + 999);
    const pending = iterator.next();
    await flush();
    scheduler.advanceTo(ist("10:10") * 1000 + 1000);
    await expect(pending).resolves.toMatchObject({
      value: { time: ist("10:05") * 1000, close: 2505, isClosed: true },
    });

    await iterator.return?.();
    expect(feed.unsubscribed).toEqual([{ exchangeSegment: "NSE_EQ", securityId: "2885" }]);
    expect(feed.listenerCount("tick")).toBe(0);
  });

  it("calibrates IST-based trade times automatically and reports discarded ticks", async () => {
    const { feed, discarded, provider } = setup({ tradeTimeBase: "auto" });
    const iterator = provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    const first = iterator.next();
    await flush();

    feed.quote("2885", "NSE_EQ", 2500, ist("10:07") + 19_800, 10_000);
    await expect(first).resolves.toMatchObject({ value: { time: ist("10:05") * 1000 } });
    feed.quote("2885", "NSE_EQ", 2400, ist("09:00") + 19_800, 10_100);
    expect(discarded).toEqual([
      { symbol: "NSE_EQ:2885", price: 2400, time: ist("09:00"), reason: "outside_session" },
    ]);
    await iterator.return?.();
  });

  it("fails the stream when auto calibration cannot place the trade time", async () => {
    const { feed, provider } = setup({ tradeTimeBase: "auto" });
    const iterator = provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    const first = iterator.next();
    await flush();
    feed.quote("2885", "NSE_EQ", 2500, ist("10:07") - 7200, 1);
    await expect(first).rejects.toThrow(/calibrate/);
  });

  it("never unsubscribes an instrument another consumer subscribed first, and ref-counts its own", async () => {
    const { feed, provider } = setup();
    feed.subscribe([{ exchangeSegment: "IDX_I", securityId: "13" }]);
    const shared = provider
      .streamBars({ symbol: "IDX_I:13", timeframe: "1" })
      [Symbol.asyncIterator]();
    void shared.next();
    await flush();
    await shared.return?.();
    expect(feed.unsubscribed).toEqual([]);

    const a = provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "1" })
      [Symbol.asyncIterator]();
    const b = provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    void a.next();
    void b.next();
    await flush();
    expect(feed.subscriptions.filter((entry) => entry.securityId === "2885")).toHaveLength(1);
    await a.return?.();
    expect(feed.unsubscribed).toEqual([]);
    await b.return?.();
    expect(feed.unsubscribed).toEqual([{ exchangeSegment: "NSE_EQ", securityId: "2885" }]);
  });

  it("terminates on transport errors unless a handler is supplied", async () => {
    const strict = setup();
    const iterator = strict.provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await flush();
    strict.feed.emit("disconnect", { type: "disconnect", reasonCode: 805, raw: Buffer.alloc(0) });
    await expect(pending).rejects.toThrow(/805/);

    const reported: unknown[] = [];
    const lenient = setup({ onTransportError: (error) => reported.push(error) });
    const lenientIterator = lenient.provider
      .streamBars({ symbol: "NSE_EQ:2885", timeframe: "5" })
      [Symbol.asyncIterator]();
    const next = lenientIterator.next();
    await flush();
    lenient.feed.emit("error", new Error("socket reset"));
    lenient.feed.quote("2885", "NSE_EQ", 2500, ist("10:07"), 1);
    await expect(next).resolves.toMatchObject({ value: { close: 2500 } });
    expect(reported).toHaveLength(1);
    await lenientIterator.return?.();
  });

  it("requires a feed to stream", () => {
    expect(() => providerWith().streamBars({ symbol: "IDX_I:13", timeframe: "1" })).toThrow(
      ProviderCapabilityError,
    );
  });
});

describe("DhanHQProvider with PineRuntime", () => {
  it("continues the forming historical bar from live ticks and confirms it at the bucket end", async () => {
    const clock = { now: ist("10:07") * 1000 };
    const scheduler = new ManualScheduler(clock);
    const feed = new FakeFeed();
    const provider = new DhanHQProvider({
      charts: new FakeCharts(minuteCandles([0])),
      instruments,
      feed,
      now: () => clock.now,
      scheduler,
      closeGraceMs: 500,
      tradeTimeBase: "utc",
    });
    const runtime = new PineRuntime({ provider, symbol: "NSE_EQ:2885", timeframe: "15" });
    const seen: Array<[number, number, boolean, boolean]> = [];
    const script = (ctx: Parameters<Parameters<PineRuntime["run"]>[0]>[0]): void => {
      seen.push([
        ctx.bar.time / 1000,
        ctx.close.value,
        ctx.barstate.isrealtime,
        ctx.barstate.isconfirmed,
      ]);
    };

    await runtime.run(
      script,
      await provider.getHistoricalBars({
        symbol: "NSE_EQ:2885",
        timeframe: "15",
        endTime: clock.now,
      }),
    );
    expect(seen.at(-1)).toEqual([ist("10:00"), 1026.25, true, false]);

    const realtime = runtime.runRealtime(script);
    await flush();
    feed.quote("2885", "NSE_EQ", 1030, ist("10:09"), 50_000);
    await flush();
    scheduler.advanceTo(ist("10:15") * 1000 + 500);
    await flush();

    expect(seen.slice(-2)).toEqual([
      [ist("10:00"), 1030, true, false],
      [ist("10:00"), 1030, true, true],
    ]);
    // The seeded bar kept its historical open and extended its high.
    expect(runtime.sources.open.at(0)).toBe(1022.5);
    expect(runtime.sources.high.at(0)).toBe(1030);

    feed.emit("error", new Error("stop"));
    await expect(realtime).rejects.toThrow("stop");
  });
});
