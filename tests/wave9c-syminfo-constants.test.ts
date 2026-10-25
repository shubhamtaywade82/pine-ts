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
  const bars: Bar[] = [
    { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1, isClosed: true },
  ];
  const runtime = new PineRuntime({
    provider: new StaticProvider(),
    symbol: "BTCUSDT",
    timeframe: "1",
  });
  await runtime.run(script, bars);
};

describe("syminfo.*", () => {
  it("reads every documented variable from the session's SymbolInfo", async () => {
    const captured: {
      ticker: unknown;
      tickerid: unknown;
      basecurrency: unknown;
      currency: unknown;
      mintick: unknown;
      pointvalue: unknown;
      pricescale: unknown;
      minmove: unknown;
      timezone: unknown;
      session: unknown;
      volumetype: unknown;
      type: unknown;
      description: unknown;
    } = {} as Record<string, unknown> as {
      ticker: unknown;
      tickerid: unknown;
      basecurrency: unknown;
      currency: unknown;
      mintick: unknown;
      pointvalue: unknown;
      pricescale: unknown;
      minmove: unknown;
      timezone: unknown;
      session: unknown;
      volumetype: unknown;
      type: unknown;
      description: unknown;
    };
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
    expect(captured.mintick).toBeCloseTo(0.01, 10);
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
    const bars: Bar[] = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
    ];
    const runtime = new PineRuntime({ provider, symbol: "TEST", timeframe: "1" });

    const captured: {
      mintick: unknown;
      pointvalue: unknown;
      pricescale: unknown;
      minmove: unknown;
      currency: unknown;
      session: unknown;
    } = {
      mintick: undefined,
      pointvalue: undefined,
      pricescale: undefined,
      minmove: undefined,
      currency: undefined,
      session: undefined,
    };
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

  it("barstate exposes the bar-state flag sentinels", () => {
    expect(constants.barstate.ISFIRSTBAR).toBe("barstate.isfirstbar");
    expect(constants.barstate.ISLASTBAR).toBe("barstate.islastbar");
    expect(constants.barstate.ISREALTIME).toBe("barstate.isrealtime");
    expect(constants.barstate.ISHISTORY).toBe("barstate.ishistory");
    expect(constants.barstate.ISNEW).toBe("barstate.isnew");
    expect(constants.barstate.ISCLOSED).toBe("barstate.isclosed");
    expect(constants.barstate.ISSESSION).toBe("barstate.issession");
    expect(constants.barstate.ISMARKET).toBe("barstate.ismarket");
    expect(constants.barstate.ISMONTHLY).toBe("barstate.ismonthly");
    expect(constants.barstate.ISYEARLY).toBe("barstate.isyearly");
  });

  it("syminfo_type exposes the documented symbol type constants", () => {
    expect(constants.syminfo_type.STOCK).toBe("stock");
    expect(constants.syminfo_type.FUTURES).toBe("futures");
    expect(constants.syminfo_type.INDEX).toBe("index");
    expect(constants.syminfo_type.FOREX).toBe("forex");
    expect(constants.syminfo_type.CRYPTO).toBe("crypto");
    expect(constants.syminfo_type.FUND).toBe("fund");
    expect(constants.syminfo_type.DR).toBe("dr");
    expect(constants.syminfo_type.CFD).toBe("cfd");
    expect(constants.syminfo_type.ECONOMY).toBe("economy");
  });

  it("months exposes the integer month constants", () => {
    expect(constants.months.JANUARY).toBe(1);
    expect(constants.months.DECEMBER).toBe(12);
    expect(constants.months.JULY).toBe(7);
  });

  it("frequency exposes the request.financial frequency sentinels", () => {
    expect(constants.frequency.F_QUARTERLY).toBe("FQ");
    expect(constants.frequency.F_YEARLY).toBe("FY");
    expect(constants.frequency.F_NONE).toBe("FN");
  });

  it("display_extended exposes the additional plot display attributes", () => {
    expect(constants.display_extended.NONE).toBe("display.none");
    expect(constants.display_extended.ALL).toBe("display.all");
    expect(constants.display_extended.DATA_WINDOW).toBe("display.data_window");
    expect(constants.display_extended.PRICE_SCALE).toBe("display.price_scale");
    expect(constants.display_extended.LEGEND).toBe("display.legend");
    expect(constants.display_extended.TOOLTIP).toBe("display.tooltip");
  });

  it("plot_freq exposes the plot timeframe frequency sentinels", () => {
    expect(constants.plot_freq.FREQ_ALL).toBe("freq.all");
    expect(constants.plot_freq.FREQ_DAILY).toBe("freq.daily");
    expect(constants.plot_freq.FREQ_WEEKLY).toBe("freq.weekly");
    expect(constants.plot_freq.FREQ_MONTHLY).toBe("freq.monthly");
    expect(constants.plot_freq.FREQ_NONE).toBe("freq.none");
  });

  it("earnings exposes the BMO/AMC/Unset sentinels", () => {
    expect(constants.earnings.BMO).toBe("BMO");
    expect(constants.earnings.AMC).toBe("AMC");
    expect(constants.earnings.UNSET).toBe("Unset");
  });

  it("quandl exposes the data-tier sentinels", () => {
    expect(constants.quandl.TIER_FREE).toBe("free");
    expect(constants.quandl.TIER_PREMIUM).toBe("premium");
  });

  it("economic exposes the release-source sentinels", () => {
    expect(constants.economic.SOURCE_FED).toBe("federal_reserve");
    expect(constants.economic.SOURCE_BEA).toBe("bea");
    expect(constants.economic.SOURCE_ECB).toBe("ecb");
  });

  it("volumetype exposes the volume-type sentinels", () => {
    expect(constants.volumetype.NONE).toBe("none");
    expect(constants.volumetype.TICK).toBe("tick");
    expect(constants.volumetype.SHARE).toBe("share");
    expect(constants.volumetype.CONTRACT).toBe("contract");
  });

  it("barmerge_gaps exposes the gaps_on/gaps_off/gaps_na sentinels", () => {
    expect(constants.barmerge_gaps.GAPS_ON).toBe("gaps_on");
    expect(constants.barmerge_gaps.GAPS_OFF).toBe("gaps_off");
    expect(constants.barmerge_gaps.GAPS_NA).toBe("gaps_na");
  });

  it("line_extended exposes the v6-only extended line styles", () => {
    expect(constants.line_extended.STYLE_SOLID_CROSS).toBe("line.style_solid_cross");
    expect(constants.line_extended.STYLE_DASHED_CROSS).toBe("line.style_dashed_cross");
    expect(constants.line_extended.STYLE_DOTTED_CROSS).toBe("line.style_dotted_cross");
  });

  it("color_palette exposes the named palette sentinels", () => {
    expect(constants.color_palette.BACKGROUND).toBe("background");
    expect(constants.color_palette.FOREGROUND).toBe("foreground");
    expect(constants.color_palette.UP).toBe("up");
    expect(constants.color_palette.DOWN).toBe("down");
  });

  it("text_align exposes the text alignment sentinels", () => {
    expect(constants.text_align.LEFT).toBe("text.align_left");
    expect(constants.text_align.CENTER).toBe("text.align_center");
    expect(constants.text_align.RIGHT).toBe("text.align_right");
    expect(constants.text_align.TOP_LEFT).toBe("text.align_top_left");
    expect(constants.text_align.BOTTOM_RIGHT).toBe("text.align_bottom_right");
  });

  it("text_wrap and text_font_family expose the wrap and font-family sentinels", () => {
    expect(constants.text_wrap.NONE).toBe("text.wrap_none");
    expect(constants.text_wrap.AUTO).toBe("text.wrap_auto");
    expect(constants.text_font_family.DEFAULT).toBe("text.font_family_default");
    expect(constants.text_font_family.MONOSPACE).toBe("text.font_family_monospace");
    expect(constants.text_font_family.SERIF).toBe("text.font_family_serif");
  });

  it("cell_border exposes the table cell border sentinels", () => {
    expect(constants.cell_border.TOP).toBe("cell.border_top");
    expect(constants.cell_border.ALL).toBe("cell.border_all");
    expect(constants.cell_border.NONE).toBe("cell.border_none");
  });

  it("tooltip exposes the tooltip position sentinels", () => {
    expect(constants.tooltip.POSITION_TOP).toBe("tooltip.position_top");
    expect(constants.tooltip.POSITION_AUTO).toBe("tooltip.position_auto");
  });

  it("event exposes the alert event sentinels", () => {
    expect(constants.event.BAR_CLOSED).toBe("event.bar_closed");
    expect(constants.event.PRICE_CROSS).toBe("event.price_cross");
    expect(constants.event.ALERT_TRIGGERED).toBe("event.alert_triggered");
  });

  it("strategy_direction exposes the long/short/all direction sentinels", () => {
    expect(constants.strategy_direction.LONG).toBe("strategy.direction.long");
    expect(constants.strategy_direction.SHORT).toBe("strategy.direction.short");
    expect(constants.strategy_direction.ALL).toBe("strategy.direction.all");
  });

  it("strategy_evaluations exposes the profit/loss/win sentinels", () => {
    expect(constants.strategy_evaluations.PROFIT).toBe("strategy.evaluations.profit");
    expect(constants.strategy_evaluations.LOSS).toBe("strategy.evaluations.loss");
    expect(constants.strategy_evaluations.WIN).toBe("strategy.evaluations.win");
  });

  it("chart exposes the chart.point and chart color sentinels", () => {
    expect(constants.chart.POINT_DEFAULT).toBe("chart.point_default");
    expect(constants.chart.POINT_XLOC_BAR_TIME).toBe("chart.point_xloc_bar_time");
    expect(constants.chart.BG_COLOR).toBe("chart.bg_color");
  });

  it("linefill exposes the linefill style sentinels", () => {
    expect(constants.linefill.STYLE_SOLID).toBe("linefill.style_solid");
    expect(constants.linefill.STYLE_GRADIENT_VERTICAL).toBe("linefill.style_gradient_vertical");
    expect(constants.linefill.STYLE_GRADIENT_HORIZONTAL).toBe("linefill.style_gradient_horizontal");
  });

  it("all exposes the consolidated constants record (extended)", () => {
    expect(constants.all.barstate.ISFIRSTBAR).toBe("barstate.isfirstbar");
    expect(constants.all.syminfo_type.CRYPTO).toBe("crypto");
    expect(constants.all.months.JULY).toBe(7);
    expect(constants.all.frequency.F_QUARTERLY).toBe("FQ");
    expect(constants.all.earnings.BMO).toBe("BMO");
    expect(constants.all.cell_border.ALL).toBe("cell.border_all");
    expect(constants.all.linefill.STYLE_SOLID).toBe("linefill.style_solid");
  });
});
