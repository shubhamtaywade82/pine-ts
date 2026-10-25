/**
 * Pine Script v6 `ticker.*` namespace — non-standard chart types.
 *
 * Each function returns a {@link Ticker} object that wraps a symbol + a
 * synthetic bar builder. The bar builder takes regular OHLCV bars and
 * produces synthetic bars (Heikin-Ashi candles, Renko bricks, Kagi
 * reversals, Line Break bars, Point & Figure columns, etc.).
 *
 * The eventual integration with `request.security(ticker, tf, expr)`
 * resolves the ticker's bar builder, runs it against the regular bars,
 * and uses the synthetic bars in the secondary context. Until that
 * integration ships, `ticker.*` exposes the bar builders themselves as
 * a public API: hosts can call `ticker.heikinashi(symbol).buildBars(bars)`
 * directly to inspect the synthetic output.
 *
 * Implemented chart types:
 * - `ticker.standard(symbol)` — no transformation (passthrough).
 * - `ticker.heikinashi(symbol)` — Heikin-Ashi candles.
 * - `ticker.renko(symbol, options?)` — Renko bricks (fixed or ATR brick size).
 * - `ticker.linebreak(symbol, options?)` — Line Break chart (N-bar lookback).
 * - `ticker.kagi(symbol, options?)` — Kagi lines (reversal threshold).
 * - `ticker.pointfigure(symbol, options?)` — Point & Figure X/O columns.
 * - `ticker.new(symbol, options?)` — generic ticker with adjustment params.
 * - `ticker.modify(ticker, params)` — modify an existing ticker.
 * - `ticker.inherit(symbol)` — inherit the symbol's adjustment settings.
 *
 * All builders are pure functions of regular Bar[]; they don't access the
 * session. They produce synthetic Bar[] with the original symbol's `time`
 * taken from the source bar that triggered each synthetic bar's emission.
 */

import type { Bar } from "../core/types.js";

/** A non-standard chart type. */
export type TickerKind =
  | "standard"
  | "heikinashi"
  | "renko"
  | "linebreak"
  | "kagi"
  | "pointfigure";

/** Adjustment parameters supported by `ticker.new` and `ticker.modify`. */
export interface TickerAdjustments {
  /** Pine `adjustment` — `"none" | "splits" | "dividends" | "splits_dividends"`. */
  readonly adjustment?: "none" | "splits" | "dividends" | "splits_dividends";
  /** Pine `backadjustment` — `"none" | "ratio" | "difference"`. */
  readonly backadjustment?: "none" | "ratio" | "difference";
  /** Pine `session` — override regular session ("0930-1600"). */
  readonly session?: string;
  /** Pine `lookahead` — barmerge lookahead for the ticker's data request. */
  readonly lookahead?: "lookahead_on" | "lookahead_off";
  /** Pine `gaps` — barmerge gap handling for the ticker's data request. */
  readonly gaps?: "gaps_on" | "gaps_off";
  /** Pine `currency` — override the symbol's quote currency. */
  readonly currency?: string;
}

/** Common parameters for non-standard chart-type tickers. */
export interface TickerOptions {
  /** Renko: brick size in price units. Default: ATR(14) of the source. */
  readonly brickSize?: number;
  /** Renko: use ATR(length) when brickSize is omitted. */
  readonly atrLength?: number;
  /** Line Break: number of lookback bars (default 3). */
  readonly lookback?: number;
  /** Kagi: reversal amount in price units (default: 1% of last price). */
  readonly reversalAmount?: number;
  /** Kagi: reversal type — "percent" or "price". */
  readonly reversalType?: "percent" | "price";
  /** Point & Figure: box size in price units. */
  readonly boxSize?: number;
  /** Point & Figure: reversal boxes (default 3). */
  readonly reversalBoxes?: number;
}

/**
 * A Ticker object — the value returned by every `ticker.*` function.
 * Wraps a symbol + adjustments + a bar-builder function that produces
 * synthetic bars from regular bars.
 */
export interface Ticker {
  readonly symbol: string;
  readonly kind: TickerKind;
  readonly adjustments: TickerAdjustments;
  readonly options: TickerOptions;
  /** Build synthetic bars from a series of regular bars. */
  buildBars(bars: readonly Bar[]): readonly Bar[];
}

