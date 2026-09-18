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
