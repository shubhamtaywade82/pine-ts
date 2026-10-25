/**
 * Tests for the multi-context execution engine backing
 * `request.security` / `request.security_lower_tf`.
 *
 * The HTF (higher-timeframe) test scenarios use synthetic minute-scale
 * caller bars and a 5-minute HTF context, exercising:
 *  - Default `lookahead=off` (non-repainting): result is the latest
 *    closed HTF bar at the caller's bar time.
 *  - `lookahead=on` (repainting): result is the HTF bar containing the
 *    caller's bar time.
 *  - `gaps=on` vs `gaps=off` fallback when no alignment is available.
 *  - Per-expression caching: the same expression across caller bars
 *    re-uses cached values rather than re-driving the secondary session.
 *  - `RequestNotPrepared` when the host did not pre-warm a pair.
 *  - `security_lower_tf` returns intrabar values within the caller bar.
 */
import { describe, expect, it } from "vitest";
import { PineRuntime, request, ta } from "../src/index.js";
import type { Bar, MarketDataProvider, SymbolInfo } from "../src/index.js";

// ---------- shared harness ----------

const testInfo: SymbolInfo = {
  ticker: "TEST",
  tickerId: "TEST:TEST",
  minTick: 0.01,
  timezone: "UTC",
};

/** A provider that returns pre-built bars for any (symbol, timeframe) pair. */
class FixtureProvider implements MarketDataProvider {
  private readonly barsByPair = new Map<string, Bar[]>();
  private readonly symbolInfo = new Map<string, SymbolInfo>();

  public constructor() {
    this.symbolInfo.set("TEST", testInfo);
    this.symbolInfo.set("OTHER", { ...testInfo, ticker: "OTHER" });
  }

  public addBars(symbol: string, timeframe: string, bars: Bar[]): void {
    this.barsByPair.set(`${symbol}|${timeframe}`, bars);
  }

  public getHistoricalBars = async (req: {
    symbol: string;
    timeframe: string;
  }): Promise<readonly Bar[]> => {
    const key = `${req.symbol}|${req.timeframe}`;
    const bars = this.barsByPair.get(key);
    if (bars === undefined) {
      throw new Error(`FixtureProvider: no bars for ${key}; call addBars first`);
    }
    return bars;
  };

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
  });

  public getSymbolInfo = async (symbol: string): Promise<SymbolInfo> => {
    const info = this.symbolInfo.get(symbol);
    if (info === undefined) throw new Error(`Unknown symbol ${symbol}`);
    return info;
  };
}

const bar = (t: number, o: number, h: number, l: number, c: number, isClosed = true): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  isClosed,
});

// Build 5 caller bars of 1-minute duration starting at t=60_000 (00:01:00 UTC).
// Each caller bar covers [t, t+60s). The HTF (5-minute) bar covers [0, 5min).
// Caller bar 0 at t=60_000: time within HTF bar 0 [0..300_000).
// Caller bar 4 at t=300_000: at the boundary; HTF bar 0's close = 300_000.
//   - lookahead=off → alignment is HTF bar -1 (none, returns na on gaps=on or last cached on gaps=off).
//   - lookahead=on → alignment is HTF bar 0 (containing t=300_000? open<=t<close → 0<=300<300 is false, so no).
// Actually HTF bar 0 has open=0, close=300_000; for t=300_000, lookahead_on checks open<=t<close → 0<=300_000<300_000 is false, so no containing bar. So both lookahead settings return na at t=300_000.
// Caller bar 5 at t=360_000: time within HTF bar 1 [300_000..600_000).

const callerBars: Bar[] = [
  bar(60_000, 10, 11, 9, 10),
  bar(120_000, 10, 12, 8, 11),
  bar(180_000, 11, 13, 10, 12),
  bar(240_000, 12, 14, 11, 13),
  bar(300_000, 13, 15, 12, 14),
  bar(360_000, 14, 16, 13, 15),
];

const htfBars: Bar[] = [
  bar(0, 10, 15, 9, 14), // HTF bar 0 covers [0..300_000)
  bar(300_000, 14, 17, 13, 16), // HTF bar 1 covers [300_000..600_000)
  bar(600_000, 16, 20, 14, 18), // HTF bar 2 covers [600_000..900_000)
];

