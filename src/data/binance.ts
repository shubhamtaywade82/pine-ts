import type {
  MarketDataProvider,
  HistoricalBarsRequest,
  StreamBarsRequest,
  Bar,
  SymbolInfo,
} from "../core/types.js";

/**
 * Adapter boundary for @nemesis-oss/binance-sdk.
 *
 * The exact SDK method mapping is deliberately isolated here so Pine runtime
 * code never depends on Binance-specific response shapes.
 */
export interface BinanceMarketClient {
  getHistoricalBars(request: HistoricalBarsRequest): Promise<readonly Bar[]>;
  streamBars(request: StreamBarsRequest): AsyncIterable<Bar>;
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;
}

export class BinanceProvider implements MarketDataProvider {
  public constructor(private readonly client: BinanceMarketClient) {}

  public getHistoricalBars(request: HistoricalBarsRequest): Promise<readonly Bar[]> {
    return this.client.getHistoricalBars(request);
  }

  public streamBars(request: StreamBarsRequest): AsyncIterable<Bar> {
    return this.client.streamBars(request);
  }

  public getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    return this.client.getSymbolInfo(symbol);
  }
}
