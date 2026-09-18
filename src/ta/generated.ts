/** GENERATED FILE. Run `pnpm manifest:generate` after changing api-manifest/ta.yaml. */
export type TaFunctionName =
  | "atr"
  | "bb"
  | "change"
  | "cmo"
  | "crossover"
  | "crossunder"
  | "dev"
  | "dmi"
  | "ema"
  | "highest"
  | "hma"
  | "lowest"
  | "macd"
  | "mom"
  | "rma"
  | "roc"
  | "rsi"
  | "sma"
  | "stdev"
  | "stoch"
  | "supertrend"
  | "swma"
  | "tr"
  | "variance"
  | "vwma"
  | "wma"
  | "wpr";
export type ImplementedTaFunctionName =
  | "atr"
  | "bb"
  | "change"
  | "cmo"
  | "crossover"
  | "crossunder"
  | "dev"
  | "dmi"
  | "ema"
  | "highest"
  | "hma"
  | "lowest"
  | "macd"
  | "mom"
  | "rma"
  | "roc"
  | "rsi"
  | "sma"
  | "stdev"
  | "stoch"
  | "supertrend"
  | "swma"
  | "tr"
  | "variance"
  | "vwma"
  | "wma"
  | "wpr";
export type VerifiedTaFunctionName =
  "change" | "crossover" | "crossunder" | "ema" | "highest" | "lowest" | "sma";
export const taV6FunctionNames = [
  "atr",
  "bb",
  "change",
  "cmo",
  "crossover",
  "crossunder",
  "dev",
  "dmi",
  "ema",
  "highest",
  "hma",
  "lowest",
  "macd",
  "mom",
  "rma",
  "roc",
  "rsi",
  "sma",
  "stdev",
  "stoch",
  "supertrend",
  "swma",
  "tr",
  "variance",
  "vwma",
  "wma",
  "wpr",
] as const;
