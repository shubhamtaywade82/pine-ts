/**
 * Built-in indicator registry — imports each built-in indicator module
 * so they self-register with the active {@link IndicatorRegistry}.
 *
 * A chart workbench can call `import "pine-ts/registry/indicators"` to
 * load all built-ins; users can also import specific indicators directly.
 */

import { registerIndicator } from "../registry.js";
import { sma } from "./sma.js";
import { ema } from "./ema.js";
import { rsi } from "./rsi.js";
import { macd } from "./macd.js";
import { bb } from "./bb.js";
import { obv } from "./obv.js";

/** Registers the built-in indicators with the active registry. Idempotent. */
export const registerBuiltinIndicators = (): void => {
  registerIndicator(sma);
  registerIndicator(ema);
  registerIndicator(rsi);
  registerIndicator(macd);
  registerIndicator(bb);
  registerIndicator(obv);
};

// Self-register on module import.
registerBuiltinIndicators();

export { sma } from "./sma.js";
export { ema } from "./ema.js";
export { rsi } from "./rsi.js";
export { macd } from "./macd.js";
export { bb } from "./bb.js";
export { obv } from "./obv.js";
