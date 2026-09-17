import type { Bar, BarState, SymbolInfo } from "./types.js";
import { createSeries, type Series } from "./series.js";
import type { PineState } from "./state.js";

export interface PineContext {
  readonly bar: Bar;
  readonly open: Series<number>;
  readonly high: Series<number>;
  readonly low: Series<number>;
  readonly close: Series<number>;
  readonly volume: Series<number>;
  readonly time: Series<number>;
  readonly hl2: Series<number>;
  readonly hlc3: Series<number>;
  readonly ohlc4: Series<number>;
  readonly barstate: BarState;
  readonly syminfo: SymbolInfo;
  readonly state: PineState;
}

export class OhlcvSeries {
  public readonly open = createSeries<number>();
  public readonly high = createSeries<number>();
  public readonly low = createSeries<number>();
  public readonly close = createSeries<number>();
  public readonly volume = createSeries<number>();
  public readonly time = createSeries<number>();
  public readonly hl2 = createSeries<number>();
  public readonly hlc3 = createSeries<number>();
  public readonly ohlc4 = createSeries<number>();

  public commit(bar: Bar): void {
    this.open.push(bar.open);
    this.high.push(bar.high);
    this.low.push(bar.low);
    this.close.push(bar.close);
    this.volume.push(bar.volume);
    this.time.push(bar.time);
    this.hl2.push((bar.high + bar.low) / 2);
    this.hlc3.push((bar.high + bar.low + bar.close) / 3);
    this.ohlc4.push((bar.open + bar.high + bar.low + bar.close) / 4);
  }

  public replaceCurrent(bar: Bar): void {
    this.open.replaceCurrent(bar.open);
    this.high.replaceCurrent(bar.high);
    this.low.replaceCurrent(bar.low);
    this.close.replaceCurrent(bar.close);
    this.volume.replaceCurrent(bar.volume);
    this.time.replaceCurrent(bar.time);
    this.hl2.replaceCurrent((bar.high + bar.low) / 2);
    this.hlc3.replaceCurrent((bar.high + bar.low + bar.close) / 3);
    this.ohlc4.replaceCurrent((bar.open + bar.high + bar.low + bar.close) / 4);
  }

  public get length(): number {
    return this.close.length;
  }
}
