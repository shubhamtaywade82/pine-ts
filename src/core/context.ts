import { calendarParts, weekofyear } from "../time/calendar.js";
import type { TimeframeInfo } from "../time/timeframe.js";
import { createUserSeries } from "./series-operators.js";
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
  readonly bar_index: Series<number>;
  /**
   * Pine `last_bar_index`: the last historical bar's index on every historical
   * bar (known from the start of the calculation), and the realtime bar's
   * index once realtime bars arrive.
   */
  readonly last_bar_index: number;
  readonly barstate: BarState;
  readonly syminfo: SymbolInfo;
  readonly timeframe: TimeframeInfo;
  /** Current bar's calendar fields in `syminfo.timezone` (Pine `year`, `month`, ...). */
  readonly year: number;
  readonly month: number;
  readonly dayofmonth: number;
  /** 1 = Sunday ... 7 = Saturday. */
  readonly dayofweek: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekofyear: number;
  readonly state: PineState;
  readonly series: <T>(key: string, evaluate: () => T) => Series<T>;
  /**
   * Runs `body` as a distinct Pine call site named `id`. `ta.*` nodes,
   * `ctx.series` keys, and `var`/`varip` cells created inside get state
   * independent from every other scope, the way each written call of a Pine
   * user function owns its own local scope.
   */
  readonly scope: <T>(id: string, body: () => T) => T;
}

export const createContext = (
  session: PineSession,
  bar: Bar,
  timeframe: TimeframeInfo,
): PineContext => {
  const syminfo = session.getSymbolInfo();
  const timezone = syminfo.timezone ?? "UTC";
  let calendar: ReturnType<typeof calendarParts> | undefined;
  const parts = (): ReturnType<typeof calendarParts> =>
    (calendar ??= calendarParts(bar.time, timezone));

  return {
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
    bar_index: session.sources.bar_index,
    last_bar_index: session.lastBarIndex,
    barstate: session.barstate,
    syminfo,
    timeframe,
    get year() {
      return parts().year;
    },
    get month() {
      return parts().month;
    },
    get dayofmonth() {
      return parts().dayofmonth;
    },
    get dayofweek() {
      return parts().dayofweek;
    },
    get hour() {
      return parts().hour;
    },
    get minute() {
      return parts().minute;
    },
    get second() {
      return parts().second;
    },
    get weekofyear() {
      return weekofyear(bar.time, timezone);
    },
    state: session.state,
    series: <T>(key: string, evaluate: () => T): Series<T> =>
      createUserSeries(session, key, evaluate),
    scope: <T>(id: string, body: () => T): T => session.scopes.run(id, body),
  };
};
