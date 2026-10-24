/**
 * Pine Script v6 `log.*` namespace — runtime logging.
 *
 * Pine v6 introduced `log.*` for emitting structured log entries during
 * script execution. The functions emit on a per-runtime log buffer that
 * callers can inspect; entries carry a level (`info`/`warning`/`error`),
 * a message, and a bar reference (bar_index and bar time). `runtime.error`
 * raises a script execution error that aborts the current bar.
 */

import { getCurrentSession } from "../core/execution-context.js";
import type { PineSession } from "../core/session.js";

export type LogLevel = "info" | "warning" | "error";

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly barIndex: number;
  readonly barTime: number | undefined;
}

/** Hook for capturing log entries from a runtime. */
export type LogSink = (entry: LogEntry) => void;

let activeSink: LogSink | undefined;

/**
 * Installs a `LogSink` for the current invocation. The runtime installs a
 * sink that buffers entries into the active session's log buffer; test code
 * can install its own sink to capture entries.
 */
export const setLogSink = (sink: LogSink | undefined): void => {
  activeSink = sink;
};

const captureEntry = (level: LogLevel, message: string): void => {
  if (activeSink === undefined) return;
  let barIndex = Number.NaN;
  let barTime: number | undefined;
  const session = getCurrentSession();
  if (session !== undefined) {
    barIndex = session.barIndex;
    barTime = session.sources.time.at(0) ?? undefined;
  }
  activeSink({ level, message, barIndex, barTime });
};

/**
 * `log.info(message)`. Emits an informational entry.
 */
export const info = (message: string): void => {
  captureEntry("info", message);
};

/**
 * `log.warning(message)`. Emits a warning entry.
 */
export const warning = (message: string): void => {
  captureEntry("warning", message);
};

/**
 * `log.error(message)`. Emits an error entry. Unlike `runtime.error`, this
 * does NOT abort the current bar's evaluation; the script continues.
 */
export const error = (message: string): void => {
  captureEntry("error", message);
};

/**
 * `runtime.error(message)`. Raises a script execution error that aborts the
 * current bar's evaluation. The runtime catches it at the session boundary
 * and converts it into a `RuntimeError` for the host.
 */
export class RuntimeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

/**
 * `runtime.error(message)`. Throws a {@link RuntimeError} that aborts the
 * current bar's evaluation. The runtime catches it at the session boundary
 * and converts it into a `RuntimeError` for the host.
 */
export const runtimeError = (message: string): never => {
  throw new RuntimeError(message);
};

export { getCurrentSession };
export type { PineSession };
