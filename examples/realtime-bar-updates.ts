import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider } from "../src/index.js";

const updates: readonly Bar[] = [
  { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 5, isClosed: false },
  { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 8, isClosed: false },
  { time: 1, open: 100, high: 103, low: 99, close: 102, volume: 13, isClosed: true },
  { time: 2, open: 102, high: 104, low: 101, close: 103, volume: 7, isClosed: true },
];

const provider: MarketDataProvider = {
  getHistoricalBars() {
    return Promise.resolve([]);
  },
  async *streamBars() {
    await Promise.resolve();
    yield* updates;
  },
  getSymbolInfo(symbol) {
    return Promise.resolve({ ticker: symbol, timezone: "UTC", type: "crypto" });
  },
};

const runtime = new PineRuntime({ provider, symbol: "DEMO", timeframe: "1m" });

await runtime.runRealtime((context) => {
  const average = ta.sma(context.close, 2).value;
  const averageText = Number.isNaN(average) ? "na" : average.toFixed(2);
  console.log(
    `time=${context.bar.time} close=${context.close.value} sma(2)=${averageText} ` +
    `new=${context.barstate.isNew} confirmed=${context.barstate.isConfirmed}`,
  );
});
