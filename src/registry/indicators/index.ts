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
import { vwap } from "./vwap.js";
import { supertrend } from "./supertrend.js";
import { stoch } from "./stoch.js";
import { atr } from "./atr.js";
import { kc } from "./kc.js";
import { sar } from "./sar.js";
import { mfi } from "./mfi.js";
import { wma } from "./wma.js";
import { hma } from "./hma.js";
import { cci } from "./cci.js";
import { wpr } from "./wpr.js";
import { dmi } from "./dmi.js";
import { mlSupertrend } from "./ml-supertrend.js";
import { smcStructure } from "./smc-structure.js";
import { smcFvg } from "./smc-fvg.js";
import { smcOb } from "./smc-ob.js";
import { smcLiquidity } from "./smc-liquidity.js";
import { mtfTrend } from "./mtf-trend.js";

/** Registers the built-in indicators with the active registry. Idempotent. */
export const registerBuiltinIndicators = (): void => {
  registerIndicator(sma);
  registerIndicator(ema);
  registerIndicator(rsi);
  registerIndicator(macd);
  registerIndicator(bb);
  registerIndicator(obv);
  registerIndicator(vwap);
  registerIndicator(supertrend);
  registerIndicator(stoch);
  registerIndicator(atr);
  registerIndicator(kc);
  registerIndicator(sar);
  registerIndicator(mfi);
  registerIndicator(wma);
  registerIndicator(hma);
  registerIndicator(cci);
  registerIndicator(wpr);
  registerIndicator(dmi);
  registerIndicator(mlSupertrend);
  registerIndicator(smcStructure);
  registerIndicator(smcFvg);
  registerIndicator(smcOb);
  registerIndicator(smcLiquidity);
  registerIndicator(mtfTrend);
};

// Self-register on module import.
registerBuiltinIndicators();

export { sma } from "./sma.js";
export { ema } from "./ema.js";
export { rsi } from "./rsi.js";
export { macd } from "./macd.js";
export { bb } from "./bb.js";
export { obv } from "./obv.js";
export { vwap } from "./vwap.js";
export { supertrend } from "./supertrend.js";
export { stoch } from "./stoch.js";
export { atr } from "./atr.js";
export { kc } from "./kc.js";
export { sar } from "./sar.js";
export { mfi } from "./mfi.js";
export { wma } from "./wma.js";
export { hma } from "./hma.js";
export { cci } from "./cci.js";
export { wpr } from "./wpr.js";
export { dmi } from "./dmi.js";
export { mlSupertrend } from "./ml-supertrend.js";
export { smcStructure } from "./smc-structure.js";
export { smcFvg } from "./smc-fvg.js";
export { smcOb } from "./smc-ob.js";
export { smcLiquidity } from "./smc-liquidity.js";
export { mtfTrend } from "./mtf-trend.js";
