import type { Bar } from "./types.js";

export interface RealtimeCheckpoint {
  readonly committedLength: number;
  readonly bar: Bar;
}

/** Tracks a realtime bar's working state separately from committed historical state. */
export class RealtimeTransaction {
  private checkpoint?: RealtimeCheckpoint;

  public begin(committedLength: number, bar: Bar): void {
    this.checkpoint = { committedLength, bar };
  }

  public get active(): boolean {
    return this.checkpoint !== undefined;
  }

  public commit(): void {
    this.checkpoint = undefined;
  }

  public rollback(): RealtimeCheckpoint | undefined {
    const checkpoint = this.checkpoint;
    this.checkpoint = undefined;
    return checkpoint;
  }
}
