import type { PineSession } from "./session.js";

let currentSession: PineSession | undefined;

export const setCurrentSession = (session: PineSession | undefined): PineSession | undefined => {
  const previous = currentSession;
  currentSession = session;
  return previous;
};

export const requireCurrentSession = (): PineSession => {
  if (currentSession === undefined) {
    throw new Error("Pine execution context is not active; run the script through PineRuntime");
  }
  return currentSession;
};

/**
 * The ambient session while a script executes, or undefined outside script
 * execution. Built-ins with per-execution state (e.g. `math.random` seeded
 * sequences) scope that state to the current session so separate runs replay
 * identically.
 */
export const getCurrentSession = (): PineSession | undefined => currentSession;
