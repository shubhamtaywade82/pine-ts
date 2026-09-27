import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider } from "../src/index.js";

const bars: readonly Bar[] = [10, 9, 8, 9, 10, 11, 9, 8].map((close, index) => ({
  time: index + 1,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  isClosed: true,
}));

const provider: MarketDataProvider = {
  getHistoricalBars() {
    return Promise.resolve(bars);
  },
  async *streamBars() {
    await Promise.resolve();
    yield* [];
  },
  getSymbolInfo(symbol) {
    return Promise.resolve({ ticker: symbol, timezone: "UTC", type: "crypto" });
  },
};

const runtime = new PineRuntime({ provider, symbol: "DEMO", timeframe: "1m" });
const signals: string[] = [];

await runtime.run((context) => {
  const average = ta.sma(context.close, 3);

  if (ta.crossover(context.close, average).value) {
    signals.push(`BUY at close=${context.close.value}`);
  }
  if (ta.crossunder(context.close, average).value) {
    signals.push(`SELL at close=${context.close.value}`);
  }
});

console.log(signals.join("\n"));
