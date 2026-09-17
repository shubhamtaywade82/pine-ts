import type { PineSession } from "./session.js";
import type { FloatSeries, Series } from "./series.js";
import type { PineState } from "./state.js";
import type { Bar, BarState, SymbolInfo } from "./types.js";

export interface PineContext {
  readonly bar: Bar;
  readonly open: FloatSeries;
  readonly high: FloatSeries;
  readonly low: FloatSeries;
  readonly close: FloatSeries;
  readonly volume: FloatSeries;
  readonly time: Series<number>;
  readonly hl2: FloatSeries;
  readonly hlc3: FloatSeries;
  readonly ohlc4: FloatSeries;
  readonly barstate: BarState;
  readonly syminfo: SymbolInfo;
  readonly state: PineState;
}

export const createContext = (session: PineSession, bar: Bar): PineContext => ({
  bar,
  open: session.sources.open,
  high: session.sources.high,
  low: session.sources.low,
  close: session.sources.close,
  volume: session.sources.volume,
  time: session.sources.time,
  hl2: session.sources.hl2,
  hlc3: session.sources.hlc3,
  ohlc4: session.sources.ohlc4,
  barstate: session.barstate,
  syminfo: session.getSymbolInfo(),
  state: session.state,
});
