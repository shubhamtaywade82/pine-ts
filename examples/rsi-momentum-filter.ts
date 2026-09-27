import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider } from "../src/index.js";

const prices: readonly number[] = [
  100, 95, 90, 85, 80, 75, 72, 70, 71, 74, 78, 83, 89, 94, 98, 101, 103, 104, 102, 99, 96, 92, 88,
  85,
];

const bars: readonly Bar[] = prices.map((close, index) => ({
  time: index + 1,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 50,
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

const runtime = new PineRuntime({ provider, symbol: "BTCUSDT", timeframe: "1h" });

const OVERSOLD_THRESHOLD = 30;
const OVERBOUGHT_THRESHOLD = 70;
const signals: string[] = [];

await runtime.run((context) => {
  const momentumRsi = ta.rsi(context.close, 7);
  const trendEma = ta.ema(context.close, 5);

  const currentRsi = momentumRsi.value;
  const previousRsi = momentumRsi.at(1);
  const currentClose = context.close.value;
  const currentEma = trendEma.value;

  if (Number.isNaN(currentRsi) || previousRsi === undefined || Number.isNaN(currentEma)) {
    return;
  }

  // Detect RSI recovery crossing above oversold while price trades above the trend filter.
  const rsiCrossedOversold = previousRsi <= OVERSOLD_THRESHOLD && currentRsi > OVERSOLD_THRESHOLD;
  const isTrendBullish = currentClose > currentEma;

  if (rsiCrossedOversold && isTrendBullish) {
    signals.push(
      `[Bar ${context.bar.time}] BUY SIGNAL: Close=${currentClose} > EMA=${currentEma.toFixed(2)}, RSI recovered to ${currentRsi.toFixed(1)}`,
    );
  }

  // Detect RSI crossing below overbought threshold.
  const rsiCrossedOverbought =
    previousRsi >= OVERBOUGHT_THRESHOLD && currentRsi < OVERBOUGHT_THRESHOLD;

  if (rsiCrossedOverbought) {
    signals.push(
      `[Bar ${context.bar.time}] EXIT SIGNAL: Close=${currentClose}, RSI fell below ${OVERBOUGHT_THRESHOLD} to ${currentRsi.toFixed(1)}`,
    );
  }
});

console.log(`Evaluated ${bars.length} bars.`);
console.log(signals.length > 0 ? signals.join("\n") : "No signals generated.");
