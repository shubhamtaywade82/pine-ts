/** GENERATED FILE. Run `pnpm manifest:generate` after changing api-manifest/ta.yaml. */
export type TaFunctionName = "atr" | "bb" | "cmo" | "crossunder" | "crossover" | "ema" | "highest" | "lowest" | "macd" | "mom" | "roc" | "rsi" | "sma" | "stoch" | "supertrend" | "swma" | "tr" | "vwma" | "wma" | "wpr";
export type ImplementedTaFunctionName = "atr" | "cmo" | "crossunder" | "crossover" | "ema" | "highest" | "lowest" | "hma" | "mom" | "rma" | "roc" | "rsi" | "sma" | "stoch" | "swma" | "tr" | "vwma" | "wma" | "wpr";
export type VerifiedTaFunctionName = "change" | "crossunder" | "crossover" | "ema" | "highest" | "lowest" | "sma";
export const taV6FunctionNames = [
  "atr", "bb", "cmo", "crossunder", "crossover", "ema", "highest", "lowest", "macd", "mom",
  "roc", "rsi", "sma", "stoch", "supertrend", "swma", "tr", "vwma", "wma", "wpr"
] as const;
