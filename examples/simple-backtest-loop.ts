import { PineRuntime, ta } from "../src/index.js";
import type { Bar, MarketDataProvider } from "../src/index.js";

interface Trade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly profit: number;
}

interface Position {
  readonly entryTime: number;
  readonly entryPrice: number;
}

const bars: readonly Bar[] = [
  100, 99, 98, 97, 96, 95, 96, 98, 102, 107, 114, 116, 112, 106, 100, 98, 105, 112, 118, 120,
].map((close, index) => ({
  time: index + 1,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
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

const INITIAL_CAPITAL = 10_000;
let cash = INITIAL_CAPITAL;
let position: Position | null = null;
const trades: Trade[] = [];

const closePosition = (exitTime: number, exitPrice: number): void => {
  if (position === null) return;
  const profit = exitPrice - position.entryPrice;
  cash += exitPrice;
  trades.push({
    entryTime: position.entryTime,
    exitTime,
    entryPrice: position.entryPrice,
    exitPrice,
    profit,
  });
  position = null;
};

const openPosition = (entryTime: number, entryPrice: number): void => {
  if (cash < entryPrice) return;
  cash -= entryPrice;
  position = { entryTime, entryPrice };
};

const runtime = new PineRuntime({ provider, symbol: "DEMO", timeframe: "1m" });

await runtime.run((context) => {
  const fastMa = ta.sma(context.close, 3);
  const slowMa = ta.sma(context.close, 7);

  const shouldBuy = ta.crossover(fastMa, slowMa).value;
  const shouldSell = ta.crossunder(fastMa, slowMa).value;
  const currentClose = context.close.value;

  if (shouldBuy && position === null) {
    openPosition(context.bar.time, currentClose);
  } else if (shouldSell && position !== null) {
    closePosition(context.bar.time, currentClose);
  }
});

// Liquidate remaining open position at the close of the simulation period.
const lastBar = bars.at(-1);
if (position !== null && lastBar !== undefined) {
  closePosition(lastBar.time, lastBar.close);
}

const winningTrades = trades.filter((trade) => trade.profit > 0);
const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
const totalProfit = cash - INITIAL_CAPITAL;

console.log("=== Backtest Performance Summary ===");
console.log(`Initial Capital : $${INITIAL_CAPITAL.toFixed(2)}`);
console.log(`Final Balance   : $${cash.toFixed(2)}`);
console.log(`Net Profit      : $${totalProfit.toFixed(2)}`);
console.log(`Total Trades    : ${trades.length}`);
console.log(`Win Rate        : ${winRate.toFixed(1)}%`);
console.log("\nExecuted Trades:");
for (const trade of trades) {
  const sign = trade.profit >= 0 ? "+" : "";
  console.log(
    `  Bar ${trade.entryTime} -> ${trade.exitTime} | Entry: ${trade.entryPrice.toFixed(2)} Exit: ${trade.exitPrice.toFixed(2)} | PnL: ${sign}${trade.profit.toFixed(2)}`,
  );
}
