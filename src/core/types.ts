export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  /** True when the provider has confirmed this candle is closed. */
  readonly isClosed?: boolean;
  readonly symbol?: string;
  readonly timeframe?: string;
}

export interface SymbolInfo {
  readonly ticker: string;
  readonly tickerId?: string;
  /** Pine `syminfo.tickerid` — `<prefix>:<ticker>` composite key. */
  readonly baseCurrency?: string;
  /** Pine `syminfo.currency` — quote currency of the symbol. */
  readonly quoteCurrency?: string;
  /** Pine `syminfo.mintick` — minimum price tick (e.g. 0.01 for USD stocks). */
  readonly minTick?: number;
  /** Pine `syminfo.pointvalue` — $-value of one point (e.g. 1 for stocks, 100 for some futures). */
  readonly pointValue?: number;
  /** Pine `syminfo.pricescale` — number of price units per point (e.g. 100 for 0.01 ticks). */
  readonly priceScale?: number;
  /** Pine `syminfo.minmove` — minimum price movement in points. */
  readonly minMove?: number;
  /** Pine `syminfo.session` — regular session string ("0930-1600"). */
  readonly session?: string;
  /** Pine `syminfo.volumetype` — "cash" | "contracts" | "shares" | etc. */
  readonly volumeType?: string;
  /** Pine `syminfo.root` — futures root ticker (e.g. "ES" for ES1!). */
  readonly root?: string;
  /** Pine `syminfo.prefix` — vendor prefix (e.g. "SSE", "NASDAQ"). */
  readonly prefix?: string;
  /** Pine `syminfo.main_tickerid` — composite key of the main ticker. */
  readonly mainTickerId?: string;
  /** Pine `syminfo.current_contract` — current futures contract month (e.g. "F24"). */
  readonly currentContract?: string;
  /** Pine `syminfo.currency` — ISO currency code (e.g. "USD"). */
  readonly currency?: string;
  /** Pine `syminfo.description` — human-readable description. */
  readonly description?: string;
  /** Pine `syminfo.type` — "stock" | "futures" | "crypto" | "forex" | etc. */
  readonly type?: string;
  readonly minContract?: number;
  readonly timezone?: string;
}

export type PineExecutionMode = "historical" | "realtime";

export interface BarState {
  readonly index: number;
  // camelCase
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly isHistory: boolean;
  readonly isRealtime: boolean;
  readonly isNew: boolean;
  readonly isConfirmed: boolean;
  readonly isLastConfirmedHistory: boolean;
  // Pine v6 lowercase aliases
  readonly isfirst: boolean;
  readonly islast: boolean;
  readonly ishistory: boolean;
  readonly isrealtime: boolean;
  readonly isnew: boolean;
  readonly isconfirmed: boolean;
  readonly islastconfirmedhistory: boolean;
}

export interface HistoricalBarsRequest {
  readonly symbol: string;
  readonly timeframe: string;
  readonly limit?: number;
  readonly startTime?: number;
  readonly endTime?: number;
}

export interface StreamBarsRequest {
  readonly symbol: string;
  readonly timeframe: string;
}

export interface MarketDataProvider {
  getHistoricalBars(request: HistoricalBarsRequest): Promise<readonly Bar[]>;
  streamBars(request: StreamBarsRequest): AsyncIterable<Bar>;
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;
}
