import type { PineContext } from "./context.js";
import { OhlcvSeries } from "./context.js";
import { invalidateAllIndicatorState } from "./indicator-cache.js";
import { PineState } from "./state.js";
import type {
  Bar,
  BarState,
  MarketDataProvider,
  PineExecutionMode,
  SymbolInfo,
} from "./types.js";

export type PineScript = (context: PineContext) => void | Promise<void>;

export interface RuntimeOptions {
  readonly provider: MarketDataProvider;
  readonly symbol: string;
  readonly timeframe: string;
  readonly executionMode?: PineExecutionMode;
}

export class PineRuntime {
  private readonly ohlcv = new OhlcvSeries();
  private readonly state = new PineState();
  private symbolInfo?: SymbolInfo;
  private committedState = new Map<string, unknown>();
  private currentBarTime?: number;

  public constructor(private readonly options: RuntimeOptions) {}

  public async run(script: PineScript, bars?: readonly Bar[]): Promise<void> {
    const data = await this.loadHistoricalBars(bars);
    const symbolInfo = await this.loadSymbolInfo();

    for (let index = 0; index < data.length; index += 1) {
      const bar = data[index];
      if (bar === undefined) {
        continue;
      }

      await this.executeHistoricalBar(script, bar, index, data.length, symbolInfo);
    }
  }

  public async runRealtime(script: PineScript): Promise<void> {
    const symbolInfo = await this.loadSymbolInfo();
    let index = 0;

    for await (const bar of this.options.provider.streamBars({
      symbol: this.options.symbol,
      timeframe: this.options.timeframe,
    })) {
      const isNewBar = this.prepareRealtimeBar(bar);
      await script(this.createContext(bar, this.createRealtimeBarState(index, isNewBar, bar), symbolInfo));

      if (bar.isClosed) {
        this.committedState = this.state.snapshot();
      }

      if (isNewBar) {
        index += 1;
      }
    }
  }

  private async loadHistoricalBars(bars?: readonly Bar[]): Promise<readonly Bar[]> {
    return (
      bars ??
      (await this.options.provider.getHistoricalBars({
        symbol: this.options.symbol,
        timeframe: this.options.timeframe,
      }))
    );
  }

  private async loadSymbolInfo(): Promise<SymbolInfo> {
    this.symbolInfo ??= await this.options.provider.getSymbolInfo(this.options.symbol);
    return this.symbolInfo;
  }

  private async executeHistoricalBar(
    script: PineScript,
    bar: Bar,
    index: number,
    total: number,
    symbolInfo: SymbolInfo,
  ): Promise<void> {
    this.ohlcv.commit(bar);
    const barState = this.createHistoricalBarState(index, total);
    await script(this.createContext(bar, barState, symbolInfo));
    this.committedState = this.state.snapshot();
  }

  private prepareRealtimeBar(bar: Bar): boolean {
    const isNewBar = this.currentBarTime === undefined || bar.time !== this.currentBarTime;

    if (isNewBar) {
      this.ohlcv.commit(bar);
      this.currentBarTime = bar.time;
      this.committedState = this.state.snapshot();
      return true;
    }

    this.state.restore(this.committedState);
    this.ohlcv.replaceCurrent(bar);
    invalidateAllIndicatorState();
    return false;
  }

  private createContext(bar: Bar, barstate: BarState, symbolInfo: SymbolInfo): PineContext {
    return {
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
      barstate,
      syminfo: symbolInfo,
      state: this.state,
    };
  }

  private createHistoricalBarState(index: number, total: number): BarState {
    return this.createBarState(index, total, true, true, true);
  }

  private createRealtimeBarState(index: number, isNew: boolean, bar: Bar): BarState {
    return this.createBarState(index, index, isNew, Boolean(bar.isClosed), false);
  }

  private createBarState(
    index: number,
    total: number,
    isNew: boolean,
    isConfirmed: boolean,
    isHistory: boolean,
  ): BarState {
    const isFirst = index === 0;
    const isLast = isHistory ? index === total - 1 : true;

    return {
      index,
      isFirst,
      isLast,
      isHistory,
      isRealtime: !isHistory,
      isNew,
      isConfirmed: isHistory || isConfirmed,
      isLastConfirmedHistory: isHistory && isLast,
    };
  }
}
