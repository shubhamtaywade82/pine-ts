import { NodeRegistry } from "./node-registry.js";
import { PineState } from "./state.js";
import { createFloatSeries, createSeries, type FloatSeries, type Series } from "./series.js";
import type { Bar, BarState, SymbolInfo } from "./types.js";

export interface SourceBundle {
  readonly open: FloatSeries;
  readonly high: FloatSeries;
  readonly low: FloatSeries;
  readonly close: FloatSeries;
  readonly volume: FloatSeries;
  readonly time: Series<number>;
  readonly hl2: FloatSeries;
  readonly hlc3: FloatSeries;
  readonly ohlc4: FloatSeries;
}

export type BarExecutor = () => void;

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

  public readonly nodes: NodeRegistry = new NodeRegistry();
  public readonly state: PineState = new PineState();
  public readonly sources: SourceBundle;

  private readonly orderedSeries: {
    _commit(): void;
    _resetWorking(): void;
    _rollback(): void;
  }[] = [];
  private currentTime?: number;
  private symbolInfo?: SymbolInfo;

  public constructor() {
    this.sources = {
      open: createFloatSeries(this),
      high: createFloatSeries(this),
      low: createFloatSeries(this),
      close: createFloatSeries(this),
      volume: createFloatSeries(this),
      time: createSeries<number>(this),
      hl2: createFloatSeries(this),
      hlc3: createFloatSeries(this),
      ohlc4: createFloatSeries(this),
    };
  }

  public registerSeries(series: {
    _commit(): void;
    _resetWorking(): void;
    _rollback(): void;
  }): void {
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

  public processHistoricalBar(bar: Bar, execute: BarExecutor, isLast: boolean): void {
    this.beginBar(bar, true, true, true, isLast);
    execute();
    this.confirmBar();
  }

  public processRealtimeTick(bar: Bar, execute: BarExecutor): void {
    const isNewBar = this.currentTime === undefined || bar.time !== this.currentTime;

    if (isNewBar) {
      this.beginBar(bar, false, true, Boolean(bar.isClosed), true);
      execute();
      if (bar.isClosed) this.confirmBar();
      return;
    }

    this.revision += 1;
    // Discard the previous revision's working state explicitly: series
    // working values, node working state, and `var` cells go back to the last
    // committed state. `varip` cells are intentionally preserved.
    this.rollbackWorkingState();
    this.updateSources(bar);
    this.barstate = this.createBarState(false, false, true, Boolean(bar.isClosed), true);
    execute();

    if (bar.isClosed) this.confirmBar();
  }

  private beginBar(
    bar: Bar,
    history: boolean,
    isNew: boolean,
    confirmed: boolean,
    isLast: boolean,
  ): void {
    this.revision += 1;
    this.barIndex += 1;
    this.currentTime = bar.time;
    // A realtime bar that never confirmed leaves working state behind: tick
    // values the historical execution model would not have produced. Roll it
    // back before the new bar starts so realtime stays replay-equivalent —
    // an unconfirmed bar vanishes exactly like a bar that never happened.
    // After a confirmed bar (and in historical execution) this is a no-op.
    this.rollbackWorkingState();
    this.barstate = this.createBarState(history, isNew, !history, confirmed, isLast);
    this.updateSources(bar);
  }

  private rollbackWorkingState(): void {
    for (const series of this.orderedSeries) series._rollback();
    this.state.rollback();
  }

  private createBarState(
    history: boolean,
    isNew: boolean,
    realtime: boolean,
    confirmed: boolean,
    isLast: boolean,
  ): BarState {
    return {
      index: this.barIndex,
      isFirst: this.barIndex === 0,
      isLast,
      isHistory: history,
      isRealtime: realtime,
      isNew,
      isConfirmed: confirmed,
      isLastConfirmedHistory: history && isLast,
    };
  }

  private updateSources(bar: Bar): void {
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
    // Commit and reset each series atomically in reverse registration order so
    // downstream nodes commit first and observe their dependencies' cached
    // working values for the closing bar. Committing a dependency first resets
    // it, so a consumer's commit-time at(0) would re-evaluate the dependency
    // against incremental state that already advanced this bar, corrupting
    // chains such as an EMA of a derived series. History offsets like at(1)
    // resolve to the previous committed bar either way.
    for (const series of this.orderedSeries.toReversed()) {
      series._commit();
      series._resetWorking();
    }
    this.state.commit();
  }
}
