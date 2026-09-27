import { NodeRegistry } from "./node-registry.js";
import { ScopeStack } from "./scope.js";
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
  readonly bar_index: Series<number>;
}

export type BarExecutor = () => void;

/**
 * Outcome of feeding one realtime update to the session.
 *
 * - `processed` — the script executed on the update.
 * - `out_of_order` — the update's bar opens before the current bar; bars
 *   never move backwards, so it is discarded.
 * - `bar_already_confirmed` — the update belongs to the current bar, but that
 *   bar was already confirmed (closed and committed); committed history is
 *   immutable, so it is discarded.
 */
export type RealtimeTickOutcome = "processed" | "out_of_order" | "bar_already_confirmed";

export interface HistoricalBarFlags {
  /** The bar is the dataset's last bar (`barstate.islast`). */
  readonly isLast: boolean;
  /** The bar is the last confirmed historical bar (`barstate.islastconfirmedhistory`). */
  readonly isLastConfirmedHistory: boolean;
}

export interface PineSessionOptions {
  /** Maximum history offset for every series (Pine `max_bars_back`, 1..5000). */
  readonly maxBarsBack?: number | undefined;
}

/** Pine's largest historical buffer: `max_bars_back()` accepts at most 5000. */
const MAX_BARS_BACK_LIMIT = 5000;

const resolveMaxBarsBack = (value: number | undefined): number => {
  const resolved = value ?? MAX_BARS_BACK_LIMIT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_BARS_BACK_LIMIT) {
    throw new RangeError(`maxBarsBack must be an integer in [1, ${MAX_BARS_BACK_LIMIT}]`);
  }
  return resolved;
};

const INITIAL_BAR_STATE: BarState = {
  index: -1,
  isFirst: false,
  isLast: false,
  isHistory: false,
  isRealtime: false,
  isNew: false,
  isConfirmed: false,
  isLastConfirmedHistory: false,
  isfirst: false,
  islast: false,
  ishistory: false,
  isrealtime: false,
  isnew: false,
  isconfirmed: false,
  islastconfirmedhistory: false,
};

export class PineSession {
  public revision = 0;
  public barIndex = -1;
  /** Pine `last_bar_index`: the dataset's last bar index, then each realtime bar's index. */
  public lastBarIndex = -1;
  public barstate: BarState = INITIAL_BAR_STATE;

  public readonly maxBarsBack: number;
  public readonly scopes: ScopeStack = new ScopeStack();
  public readonly nodes: NodeRegistry = new NodeRegistry(this.scopes);
  public readonly state: PineState = new PineState(this.scopes);
  public readonly sources: SourceBundle;

  private readonly orderedSeries: {
    _commit(): void;
    _resetWorking(): void;
    _rollback(): void;
  }[] = [];
  private nextSeriesId = 1;
  private currentBar?: Bar;
  private currentBarConfirmed = false;
  private symbolInfo?: SymbolInfo;

  public constructor(options: PineSessionOptions = {}) {
    this.maxBarsBack = resolveMaxBarsBack(options.maxBarsBack);
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
      bar_index: createSeries<number>(this),
    };
  }

  public allocateSeriesId(): number {
    const id = this.nextSeriesId;
    this.nextSeriesId += 1;
    return id;
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

  /** Symbol timezone when symbol information is initialized. */
  public get timezone(): string | undefined {
    return this.symbolInfo?.timezone;
  }

  /**
   * Declares how many bars the historical dataset holds so `last_bar_index`
   * is known on every historical bar, as in Pine.
   */
  public expectHistoricalBars(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError("Historical bar count must be a non-negative integer");
    }
    this.lastBarIndex = this.barIndex + count;
  }

  public processHistoricalBar(bar: Bar, execute: BarExecutor, flags: HistoricalBarFlags): void {
    this.beginBar(bar, {
      history: true,
      confirmed: true,
      isLast: flags.isLast,
      isLastConfirmedHistory: flags.isLastConfirmedHistory,
    });
    execute();
    this.confirmBar();
  }

  public processRealtimeTick(bar: Bar, execute: BarExecutor): RealtimeTickOutcome {
    const previous = this.currentBar;
    if (previous !== undefined && bar.time < previous.time) return "out_of_order";

    const isNewBar = bar.time !== previous?.time;
    if (!isNewBar && this.currentBarConfirmed) return "bar_already_confirmed";

    // Pine always executes a realtime bar one last time on its closing tick
    // and commits it. When the feed moves to a new bar without an explicit
    // close for the open one, its last received update is the closing tick.
    if (isNewBar && previous !== undefined && !this.currentBarConfirmed) {
      this.closeOpenBar(previous, execute);
    }

    const confirmed = Boolean(bar.isClosed);
    this.currentBar = bar;
    if (isNewBar) {
      this.beginBar(bar, {
        history: false,
        confirmed,
        isLast: true,
        isLastConfirmedHistory: false,
      });
      this.lastBarIndex = Math.max(this.lastBarIndex, this.barIndex);
    } else {
      this.revision += 1;
      // Discard the previous revision's working state explicitly: series
      // working values, node working state, and `var` cells go back to the
      // last committed state. `varip` cells are intentionally preserved.
      this.rollbackWorkingState();
      this.updateSources(bar);
      this.barstate = this.createBarState({
        history: false,
        isNew: false,
        confirmed,
        isLast: true,
        isLastConfirmedHistory: false,
      });
    }

    execute();
    if (confirmed) this.confirmBar();
    return "processed";
  }

  private closeOpenBar(bar: Bar, execute: BarExecutor): void {
    this.revision += 1;
    this.rollbackWorkingState();
    this.updateSources(bar);
    this.barstate = this.createBarState({
      history: this.barstate.isHistory,
      isNew: false,
      confirmed: true,
      isLast: this.barstate.isLast,
      isLastConfirmedHistory: false,
    });
    execute();
    this.confirmBar();
  }

  private beginBar(
    bar: Bar,
    flags: {
      readonly history: boolean;
      readonly confirmed: boolean;
      readonly isLast: boolean;
      readonly isLastConfirmedHistory: boolean;
    },
  ): void {
    this.revision += 1;
    this.barIndex += 1;
    this.currentBar = bar;
    this.currentBarConfirmed = false;
    // The previous bar is always confirmed by now, so this only clears reset
    // working values; it never discards uncommitted bar state.
    this.rollbackWorkingState();
    this.barstate = this.createBarState({ ...flags, isNew: true });
    this.updateSources(bar);
  }

  private rollbackWorkingState(): void {
    for (const series of this.orderedSeries) series._rollback();
    this.state.rollback();
  }

  private createBarState(flags: {
    readonly history: boolean;
    readonly isNew: boolean;
    readonly confirmed: boolean;
    readonly isLast: boolean;
    readonly isLastConfirmedHistory: boolean;
  }): BarState {
    const { history, isNew, confirmed, isLast, isLastConfirmedHistory } = flags;
    return {
      index: this.barIndex,
      isFirst: this.barIndex === 0,
      isLast,
      isHistory: history,
      isRealtime: !history,
      isNew,
      isConfirmed: confirmed,
      isLastConfirmedHistory,
      // Pine v6 lowercase aliases
      isfirst: this.barIndex === 0,
      islast: isLast,
      ishistory: history,
      isrealtime: !history,
      isnew: isNew,
      isconfirmed: confirmed,
      islastconfirmedhistory: isLastConfirmedHistory,
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
    this.sources.bar_index._push(this.barIndex);
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
    this.currentBarConfirmed = true;
  }
}
