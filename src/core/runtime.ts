import { createContext, type PineContext } from "./context.js";
import { setCurrentSession } from "./execution-context.js";
import { PineSession, type SourceBundle } from "./session.js";
import type { PineState } from "./state.js";
import type { Bar, BarState, MarketDataProvider, PineExecutionMode, SymbolInfo } from "./types.js";

export type PineScript = (context: PineContext) => void;

export interface RuntimeOptions {
  readonly provider: MarketDataProvider;
  readonly symbol: string;
  readonly timeframe: string;
  readonly executionMode?: PineExecutionMode;
}

export class PineRuntime {
  private readonly session = new PineSession();
  private symbolInfo?: SymbolInfo;
  private currentBar?: Bar;

  public constructor(private readonly options: RuntimeOptions) {}

  public async run(script: PineScript, bars?: readonly Bar[]): Promise<void> {
    await this.initialize();
    const data = await this.loadHistoricalBars(bars);

    for (const [index, bar] of data.entries()) {
      this.currentBar = bar;
      this.session.processHistoricalBar(bar, () => this.execute(script), index === data.length - 1);
    }
  }

  public async runRealtime(script: PineScript): Promise<void> {
    await this.initialize();

    for await (const bar of this.options.provider.streamBars({
      symbol: this.options.symbol,
      timeframe: this.options.timeframe,
    })) {
      this.currentBar = bar;
      this.session.processRealtimeTick(bar, () => this.execute(script));
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

  public get currentBarTime(): number | undefined {
    return this.currentBar?.time;
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

  private execute(script: PineScript): void {
    const previousSession = setCurrentSession(this.session);
    try {
      script(createContext(this.session, this.currentBar!));
    } finally {
      setCurrentSession(previousSession);
    }
  }
}
