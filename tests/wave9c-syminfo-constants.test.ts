/**
 * Tests for `syminfo.*` and `constants.*` — Wave 9c.
 *
 * `syminfo.*` accessors read from the active session's `SymbolInfo`. Tests
 * set a fixture `SymbolInfo` via a stub provider and verify each accessor
 * returns the documented value (or the type-appropriate empty value when
 * a field is missing).
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, syminfo, constants } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

const testInfo: SymbolInfo = {
  ticker: "BTCUSDT",
  tickerId: "BINANCE:BTCUSDT",
  baseCurrency: "BTC",
  quoteCurrency: "USDT",
  currency: "USDT",
  minTick: 0.01,
  pointValue: 1,
  priceScale: 100,
  minMove: 1,
  timezone: "UTC",
  session: "0000-2400",
  volumeType: "cash",
  type: "crypto",
  description: "Bitcoin / Tether",
};

class StaticProvider implements MarketDataProvider {
  public getHistoricalBars = async (): Promise<readonly Bar[]> => [
    { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1, isClosed: true },
  ];
  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });
  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const runScript = async (
  script: (ctx: import("../src/index.js").PineContext) => void,
): Promise<void> => {
  const bars: Bar[] = [{ time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1, isClosed: true }];
  const runtime = new PineRuntime({
    provider: new StaticProvider(),
    symbol: "BTCUSDT",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

describe("syminfo.*", () => {
  it("reads every documented variable from the session's SymbolInfo", async () => {
    const captured: Record<string, unknown> = {};
    await runScript(() => {
      captured.ticker = syminfo.ticker();
      captured.tickerid = syminfo.tickerid();
      captured.basecurrency = syminfo.basecurrency();
      captured.currency = syminfo.currency();
      captured.mintick = syminfo.mintick();
      captured.pointvalue = syminfo.pointvalue();
      captured.pricescale = syminfo.pricescale();
      captured.minmove = syminfo.minmove();
      captured.timezone = syminfo.timezone();
      captured.session = syminfo.session();
      captured.volumetype = syminfo.volumetype();
      captured.type = syminfo.type();
      captured.description = syminfo.description();
    });
    expect(captured.ticker).toBe("BTCUSDT");
    expect(captured.tickerid).toBe("BINANCE:BTCUSDT");
    expect(captured.basecurrency).toBe("BTC");
    expect(captured.currency).toBe("USDT");
    expect(captured.mintick).toBe(0.01);
    expect(captured.pointvalue).toBe(1);
    expect(captured.pricescale).toBe(100);
    expect(captured.minmove).toBe(1);
    expect(captured.timezone).toBe("UTC");
    expect(captured.session).toBe("0000-2400");
    expect(captured.volumetype).toBe("cash");
    expect(captured.type).toBe("crypto");
    expect(captured.description).toBe("Bitcoin / Tether");
  });

  it("returns sensible defaults when SymbolInfo fields are missing", async () => {
    const minimal: SymbolInfo = { ticker: "TEST", timezone: "UTC" };
    const provider: MarketDataProvider = {
      getHistoricalBars: async () => [
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
      ],
      streamBars: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield* [];
        },
      }),
      getSymbolInfo: async () => minimal,
    };
    const bars: Bar[] = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }];
    const runtime = new PineRuntime({ provider, symbol: "TEST", timeframe: "1" });

    const captured: Record<string, unknown> = {};
    await runtime.run(() => {
      captured.mintick = syminfo.mintick();
      captured.pointvalue = syminfo.pointvalue();
      captured.pricescale = syminfo.pricescale();
      captured.minmove = syminfo.minmove();
      captured.currency = syminfo.currency();
      captured.session = syminfo.session();
    }, bars);
    // Defaults: mintick NaN, pointvalue 1, pricescale 100, minmove 1.
    expect(Number.isNaN(captured.mintick as number)).toBe(true);
    expect(captured.pointvalue).toBe(1);
    expect(captured.pricescale).toBe(100);
    expect(captured.minmove).toBe(1);
    expect(captured.currency).toBe("");
    expect(captured.session).toBe("");
  });

  it("getSymbolInfo returns the full SymbolInfo object", async () => {
    let captured: SymbolInfo | undefined;
    await runScript(() => {
      captured = syminfo.getSymbolInfo();
    });
    expect(captured).toEqual(testInfo);
  });
});

describe("constants.*", () => {
  it("barmerge exposes the four gap/lookahead sentinels", () => {
    expect(constants.barmerge.lookahead_on).toBe("lookahead_on");
    expect(constants.barmerge.lookahead_off).toBe("lookahead_off");
    expect(constants.barmerge.gaps_on).toBe("gaps_on");
    expect(constants.barmerge.gaps_off).toBe("gaps_off");
  });

  it("dayofweek follows Pine's 1=Sunday convention", () => {
    expect(constants.dayofweek.SUNDAY).toBe(1);
    expect(constants.dayofweek.MONDAY).toBe(2);
    expect(constants.dayofweek.SATURDAY).toBe(7);
  });

  it("currency exposes ISO 4217 codes (subset)", () => {
    expect(constants.currency.USD).toBe("USD");
    expect(constants.currency.EUR).toBe("EUR");
    expect(constants.currency.JPY).toBe("JPY");
    expect(constants.currency.BRL).toBe("BRL");
  });

  it("order exposes long/short sentinels", () => {
    expect(constants.order.LONG).toBe("long");
    expect(constants.order.SHORT).toBe("short");
  });

  it("alert exposes the three frequency constants", () => {
    expect(constants.alert.ONCE_PER_BAR).toBe("once_per_bar");
    expect(constants.alert.ONCE_PER_BAR_CLOSE).toBe("once_per_bar_close");
    expect(constants.alert.ALL).toBe("all");
  });

  it("plot exposes the documented plot-style constants", () => {
    expect(constants.plot.LINE).toBe("line");
    expect(constants.plot.HISTOGRAM).toBe("histogram");
    expect(constants.plot.CROSS).toBe("cross");
  });

  it("shape exposes the shape-* family", () => {
    expect(constants.shape.CIRCLE).toBe("shapecircle");
    expect(constants.shape.TRIANGLEUP).toBe("shapetriangleup");
    expect(constants.shape.ARROWDOWN).toBe("shapearrowdown");
  });

  it("location exposes the documented location constants", () => {
    expect(constants.location.ABOVEBAR).toBe("abovebar");
    expect(constants.location.BELOWBAR).toBe("belowbar");
    expect(constants.location.ABSOLUTE).toBe("absolute");
  });

  it("size exposes the size constants", () => {
    expect(constants.size.AUTO).toBe("auto");
    expect(constants.size.HUGE).toBe("huge");
  });

  it("extend exposes the line-extend sentinels", () => {
    expect(constants.extend.NONE).toBe("extend.none");
    expect(constants.extend.LEFT).toBe("extend.left");
    expect(constants.extend.RIGHT).toBe("extend.right");
    expect(constants.extend.BOTH).toBe("extend.both");
  });

  it("xloc and yloc expose the location sentinels", () => {
    expect(constants.xloc.BAR_TIME).toBe("xloc.bar_time");
    expect(constants.xloc.BAR_INDEX).toBe("xloc.bar_index");
    expect(constants.yloc.PRICE).toBe("yloc.price");
    expect(constants.yloc.ABSOLUTE).toBe("yloc.absolute");
  });

  it("position exposes the table-position sentinels", () => {
    expect(constants.position.TOP_LEFT).toBe("position.top_left");
    expect(constants.position.BOTTOM_RIGHT).toBe("position.bottom_right");
  });

  it("hline exposes the line-style sentinels", () => {
    expect(constants.hline.SOLID).toBe("hline.style_solid");
    expect(constants.hline.DASHED).toBe("hline.style_dashed");
    expect(constants.hline.DOTTED).toBe("hline.style_dotted");
  });

  it("line.style_* and label.style_* expose the documented sentinels", () => {
    expect(constants.line.STYLE_SOLID).toBe("line.style_solid");
    expect(constants.line.STYLE_ARROWED).toBe("line.style_arrowed");
    expect(constants.label.STYLE_LABEL_LEFT).toBe("label.style_label_left");
    expect(constants.label.STYLE_NONE).toBe("label.style_none");
  });

  it("all exposes the consolidated constants record", () => {
    expect(constants.all.currency.USD).toBe("USD");
    expect(constants.all.dayofweek.MONDAY).toBe(2);
    expect(constants.all.barmerge.lookahead_on).toBe("lookahead_on");
  });
});
