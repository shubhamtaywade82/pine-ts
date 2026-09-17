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
  private readonly executionMode: PineExecutionMode;
  private symbolInfo?: SymbolInfo;
  private committedState = new Map<string, unknown>();
  private currentBarTime?: number;

  public constructor(private readonly options: RuntimeOptions) {
    this.executionMode = options.executionMode ?? "historical";
  }

  public async run(script: PineScript, bars?: readonly Bar[]): Promise<void> {
    const data =
      bars ??
      (await this.options.provider.getHistoricalBars({
        symbol: this.options.symbol,
        timeframe: this.options.timeframe,
      }));
    this.symbolInfo ??= await this.options.provider.getSymbolInfo(this.options.symbol);

    for (let index = 0; index < data.length; index += 1) {
      const bar = data[index];
      if (bar === undefined) {
        continue;
      }

      this.ohlcv.commit(bar);
      await script(this.context(bar, this.createBarState(index, data.length, true, true, true)));
      this.committedState = this.state.snapshot();
    }
  }

  public async runRealtime(script: PineScript): Promise<void> {
    this.symbolInfo ??= await this.options.provider.getSymbolInfo(this.options.symbol);
    let index = 0;

    for await (const bar of this.options.provider.streamBars({
      symbol: this.options.symbol,
      timeframe: this.options.timeframe,
    })) {
      const isNewBar = this.currentBarTime === undefined || bar.time !== this.currentBarTime;

      if (isNewBar) {
        this.ohlcv.commit(bar);
        this.currentBarTime = bar.time;
        this.committedState = this.state.snapshot();
      } else {
        this.state.restore(this.committedState);
        this.ohlcv.replaceCurrent(bar);
        invalidateAllIndicatorState();
      }

      await script(this.context(bar, this.createBarState(index, index, isNewBar, Boolean(bar.isClosed), false)));

      if (bar.isClosed) {
        this.committedState = this.state.snapshot();
      }
      if (isNewBar) {
        index += 1;
      }
    }
  }

  private context(bar: Bar, barstate: BarState): PineContext {
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
      syminfo: this.symbolInfo!,
      state: this.state,
    };
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
