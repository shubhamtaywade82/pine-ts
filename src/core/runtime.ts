import type { PineContext } from "./context.js";
import { OhlcvSeries } from "./context.js";
import type { Bar, BarState, MarketDataProvider, PineExecutionMode, SymbolInfo } from "./types.js";

export type PineScript = (context: PineContext) => void | Promise<void>;

export interface RuntimeOptions {
  readonly provider: MarketDataProvider;
  readonly symbol: string;
  readonly timeframe: string;
  readonly executionMode?: PineExecutionMode;
}

export class PineRuntime {
  private readonly ohlcv = new OhlcvSeries();
  private readonly executionMode: PineExecutionMode;
  private symbolInfo?: SymbolInfo;

  public constructor(private readonly options: RuntimeOptions) {
    this.executionMode = options.executionMode ?? "historical";
  }

  public async run(script: PineScript, bars?: readonly Bar[]): Promise<void> {
    const data = bars ?? await this.options.provider.getHistoricalBars({
      symbol: this.options.symbol,
      timeframe: this.options.timeframe,
    });

    this.symbolInfo ??= await this.options.provider.getSymbolInfo(this.options.symbol);

    for (let index = 0; index < data.length; index += 1) {
      const bar = data[index];
      if (bar === undefined) continue;
      this.ohlcv.commit(bar);
      await script({
        bar,
        open: this.ohlcv.open,
        high: this.ohlcv.high,
        low: this.ohlcv.low,
        close: this.ohlcv.close,
        volume: this.ohlcv.volume,
        time: this.ohlcv.time,
        hl2: this.ohlcv.hl2,
        hlc3: this.ohlcv.hlc3,
        ohlc4: this.ohlcv.ohlc4,
        barstate: this.createBarState(index, data.length),
        syminfo: this.symbolInfo,
      });
    }
  }

  private createBarState(index: number, total: number): BarState {
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const isHistory = this.executionMode === "historical";

    return {
      index,
      isFirst,
      isLast,
      isHistory,
      isRealtime: !isHistory,
      isNew: true,
      isConfirmed: isHistory || isLast,
      isLastConfirmedHistory: isHistory && isLast,
    };
  }
}