// ---------- ticker.standard ----------

/**
 * `ticker.standard(symbol)`. Returns a ticker with no transformation —
 * the bar builder passes the regular bars through unchanged.
 */
export const standard = (symbol: string): Ticker => ({
  symbol,
  kind: "standard",
  adjustments: {},
  options: {},
  buildBars: (bars) => bars,
});

// ---------- ticker.heikinashi ----------

/**
 * `ticker.heikinashi(symbol)`. Returns a ticker whose bar builder produces
 * Heikin-Ashi candles. The HA formula:
 *
 * - `HA_close = (open + high + low + close) / 4`
 * - `HA_open  = (prev_HA_open + prev_HA_close) / 2`, seeded with
 *   `(open + close) / 2` on the first bar
 * - `HA_high  = max(high, HA_open, HA_close)`
 * - `HA_low   = min(low,  HA_open, HA_close)`
 *
 * Each synthetic bar keeps the source bar's `time` and `volume`.
 */
export const heikinashi = (symbol: string): Ticker => ({
  symbol,
  kind: "heikinashi",
  adjustments: {},
  options: {},
  buildBars: (bars) => buildHeikinAshi(bars),
});

const buildHeikinAshi = (bars: readonly Bar[]): Bar[] => {
  const out: Bar[] = [];
  let prevOpen: number | undefined;
  let prevClose: number | undefined;
  for (const bar of bars) {
    const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
    const haOpen =
      prevOpen === undefined || prevClose === undefined
        ? (bar.open + bar.close) / 2
        : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(bar.high, haOpen, haClose);
    const haLow = Math.min(bar.low, haOpen, haClose);
    const synthetic: Bar = {
      time: bar.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: bar.volume,
      isClosed: bar.isClosed ?? true,
    };
    out.push(synthetic);
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
};

// ---------- ticker.renko ----------

/**
 * `ticker.renko(symbol, options?)`. Returns a ticker whose bar builder
 * produces Renko bricks. A new brick forms when the close moves by at
 * least `brickSize` price units from the last brick's close. Default
 * `brickSize` is the median absolute deviation of the close over the
 * source series (a stand-in for ATR(14) when not explicitly supplied);
 * pass `options.brickSize` for an explicit value.
 *
 * Each brick is "open" at the previous brick's close (or the source's
 * first close) and "close" at `prevClose ± brickSize` (rounded to the
 * brick size). Bricks don't carry `volume` from the source — Pine v6
 * documents Renko volume as the cumulative source volume consumed per
 * brick; here we sum the source volume of the bars that fed the brick.
 */
export const renko = (symbol: string, options: TickerOptions = {}): Ticker => ({
  symbol,
  kind: "renko",
  adjustments: {},
  options,
  buildBars: (bars) => buildRenko(bars, options),
});

const buildRenko = (bars: readonly Bar[], options: TickerOptions): Bar[] => {
  if (bars.length === 0) return [];
  let brickSize = options.brickSize;
  if (brickSize === undefined || brickSize <= 0) {
    // Fall back to the median absolute deviation of the close series.
    const closes = bars.map((b) => b.close);
    const median = closes.slice().sort((a, b) => a - b)[Math.floor(closes.length / 2)] ?? 1;
    const mad = closes
      .map((c) => Math.abs(c - median))
      .sort((a, b) => a - b)[Math.floor(closes.length / 2)] ?? 1;
    brickSize = mad > 0 ? mad : 1;
  }
  const out: Bar[] = [];
  const prevClose = bars[0]!.close;
  let brickOpen = prevClose;
  let brickVolume = 0;
  let brickTime = bars[0]!.time;
  let direction: 1 | -1 = 1;
  for (const bar of bars) {
    brickVolume += bar.volume;
    // Renko bricks form when |delta| >= brickSize; a reversal requires
    // moving 2x the brick size in the opposite direction.
    while (Math.abs(bar.close - brickOpen) >= brickSize) {
      const newDirection = bar.close > brickOpen ? 1 : -1;
      if (direction !== newDirection && Math.abs(bar.close - brickOpen) < 2 * brickSize) {
        // Potential reversal — needs 2x brick size.
        break;
      }
      direction = newDirection;
      const brickClose = brickOpen + direction * brickSize;
      out.push({
        time: brickTime,
        open: brickOpen,
        high: Math.max(brickOpen, brickClose),
        low: Math.min(brickOpen, brickClose),
        close: brickClose,
        volume: brickVolume,
        isClosed: true,
      });
      brickOpen = brickClose;
      brickVolume = 0;
      brickTime = bar.time;
    }
  }
  return out;
};

// ---------- ticker.linebreak ----------

/**
 * `ticker.linebreak(symbol, options?)`. Returns a ticker whose bar builder
 * produces Line Break bars. A new line forms when the current close
 * exceeds the high or low of the previous `lookback` (default 3) lines.
 * Each line inherits its predecessor's close as its open.
 */
export const linebreak = (symbol: string, options: TickerOptions = {}): Ticker => ({
  symbol,
  kind: "linebreak",
  adjustments: {},
  options,
  buildBars: (bars) => buildLineBreak(bars, options),
});

const buildLineBreak = (bars: readonly Bar[], options: TickerOptions): Bar[] => {
  if (bars.length === 0) return [];
  const lookback = Math.max(1, options.lookback ?? 3);
  const lines: Bar[] = [];
  for (const bar of bars) {
    if (lines.length < lookback) {
      // Seed the first `lookback` lines with the source bars.
      lines.push({ ...bar });
      continue;
    }
    const priorHigh = Math.max(...lines.slice(-lookback).map((l) => l.high));
    const priorLow = Math.min(...lines.slice(-lookback).map((l) => l.low));
    const prevClose = lines.at(-1)!.close;
    if (bar.close > priorHigh) {
      // Bullish breakout: new line goes up.
      lines.push({
        time: bar.time,
        open: prevClose,
        high: bar.close,
        low: prevClose,
        close: bar.close,
        volume: bar.volume,
        isClosed: true,
      });
    } else if (bar.close < priorLow) {
      // Bearish breakout: new line goes down.
      lines.push({
        time: bar.time,
        open: prevClose,
        high: prevClose,
        low: bar.close,
        close: bar.close,
        volume: bar.volume,
        isClosed: true,
      });
    }
    // Otherwise, no new line — the current line extends.
  }
  return lines;
};

// ---------- ticker.kagi ----------

/**
 * `ticker.kagi(symbol, options?)`. Returns a ticker whose bar builder
 * produces Kagi lines. A reversal of `reversalAmount` (default 1% of the
 * last turning point) triggers a new line; each line keeps the direction
 * (up or down) until a reversal threshold is reached.
 */
export const kagi = (symbol: string, options: TickerOptions = {}): Ticker => ({
  symbol,
  kind: "kagi",
  adjustments: {},
  options,
  buildBars: (bars) => buildKagi(bars, options),
});

const buildKagi = (bars: readonly Bar[], options: TickerOptions): Bar[] => {
  if (bars.length === 0) return [];
  const reversalType = options.reversalType ?? "percent";
  const reversalAmount = options.reversalAmount ?? 1;
  const out: Bar[] = [];
  let lastExtreme = bars[0]!.close;
  let lastTime = bars[0]!.time;
  let direction: 1 | -1 = 1;
  let lineOpen = lastExtreme;
  for (const bar of bars) {
    const reversalThreshold =
      reversalType === "percent"
        ? lastExtreme * (reversalAmount / 100)
        : reversalAmount;
    const delta = bar.close - lastExtreme;
    const reversed =
      (direction === 1 && delta < -reversalThreshold) ||
      (direction === -1 && delta > reversalThreshold);
    if (reversed) {
      out.push({
        time: lastTime,
        open: lineOpen,
        high: Math.max(lineOpen, lastExtreme),
        low: Math.min(lineOpen, lastExtreme),
        close: lastExtreme,
        volume: 0,
        isClosed: true,
      });
      lineOpen = lastExtreme;
      direction = (direction * -1) as 1 | -1;
      lastTime = bar.time;
    }
    lastExtreme = bar.close;
  }
  // Push the final incomplete line.
  out.push({
    time: lastTime,
    open: lineOpen,
    high: Math.max(lineOpen, lastExtreme),
    low: Math.min(lineOpen, lastExtreme),
    close: lastExtreme,
    volume: 0,
    isClosed: false,
  });
  return out;
};

// ---------- ticker.pointfigure ----------

/**
 * `ticker.pointfigure(symbol, options?)`. Returns a ticker whose bar
 * builder produces Point & Figure columns. Each column is one bar (X for
 * up moves, O for down moves); a reversal of `reversalBoxes` (default 3)
 * boxes in the opposite direction triggers a new column.
 *
 * `boxSize` defaults to 1% of the first bar's close when not supplied.
 */
export const pointfigure = (symbol: string, options: TickerOptions = {}): Ticker => ({
  symbol,
  kind: "pointfigure",
  adjustments: {},
  options,
  buildBars: (bars) => buildPointFigure(bars, options),
});

const buildPointFigure = (bars: readonly Bar[], options: TickerOptions): Bar[] => {
  if (bars.length === 0) return [];
  const firstClose = bars[0]!.close;
  const boxSize = options.boxSize ?? firstClose * 0.01;
  const reversalBoxes = options.reversalBoxes ?? 3;
  if (boxSize <= 0) return [];
  const out: Bar[] = [];
  let columnDirection: 1 | -1 = bars[0]!.close >= bars[0]!.open ? 1 : -1;
  let columnOpen = bars[0]!.close;
  let columnExtreme = columnOpen;
  let columnTime = bars[0]!.time;
  let columnVolume = 0;
  const startNewColumn = (dir: 1 | -1, time: number, price: number) => {
    out.push({
      time: columnTime,
      open: columnOpen,
      high: Math.max(columnOpen, columnExtreme),
      low: Math.min(columnOpen, columnExtreme),
      close: columnExtreme,
      volume: columnVolume,
      isClosed: true,
    });
    columnDirection = dir;
    columnOpen = price;
    columnExtreme = price;
    columnTime = time;
    columnVolume = 0;
  };
  for (const bar of bars) {
    columnVolume += bar.volume;
    const move = bar.close - columnExtreme;
    if ((columnDirection === 1 && move > 0) || (columnDirection === -1 && move < 0)) {
      columnExtreme = bar.close;
    } else if (Math.abs(bar.close - columnExtreme) >= boxSize * reversalBoxes) {
      const newDir = (columnDirection * -1) as 1 | -1;
      startNewColumn(newDir, bar.time, bar.close);
    }
  }
  // Push the final incomplete column.
  out.push({
    time: columnTime,
    open: columnOpen,
    high: Math.max(columnOpen, columnExtreme),
    low: Math.min(columnOpen, columnExtreme),
    close: columnExtreme,
    volume: columnVolume,
    isClosed: false,
  });
  return out;
};

// ---------- ticker.new / modify / inherit ----------

/**
 * `ticker.new(symbol, adjustments?)`. Returns a generic ticker with
 * adjustment parameters; the bar builder is a passthrough (like
 * `ticker.standard`). Use `ticker.modify` to layer a chart-type
 * transformation on top.
 */
export const new_ = (symbol: string, adjustments: TickerAdjustments = {}): Ticker => ({
  symbol,
  kind: "standard",
  adjustments,
  options: {},
  buildBars: (bars) => bars,
});

/**
 * `ticker.modify(ticker, params)`. Returns a new ticker with updated
 * adjustment parameters. The chart-type bar builder is preserved.
 */
export const modify = (
  ticker: Ticker,
  adjustments: TickerAdjustments,
): Ticker => ({
  symbol: ticker.symbol,
  kind: ticker.kind,
  adjustments: { ...ticker.adjustments, ...adjustments },
  options: ticker.options,
  buildBars: (bars) => ticker.buildBars(bars),
});

/**
 * `ticker.inherit(symbol)`. Returns a ticker that inherits the symbol's
 * default adjustment settings (the runtime's `adjustment` /
 * `backadjustment` for the symbol's data source). Equivalent to
 * `ticker.standard(symbol)` for providers without adjustment settings.
 */
export const inherit = (symbol: string): Ticker => standard(symbol);
