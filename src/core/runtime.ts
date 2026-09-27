import { createContext, type PineContext } from "./context.js";
import { setCurrentSession } from "./execution-context.js";
import { PineSession, type RealtimeTickOutcome, type SourceBundle } from "./session.js";
import type { PineState } from "./state.js";
import type { Bar, BarState, MarketDataProvider, SymbolInfo } from "./types.js";
import { parse, type TimeframeInfo } from "../time/timeframe.js";

export type PineScript = (context: PineContext) => void;

/** Why a realtime update was not executed. */
export type DiscardedTickReason = Exclude<RealtimeTickOutcome, "processed">;

export interface DiscardedTick {
  readonly bar: Bar;
  readonly reason: DiscardedTickReason;
}

export interface RuntimeOptions {
  readonly provider: MarketDataProvider;
  readonly symbol: string;
  /** Pine timeframe string (`"1"`, `"60"`, `"1D"`, `"1W"`, `"1M"`, `"30S"`, ...). */
  readonly timeframe: string;
  /**
   * Historical buffer size for every series (Pine `max_bars_back`). Offsets
   * beyond it raise a RangeError. Defaults to 5000, Pine's largest buffer.
   */
  readonly maxBarsBack?: number;
  /**
   * Observes realtime updates the session refuses to execute: updates for a
   * bar older than the current one, or for a bar that already confirmed.
   * Committed history is immutable, so such updates are dropped either way.
   */
  readonly onDiscardedTick?: (tick: DiscardedTick) => void;
}

export class PineRuntime {
  private readonly session: PineSession;
  private readonly timeframe: TimeframeInfo;
  private symbolInfo?: SymbolInfo;

  public constructor(private readonly options: RuntimeOptions) {
    this.session = new PineSession({ maxBarsBack: options.maxBarsBack });
    this.timeframe = parse(options.timeframe);
  }

  /**
   * Executes the script over historical bars. Every bar is confirmed except a
   * final bar explicitly marked `isClosed: false`: that bar is still forming,
   * so it executes as the open realtime bar (Pine's chart-load behavior) and
   * later {@link runRealtime} updates for it continue that bar.
   */
  public async run(script: PineScript, bars?: readonly Bar[]): Promise<void> {
    await this.initialize();
    const data = await this.loadHistoricalBars(bars);
    assertChronological(data);

    const lastIsOpen = data.at(-1)?.isClosed === false;
    const confirmedCount = lastIsOpen ? data.length - 1 : data.length;
    this.session.expectHistoricalBars(data.length);

    for (const [index, bar] of data.slice(0, confirmedCount).entries()) {
      this.session.processHistoricalBar(bar, () => this.execute(script, bar), {
        isLast: index === data.length - 1,
        isLastConfirmedHistory: index === confirmedCount - 1,
      });
    }

    const openBar = lastIsOpen ? data.at(-1) : undefined;
    if (openBar !== undefined) this.feedRealtime(script, openBar);
  }

  public async runRealtime(script: PineScript): Promise<void> {
    await this.initialize();

    for await (const bar of this.options.provider.streamBars({
      symbol: this.options.symbol,
      timeframe: this.options.timeframe,
    })) {
      this.feedRealtime(script, bar);
    }
  }

  public get sources(): SourceBundle {
    return this.session.sources;
  }

  public get state(): PineState {
    return this.session.state;
  }

  public get currentBarState(): BarState {
    return this.session.barstate;
  }

  public get barIndex(): number {
    return this.session.barIndex;
  }

  public get lastBarIndex(): number {
    return this.session.lastBarIndex;
  }

  public get currentBarTime(): number | undefined {
    return this.session.sources.time.at(0);
  }

  private feedRealtime(script: PineScript, bar: Bar): void {
    const outcome = this.session.processRealtimeTick(bar, () => this.execute(script, bar));
    if (outcome !== "processed") this.options.onDiscardedTick?.({ bar, reason: outcome });
  }

  private async initialize(): Promise<void> {
    this.symbolInfo ??= await this.options.provider.getSymbolInfo(this.options.symbol);
    this.session.setSymbolInfo(this.symbolInfo);
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

  private execute(script: PineScript, bar: Bar): void {
    const previousSession = setCurrentSession(this.session);
    try {
      script(createContext(this.session, bar, this.timeframe));
    } finally {
      setCurrentSession(previousSession);
    }
  }
}

const assertChronological = (bars: readonly Bar[]): void => {
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    if (previous !== undefined && current !== undefined && current.time <= previous.time) {
      throw new Error(
        `Historical bars must be strictly increasing in time (bar ${index}: ${current.time} <= ${previous.time})`,
      );
    }
  }
};