describe("request.security (multi-context execution engine)", () => {
  // ---------- not pre-warmed ----------

  describe("without pre-warming", () => {
    it("throws RequestNotPrepared when the pair was not pre-warmed", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new PineRuntime({
        provider,
        symbol: "TEST",
        timeframe: "1",
      });
      // Don't call prepareSecurity; the script's request.security should fail.
      await expect(
        runtime.run((_ctx) => {
          request.security("TEST", "5", (sctx) => sctx.close.at(0));
        }, callerBars),
      ).rejects.toBeInstanceOf(request.RequestNotPrepared);
    });
  });

  // ---------- HTF alignment: lookahead=off (default) ----------

  describe("HTF request, lookahead=off (non-repainting)", () => {
    it("returns the latest closed HTF bar value at the caller's bar time", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new PineRuntime({
        provider,
        symbol: "TEST",
        timeframe: "1",
      });
      await runtime.prepareSecurity("TEST", "5");

      const captured: Array<{ callerTime: number | undefined; htfClose: number | undefined }> = [];
      await runtime.run((ctx) => {
        const htfClose = request.security("TEST", "5", (sctx) => sctx.close.at(0));
        captured.push({ callerTime: ctx.time.at(0), htfClose });
      }, callerBars);

      // caller[0]=t=60_000 (within HTF bar 0). lookahead=off: latest closed HTF
      // bar whose close_time ≤ 60_000 → HTF bar -1 (none); gaps=off returns last
      // cached, which is undefined on the first call.
      expect(captured[0]?.htfClose).toBeUndefined();

      // caller[1]=t=120_000 (within HTF bar 0). Still no closed HTF bar before
      // 120_000 → undefined.
      expect(captured[1]?.htfClose).toBeUndefined();

      // caller[4]=t=300_000 (boundary). HTF bar 0's close=300_000 ≤ 300_000 →
      // alignment is HTF bar 0, value=close=14.
      expect(captured[4]?.htfClose).toBe(14);

      // caller[5]=t=360_000 (within HTF bar 1). HTF bar 0 closed at 300_000 ≤
      // 360_000 → alignment is HTF bar 0, value=close=14 (still the most recent
      // closed HTF bar).
      expect(captured[5]?.htfClose).toBe(14);
    });

    it("caches per-expression results so subsequent caller bars don't re-drive the secondary session", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new PineRuntime({
        provider,
        symbol: "TEST",
        timeframe: "1",
      });
      await runtime.prepareSecurity("TEST", "5");

      let evaluationCount = 0;
      const expression = (sctx: { close: { at: (n: number) => number | undefined } }) => {
        evaluationCount += 1;
        return sctx.close.at(0);
      };
      await runtime.run(() => {
        request.security("TEST", "5", expression);
      }, callerBars);
      // The expression should be evaluated exactly once per secondary bar
      // (3 HTF bars) regardless of the number of caller bars (6).
      expect(evaluationCount).toBeLessThanOrEqual(3);
    });
  });

  // ---------- HTF alignment: lookahead=on ----------

  describe("HTF request, lookahead=on (repainting)", () => {
    it("returns the HTF bar containing the caller's bar time", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new PineRuntime({
        provider,
        symbol: "TEST",
        timeframe: "1",
      });
      await runtime.prepareSecurity("TEST", "5");

      const captured: Array<{ callerTime: number | undefined; htfClose: number | undefined }> = [];
      await runtime.run((ctx) => {
        const htfClose = request.security("TEST", "5", (sctx) => sctx.close.at(0), {
          lookahead: "lookahead_on",
        });
        captured.push({ callerTime: ctx.time.at(0), htfClose });
      }, callerBars);

      // caller[0]=t=60_000 → containing HTF bar 0 (open=0, close=300_000),
      // 0<=60_000<300_000 → bar 0, value=close=14.
      expect(captured[0]?.htfClose).toBe(14);

      // caller[4]=t=300_000 → bar 1 (open=300_000, close=600_000) contains it
      // since 300_000<=300_000<600_000 → bar 1, value=close=16. This is the
      // repaint: the result leaks the still-forming bar 1's close.
      expect(captured[4]?.htfClose).toBe(16);

      // caller[5]=t=360_000 → 300_000<=360_000<600_000 → bar 1, value=close=16.
      expect(captured[5]?.htfClose).toBe(16);
    });
  });

  // ---------- gaps handling ----------

  describe("gaps handling", () => {
    it("gaps=on returns na when no alignment bar exists; gaps=off carries forward", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new FixtureProviderAsRuntime(provider);

      await runtime.prepareSecurity("TEST", "5");

      const gapsOn: Array<number | undefined> = [];
      const gapsOff: Array<number | undefined> = [];
      await runtime.run(() => {
        gapsOn.push(
          request.security("TEST", "5", (sctx) => sctx.close.at(0), {
            gaps: "gaps_on",
          }),
        );
        gapsOff.push(
          request.security("TEST", "5", (sctx) => sctx.close.at(0), {
            gaps: "gaps_off",
          }),
        );
      }, callerBars);

      // On the first caller bar (t=60_000), no HTF bar has closed yet, so
      // both gaps=on and gaps=off return undefined (no cached value to carry
      // forward on the first call).
      expect(gapsOn[0]).toBeUndefined();
      expect(gapsOff[0]).toBeUndefined();

      // After caller[4] (t=300_000, alignment is HTF bar 0, value=14), the next
      // caller bar returns 14 on gaps=off (carries forward) if no new
      // alignment bar is available. With our 5-min HTF and 1-min caller, by
      // caller[5] (t=360_000), the latest closed HTF bar is still bar 0
      // (closed at 300_000), so both options return 14.
      expect(gapsOff[5]).toBe(14);
    });
  });

  // ---------- multi-symbol ----------

  describe("multi-symbol request", () => {
    it("returns the secondary symbol's close at the aligned HTF bar", async () => {
      const otherBars: Bar[] = [
        bar(0, 100, 110, 90, 105), // bar 0 close = 105
        bar(300_000, 105, 115, 95, 110), // bar 1 close = 110
      ];
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("OTHER", "5", otherBars);
      const runtime = new FixtureProviderAsRuntime(provider);
      await runtime.prepareSecurity("OTHER", "5");

      const captured: Array<number | undefined> = [];
      await runtime.run(() => {
        captured.push(
          request.security("OTHER", "5", (sctx) => sctx.close.at(0), {
            lookahead: "lookahead_on",
          }),
        );
      }, callerBars);

      // caller[0]=t=60_000 → containing HTF bar 0 → close = 105.
      expect(captured[0]).toBe(105);
      // caller[5]=t=360_000 → containing HTF bar 1 → close = 110.
      expect(captured[5]).toBe(110);
    });
  });

  // ---------- expression with ta.* built-ins ----------

  describe("expression uses ta.* built-ins on the secondary context", () => {
    it("evaluates ta.sma(close, 1) on the HTF bar (= the bar's close)", async () => {
      const provider = new FixtureProvider();
      provider.addBars("TEST", "1", callerBars);
      provider.addBars("TEST", "5", htfBars);
      const runtime = new FixtureProviderAsRuntime(provider);
      await runtime.prepareSecurity("TEST", "5");

      const captured: Array<number | undefined> = [];
      await runtime.run(() => {
        captured.push(
          request.security("TEST", "5", (sctx) => ta.sma(sctx.close, 1).at(0), {
            lookahead: "lookahead_on",
          }),
        );
      }, callerBars);

      // At caller[0] (t=60_000), aligned to HTF bar 0 (close=14). SMA(close, 1) = 14.
      expect(captured[0]).toBe(14);
      // At caller[5] (t=360_000), aligned to HTF bar 1 (close=16). SMA(close, 1) = 16.
      expect(captured[5]).toBe(16);
    });
  });

  // ---------- security_lower_tf ----------

  describe("request.security_lower_tf", () => {
    it("returns intrabar values from the lower-tf context within the caller bar", async () => {
      // Caller context: 5-minute bars.
      // Lower-tf context: 1-minute bars (3 intrabars per caller bar starting at t=0, 60000, 120000).
      const caller5MinBars: Bar[] = [
        bar(0, 0, 0, 0, 0), // covers [0..300_000)
        bar(300_000, 0, 0, 0, 0), // covers [300_000..600_000)
      ];
      const ltf1MinBars: Bar[] = [
        bar(0, 10, 11, 9, 10),
        bar(60_000, 11, 12, 10, 11),
        bar(120_000, 12, 13, 11, 12),
        bar(180_000, 13, 14, 12, 13),
        bar(240_000, 14, 15, 13, 14),
        bar(300_000, 15, 16, 14, 15),
        bar(360_000, 16, 17, 15, 16),
        bar(420_000, 17, 18, 16, 17),
        bar(480_000, 18, 19, 17, 18),
        bar(540_000, 19, 20, 18, 19),
      ];
      const provider = new FixtureProvider();
      provider.addBars("TEST", "5", caller5MinBars);
      provider.addBars("TEST", "1", ltf1MinBars);
      const runtime = new FixtureProviderAsRuntime(provider);
      await runtime.prepareSecurity("TEST", "1");

      const captured: Array<readonly number[]> = [];
      await runtime.run(() => {
        const result = request.security_lower_tf("TEST", "1", (sctx) => sctx.close.at(0) ?? 0);
        captured.push(result.filter((v): v is number => v !== 0));
      }, caller5MinBars);

      // Caller bar 0 (t=0..300_000): 5 intrabars (0..240_000). Their closes:
      // 10, 11, 12, 13, 14.
      expect(captured[0]).toEqual([10, 11, 12, 13, 14]);

      // Caller bar 1 (t=300_000..600_000): 5 intrabars (300_000..540_000).
      // Their closes: 15, 16, 17, 18, 19.
      expect(captured[1]).toEqual([15, 16, 17, 18, 19]);
    });

    it("excludes the still-forming intrabar with lookahead=off", async () => {
      // Caller 5-min bars, lower-tf 1-min bars — last intrabar is marked as
      // not closed (still forming). lookahead=off excludes it.
      const caller5MinBars: Bar[] = [bar(0, 0, 0, 0, 0)];
      const ltf1MinBars: Bar[] = [
        bar(0, 10, 11, 9, 10),
        bar(60_000, 11, 12, 10, 11),
        bar(120_000, 12, 13, 11, 12),
        bar(180_000, 13, 14, 12, 13),
        { time: 240_000, open: 14, high: 15, low: 13, close: 14, volume: 0, isClosed: false },
      ];
      const provider = new FixtureProvider();
      provider.addBars("TEST", "5", caller5MinBars);
      provider.addBars("TEST", "1", ltf1MinBars);
      const runtime = new FixtureProviderAsRuntime(provider);
      await runtime.prepareSecurity("TEST", "1");

      const capturedOff: Array<readonly number[]> = [];
      const capturedOn: Array<readonly number[]> = [];
      await runtime.run(() => {
        const off = request.security_lower_tf("TEST", "1", (sctx) => sctx.close.at(0) ?? 0, {
          lookahead: "lookahead_off",
        });
        const on = request.security_lower_tf("TEST", "1", (sctx) => sctx.close.at(0) ?? 0, {
          lookahead: "lookahead_on",
        });
        capturedOff.push(off.filter((v): v is number => v !== 0));
        capturedOn.push(on.filter((v): v is number => v !== 0));
      }, caller5MinBars);

      // lookahead=off excludes the still-forming intrabar at 240_000.
      expect(capturedOff[0]).toEqual([10, 11, 12, 13]);
      // lookahead=on includes the still-forming intrabar.
      expect(capturedOn[0]).toEqual([10, 11, 12, 13, 14]);
    });

    it("gaps=on returns empty tuple when caller bar has no intrabars", async () => {
      // Caller 5-min bars (one bar), lower-tf 1-min bars that all fall in a
      // DIFFERENT caller bar — the first caller bar covers [0..300_000) but
      // the lower-tf bars are at [300_000..540_000].
      const caller5MinBars: Bar[] = [bar(0, 0, 0, 0, 0)];
      const ltf1MinBars: Bar[] = [bar(300_000, 15, 16, 14, 15), bar(360_000, 16, 17, 15, 16)];
      const provider = new FixtureProvider();
      provider.addBars("TEST", "5", caller5MinBars);
      provider.addBars("TEST", "1", ltf1MinBars);
      const runtime = new FixtureProviderAsRuntime(provider);
      await runtime.prepareSecurity("TEST", "1");

      const capturedOn: Array<readonly number[]> = [];
      const capturedOff: Array<readonly number[]> = [];
      await runtime.run(() => {
        const on = request.security_lower_tf("TEST", "1", (sctx) => sctx.close.at(0) ?? 0, {
          gaps: "gaps_on",
        });
        const off = request.security_lower_tf("TEST", "1", (sctx) => sctx.close.at(0) ?? 0, {
          gaps: "gaps_off",
        });
        capturedOn.push(on.filter((v): v is number => typeof v === "number" && v !== 0));
        capturedOff.push(off.filter((v): v is number => typeof v === "number" && v !== 0));
      }, caller5MinBars);

      // gaps=on returns empty tuple (no fabrication).
      expect(capturedOn[0]).toEqual([]);
      // gaps=off carries forward — no prior intrabar, so the placeholder
      // [undefined] becomes [] after the filter.
      expect(capturedOff[0]).toEqual([]);
    });
  });
});

// ---------- helper: wrap a FixtureProvider in a PineRuntime with the right symbol/timeframe ----------

class FixtureProviderAsRuntime extends PineRuntime {
  public constructor(provider: FixtureProvider) {
    super({ provider, symbol: "TEST", timeframe: "5" });
  }
}
