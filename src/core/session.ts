import { createSeries, type FloatSeries } from "./series.js";
import { NodeRegistry } from "./node-registry.js";
import { PineState } from "./state.js";
import type { Bar, BarState, SymbolInfo } from "./types.js";

export interface SourceBundle {
  readonly open: FloatSeries;
  readonly high: FloatSeries;
  readonly low: FloatSeries;
  readonly close: FloatSeries;
  readonly volume: FloatSeries;
  readonly time: SeriesLikeNumber;
  readonly hl2: FloatSeries;
  readonly hlc3: FloatSeries;
  readonly ohlc4: FloatSeries;
}

export interface SeriesLikeNumber {
  readonly current: number | undefined;
  at(offset: number): number | undefined;
}

export class PineSession {
  public revision = 0;
  public barIndex = -1;
  public barstate: BarState = {
    index: -1,
    isFirst: false,
    isLast: false,
    isHistory: false,
    isRealtime: false,
    isNew: false,
    isConfirmed: false,
    isLastConfirmedHistory: false,
  };

  public readonly nodes = new NodeRegistry();
  public readonly state = new PineState();
  public readonly sources: SourceBundle;
  private readonly orderedSeries: Array<{ _commit(): void; _resetWorking(): void }> = [];
  private symbolInfo?: SymbolInfo;

  public constructor() {
    const open = createSeries<number>(this);
    const high = createSeries<number>(this);
    const low = createSeries<number>(this);
    const close = createSeries<number>(this);
    const volume = createSeries<number>(this);
    const time = createSeries<number>(this);
    const hl2 = createSeries<number>(this);
    const hlc3 = createSeries<number>(this);
    const ohlc4 = createSeries<number>(this);

    this.sources = { open, high, low, close, volume, time, hl2, hlc3, ohlc4 };
  }

  public registerSeries(series: { _commit(): void; _resetWorking(): void }): void {
    this.orderedSeries.push(series);
  }

  public setSymbolInfo(symbolInfo: SymbolInfo): void {
    this.symbolInfo = symbolInfo;
  }

  public getSymbolInfo(): SymbolInfo {
    if (this.symbolInfo === undefined) {
      throw new Error("PineSession symbol information is not initialized");
    }
    return this.symbolInfo;
  }

  public processHistoricalBar(bar: Bar, execute: () => void): void {
    this.beginBar(bar, true, true, true);
    execute();
    this.confirmBar();
  }

  public processRealtimeTick(bar: Bar, execute: () => void): void {
    const newBar = this.currentTime !== bar.time;
    if (newBar) {
      this.beginBar(bar, false, true, false);
      execute();
      return;
    }

    this.revision += 1;
    this.state.rollback();
    this.sourcesUpdate(bar);
    this.barstate = this.createBarState(false, false, false, Boolean(bar.isClosed));
    execute();

    if (bar.isClosed) {
      this.confirmBar();
    }
  }

  private currentTime?: number;

  private beginBar(bar: Bar, history: boolean, isNew: boolean, confirmed: boolean): void {
    this.revision += 1;
    this.barIndex += 1;
    this.currentTime = bar.time;
    this.barstate = this.createBarState(history, isNew, true, confirmed);
    this.sourcesUpdate(bar);
  }

  private createBarState(
    history: boolean,
    isNew: boolean,
    isRealtime: boolean,
    confirmed: boolean,
  ): BarState {
    return {
      index: this.barIndex,
      isFirst: this.barIndex === 0,
      isLast: true,
      isHistory: history,
      isRealtime,
      isNew,
      isConfirmed: confirmed,
      isLastConfirmedHistory: history,
    };
  }

  private sourcesUpdate(bar: Bar): void {
    this.sources.open._push(bar.open);
    this.sources.high._push(bar.high);
    this.sources.low._push(bar.low);
    this.sources.close._push(bar.close);
    this.sources.volume._push(bar.volume);
    this.sources.time._push(bar.time);
    this.sources.hl2._push((bar.high + bar.low) / 2);
    this.sources.hlc3._push((bar.high + bar.low + bar.close) / 3);
    this.sources.ohlc4._push((bar.open + bar.high + bar.low + bar.close) / 4);
  }

  private confirmBar(): void {
    for (const series of this.orderedSeries) series._commit();
    for (const series of this.orderedSeries) series._resetWorking();
    this.state.commit();
  }
}
