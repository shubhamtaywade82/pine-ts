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
  readonly baseCurrency?: string;
  readonly quoteCurrency?: string;
  readonly minTick?: number;
  readonly minContract?: number;
  readonly timezone?: string;
  readonly type?: string;
}

export type PineExecutionMode = "historical" | "realtime";

export interface BarState {
  readonly index: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly isHistory: boolean;
  readonly isRealtime: boolean;
  readonly isNew: boolean;
  readonly isConfirmed: boolean;
  readonly isLastConfirmedHistory: boolean;
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
