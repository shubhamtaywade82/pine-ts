/** GENERATED FILE. Run `pnpm ta:inventory` after changing api-manifest/ta.v6.json. */
export type TaFunctionName =
  | "accdist" | "alma" | "aroon" | "atr" | "bb" | "bbw" | "barssince" | "bop" | "cci" | "cmo" | "cog"
  | "correlation" | "cross" | "crossover" | "crossunder" | "cum" | "dema" | "dev" | "dmi" | "ema" | "falling"
  | "highest" | "highestbars" | "hma" | "ichimoku" | "kc" | "kcw" | "linreg" | "lowest" | "lowestbars" | "macd"
  | "max" | "median" | "mfi" | "min" | "mom" | "percentile_linear_interpolation" | "percentile_nearest_rank"
  | "percentrank" | "pivothigh" | "pivotlow" | "range" | "rma" | "roc" | "rsi" | "sar" | "sma" | "stdev"
  | "stoch" | "supertrend" | "swma" | "tema" | "tr" | "trima" | "trix" | "tsi" | "valuewhen" | "variance"
  | "vwap" | "vwma" | "wma" | "wpr" | "obv" | "nvi" | "pvi" | "pvt" | "iii" | "relativeVolume" | "sum" | "avg"
  | "change" | "mode" | "rising";

export type ImplementedTaFunctionName =
  | "atr" | "cmo" | "change" | "crossover" | "crossunder" | "ema" | "highest" | "lowest" | "hma"
  | "mom" | "rma" | "roc" | "rsi" | "sma" | "stoch" | "swma" | "tr" | "vwma" | "wma" | "wpr";

export const taV6FunctionNames = [
  "accdist", "alma", "aroon", "atr", "bb", "bbw", "barssince", "bop", "cci", "cmo", "cog", "correlation",
  "cross", "crossover", "crossunder", "cum", "dema", "dev", "dmi", "ema", "falling", "highest", "highestbars",
  "hma", "ichimoku", "kc", "kcw", "linreg", "lowest", "lowestbars", "macd", "max", "median", "mfi", "min",
  "mom", "percentile_linear_interpolation", "percentile_nearest_rank", "percentrank", "pivothigh", "pivotlow", "range",
  "rma", "roc", "rsi", "sar", "sma", "stdev", "stoch", "supertrend", "swma", "tema", "tr", "trima", "trix",
  "tsi", "valuewhen", "variance", "vwap", "vwma", "wma", "wpr", "obv", "nvi", "pvi", "pvt", "iii", "relativeVolume",
  "sum", "avg", "change", "mode", "rising"
] as const;
