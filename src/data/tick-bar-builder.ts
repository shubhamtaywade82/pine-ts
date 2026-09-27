import type { Bar } from "../core/types.js";
import { sessionBucket, type ExchangeSession, type SessionBucket } from "./exchange-session.js";

/** One trade print from a market feed. */
export interface TradeTick {
  readonly price: number;
  /** Trade time, UNIX seconds. */
  readonly time: number;
  /** Cumulative traded volume for the session, when the feed reports it. */
  readonly cumulativeVolume?: number;
}

export type TickRejection = "outside_session" | "late" | "invalid";

export type TickOutcome =
  | { readonly kind: "bars"; readonly bars: readonly Bar[] }
  | { readonly kind: "rejected"; readonly reason: TickRejection };

interface OpenBar {
  readonly bucket: SessionBucket;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
  /** Cumulative session volume already attributed before this bar. */
  volumeBase: number | undefined;
  /** Volume known for this bar before the first cumulative reading (a seed). */
  seededVolume: number;
  lastCumulative: number | undefined;
}

/**
 * Builds session-anchored bars from trade ticks.
 *
 * States per bar: open (receives ticks) -> closed (emitted once with
 * `isClosed: true`). A tick for a later bucket closes the open bar first; a
 * tick for an older or already-closed bucket is rejected as `late`. Volume is
 * the difference of the feed's cumulative session volume, so each bar gets
 * the volume traded inside it; a new session resets the base to zero.
 */
export class TickBarBuilder {
  private current: OpenBar | undefined;

  public constructor(
    private readonly intervalSeconds: number,
    private readonly session: ExchangeSession,
    private readonly identity: { readonly symbol: string; readonly timeframe: string },
  ) {}

  /** End of the open bar's bucket (UNIX seconds), or undefined when no bar is open. */
  public get openBarEnd(): number | undefined {
    return this.current !== undefined && !this.current.closed ? this.current.bucket.end : undefined;
  }

  /**
   * Continues a bar that is already partly known, e.g. the still-forming last
   * bar of a historical request, so ticks extend it instead of restarting it.
   */
  public seed(bar: Bar): void {
    const bucket = sessionBucket(bar.time / 1000, this.intervalSeconds, this.session);
    if (bucket?.start !== bar.time / 1000) {
      throw new RangeError("Seed bar time must be a session bucket start");
    }
    this.current = {
      bucket,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      closed: false,
      volumeBase: undefined,
      seededVolume: bar.volume,
      lastCumulative: undefined,
    };
  }

  public onTick(tick: TradeTick): TickOutcome {
    if (!isValidTick(tick)) return { kind: "rejected", reason: "invalid" };
    const bucket = sessionBucket(tick.time, this.intervalSeconds, this.session);
    if (bucket === undefined) return { kind: "rejected", reason: "outside_session" };

    const previous = this.current;
    if (previous !== undefined && bucket.start < previous.bucket.start) {
      return { kind: "rejected", reason: "late" };
    }
    if (previous?.bucket.start === bucket.start) {
      if (previous.closed) return { kind: "rejected", reason: "late" };
      this.apply(previous, tick);
      return { kind: "bars", bars: [this.toBar(previous)] };
    }

    const emitted: Bar[] = [];
    if (previous !== undefined && !previous.closed) {
      previous.closed = true;
      emitted.push(this.toBar(previous));
    }
    const volumeBase = nextVolumeBase(previous, bucket);
    const next: OpenBar = {
      bucket,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: 0,
      closed: false,
      volumeBase,
      seededVolume: 0,
      lastCumulative: volumeBase,
    };
    this.current = next;
    this.apply(next, tick);
    emitted.push(this.toBar(next));
    return { kind: "bars", bars: emitted };
  }

  /** Closes the open bar once `nowSeconds` reaches its bucket end. */
  public closeDue(nowSeconds: number): Bar | undefined {
    const bar = this.current;
    if (bar === undefined || bar.closed || nowSeconds < bar.bucket.end) return undefined;
    bar.closed = true;
    return this.toBar(bar);
  }

  private apply(bar: OpenBar, tick: TradeTick): void {
    bar.high = Math.max(bar.high, tick.price);
    bar.low = Math.min(bar.low, tick.price);
    bar.close = tick.price;
    const cumulative = tick.cumulativeVolume;
    if (cumulative === undefined) return;
    // First reading inside a stream that joined mid-bar: attribute the seeded
    // volume to this bar and measure only what trades from here on.
    bar.volumeBase ??= cumulative - bar.seededVolume;
    // Cumulative volume only falls when the feed restarts its session count.
    if (cumulative < bar.volumeBase) bar.volumeBase = 0;
    bar.volume = cumulative - bar.volumeBase;
    bar.lastCumulative = cumulative;
  }

  private toBar(bar: OpenBar): Bar {
    return {
      time: bar.bucket.start * 1000,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      isClosed: bar.closed,
      symbol: this.identity.symbol,
      timeframe: this.identity.timeframe,
    };
  }
}

/**
 * Cumulative volume already attributed before a new bar:
 * - no earlier bar in this stream: unknown, so measure from the first reading;
 * - earlier bar in the same session: its last cumulative reading;
 * - earlier bar in a previous session: zero, as the feed restarts its count.
 */
const nextVolumeBase = (
  previous: OpenBar | undefined,
  bucket: SessionBucket,
): number | undefined => {
  if (previous === undefined) return undefined;
  return previous.bucket.sessionOpen === bucket.sessionOpen ? previous.lastCumulative : 0;
};

const isValidTick = (tick: TradeTick): boolean =>
  Number.isFinite(tick.price) &&
  tick.price > 0 &&
  Number.isInteger(tick.time) &&
  tick.time > 0 &&
  (tick.cumulativeVolume === undefined ||
    (Number.isFinite(tick.cumulativeVolume) && tick.cumulativeVolume >= 0));
