/**
 * Pine Script v6 live/paper broker adapter boundary.
 *
 * The {@link StrategyEngine} (see `src/strategy/index.ts`) implements an
 * internal broker emulator for backtesting. For live or paper trading, the
 * host installs a {@link BrokerAdapter} that submits, cancels, and tracks
 * orders against a real (or simulated) broker API.
 *
 * The adapter contract mirrors the order lifecycle Pine v6 documents:
 *
 * - `submitOrder(order)`: place a market / limit / stop / stop-limit order
 *   with the broker. Returns the broker-assigned order id and current
 *   status. Rejects on invalid parameters, insufficient margin, or
 *   broker-side validation errors.
 * - `cancelOrder(orderId)`: request cancellation. Rejects if the order is
 *   already filled or the broker rejects the cancel.
 * - `getPosition(symbol)`: query the current open position for a symbol.
 * - `getBalance()`: query the account's quote-currency balance.
 * - `onOrderUpdate(callback)`: subscribe to order updates — fills, partial
 *   fills, rejections, cancellations. The adapter emits an `OrderUpdate`
 *   for every state change.
 *
 * Concrete adapters:
 * - {@link PaperBrokerAdapter}: an in-memory broker that simulates fills
 *   against the bar OHLC (same intrabar path assumption as the engine's
 *   emulator). Used for paper trading without external dependencies.
 * - {@link BinanceBrokerAdapter}: scaffold that wires to a Binance trading
 *   surface. The actual integration requires real API credentials and is
 *   left to downstream integrators; the typed adapter interface lives here
 *   for downstream wiring.
 */

import type { Bar } from "../core/types.js";
import type { Direction } from "../strategy/index.js";

/** Order type, mirroring Pine v6 / `strategy.*`. */
export type BrokerOrderType = "market" | "limit" | "stop" | "stop-limit";

/** Time-in-force — supported by most real brokers; mirrors FIX semantics. */
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTD";

/** Order status as reported by the broker. */
export type OrderStatus =
  | "new"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";

/** A request to submit an order to the broker. */
export interface OrderRequest {
  /** Client-side order id (Pine v6 strategy.entry/exit `id`). */
  readonly clientId: string;
  readonly symbol: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly orderType: BrokerOrderType;
  readonly limitPrice: number | undefined;
  readonly stopPrice: number | undefined;
  readonly timeInForce: TimeInForce;
  /** When true, the order reduces an existing position (exit, not entry). */
  readonly isExit: boolean;
  /** OCA group name — sibling orders are cancelled when one fills. */
  readonly ocaName: string | undefined;
}

/** A broker-assigned order result returned from `submitOrder`. */
export interface OrderResult {
  /** Broker-assigned order id. */
  readonly orderId: string;
  readonly clientId: string;
  readonly status: OrderStatus;
  /** Filled quantity so far (0 if not filled). */
  readonly filledQty: number;
  /** Average fill price (undefined if no fills yet). */
  readonly avgFillPrice: number | undefined;
  /** Broker-side rejection reason, if any. */
  readonly rejectReason: string | undefined;
}

/** An asynchronous update emitted by the broker on order state changes. */
export interface OrderUpdate {
  readonly orderId: string;
  readonly clientId: string;
  readonly status: OrderStatus;
  readonly filledQty: number;
  readonly avgFillPrice: number | undefined;
  readonly rejectReason: string | undefined;
  /** Symbol the order belongs to. */
  readonly symbol: string;
}

/** Current open position reported by the broker. */
export interface Position {
  readonly symbol: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly avgEntryPrice: number;
  readonly unrealisedPnl: number;
}

/** The broker adapter contract. */
export interface BrokerAdapter {
  /** Submits an order to the broker; resolves when the broker accepts it. */
  submitOrder(order: OrderRequest): Promise<OrderResult>;
  /** Requests cancellation; resolves when the broker accepts the cancel. */
  cancelOrder(orderId: string): Promise<void>;
  /** Queries the current open position for a symbol. */
  getPosition(symbol: string): Promise<Position | undefined>;
  /** Queries the account's quote-currency balance. */
  getBalance(): Promise<number>;
  /** Subscribes to order updates; returns an unsubscribe function. */
  onOrderUpdate(callback: (update: OrderUpdate) => void): () => void;
  /** Optional: advance the paper-broker's bar clock (no-op for live brokers). */
  processBar?(bar: Bar): void;
  /** Releases any held resources (websocket streams, etc.). */
  close?(): Promise<void>;
}

// ---------- PaperBrokerAdapter ----------

/**
 * In-memory paper broker. Simulates order fills against bar OHLC using the
 * same intrabar path assumption as the {@link StrategyEngine} emulator:
 *
 * - market: fills at next-bar open (or current-bar close with
 *   `process_orders_on_close`)
 * - limit: fills when bar low (long) / high (short) reaches the limit
 * - stop: fills when bar high (long) / low (short) reaches the stop
 * - stop-limit: trigger then limit within the same bar
 *
 * Paper trading keeps an internal balance and position book; the host
 * drives the broker via `processBar(bar)` between bar commits. The same
 * commission/slippage model as the emulator applies.
 */
export class PaperBrokerAdapter implements BrokerAdapter {
  private readonly orders = new Map<string, OrderResult>();
  private readonly pending = new Map<string, OrderRequest>();
  private readonly positions = new Map<string, Position>();
  private balance: number;
  private readonly updateCallbacks = new Set<(u: OrderUpdate) => void>();
  private orderCounter = 0;

  public constructor(
    private readonly options: {
      readonly initialBalance: number;
      readonly commissionType?: "percent" | "cash";
      readonly commissionValue?: number;
      readonly slippage?: number;
      readonly slippageUnit?: "points" | "percent";
      readonly processOrdersOnClose?: boolean;
    },
  ) {
    this.balance = options.initialBalance;
  }

  public submitOrder(order: OrderRequest): Promise<OrderResult> {
    return Promise.resolve(this.doSubmitOrder(order));
  }

  /** Synchronous submitOrder implementation; wrapped in a Promise for the adapter contract. */
  private doSubmitOrder(order: OrderRequest): OrderResult {
    this.orderCounter += 1;
    const orderId = `paper_${this.orderCounter}`;
    const result: OrderResult = {
      orderId,
      clientId: order.clientId,
      status: "new",
      filledQty: 0,
      avgFillPrice: undefined,
      rejectReason: undefined,
    };
    this.orders.set(orderId, result);
    this.pending.set(orderId, order);
    this.emit({
      orderId,
      clientId: order.clientId,
      status: "new",
      filledQty: 0,
      avgFillPrice: undefined,
      rejectReason: undefined,
      symbol: order.symbol,
    });
    return result;
  }

  public cancelOrder(orderId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.doCancelOrder(orderId);
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Synchronous cancelOrder implementation; wrapped in a Promise for the adapter contract. */
  private doCancelOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (order === undefined) return;
    if (order.status === "filled" || order.status === "partially_filled") {
      throw new Error(`Cannot cancel order ${orderId} in status ${order.status}`);
    }
    const pendingReq = this.pending.get(orderId);
    this.pending.delete(orderId);
    const canceled: OrderResult = { ...order, status: "canceled" };
    this.orders.set(orderId, canceled);
    this.emit({
      orderId,
      clientId: order.clientId,
      status: "canceled",
      filledQty: 0,
      avgFillPrice: undefined,
      rejectReason: undefined,
      symbol: pendingReq?.symbol ?? "",
    });
  }

  public getPosition(symbol: string): Promise<Position | undefined> {
    return Promise.resolve(this.positions.get(symbol));
  }

  public getBalance(): Promise<number> {
    return Promise.resolve(this.balance);
  }

  public onOrderUpdate(callback: (update: OrderUpdate) => void): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  /**
   * Drives the paper broker forward by one bar. Pending orders are checked
   * against the bar's OHLC and filled/cancelled as appropriate.
   */
  public processBar(bar: Bar): void {
    if (this.pending.size === 0) {
      return;
    }
    const fillPrice = this.options.processOrdersOnClose ? bar.close : bar.open;
    const remaining = new Map<string, OrderRequest>();
    for (const [orderId, order] of this.pending) {
      const fill = this.tryFill(order, bar, fillPrice);
      if (fill === undefined) {
        remaining.set(orderId, order);
        continue;
      }
      this.applyFill(orderId, order, fill);
    }
    this.pending.clear();
    for (const [id, req] of remaining) this.pending.set(id, req);
  }

  /** Determines whether an order fills on this bar and at what price. */
  private tryFill(order: OrderRequest, bar: Bar, marketFillPrice: number): number | undefined {
    switch (order.orderType) {
      case "market":
        return marketFillPrice;
      case "limit":
        return this.tryFillLimit(order, bar);
      case "stop":
        return this.tryFillStop(order, bar);
      case "stop-limit":
        return this.tryFillStopLimit(order, bar);
      default:
        return undefined;
    }
  }

  /** Limit-order fill check against bar OHLC. */
  private tryFillLimit(order: OrderRequest, bar: Bar): number | undefined {
    const limit = order.limitPrice;
    if (limit === undefined) return undefined;
    if (order.direction === "long") return bar.low <= limit ? limit : undefined;
    return bar.high >= limit ? limit : undefined;
  }

  /** Stop-order fill check against bar OHLC. */
  private tryFillStop(order: OrderRequest, bar: Bar): number | undefined {
    const stop = order.stopPrice;
    if (stop === undefined) return undefined;
    if (order.direction === "long") return bar.high >= stop ? stop : undefined;
    return bar.low <= stop ? stop : undefined;
  }

  /** Stop-limit fill check: trigger then limit within the same bar. */
  private tryFillStopLimit(order: OrderRequest, bar: Bar): number | undefined {
    const stop = order.stopPrice;
    const limit = order.limitPrice;
    if (stop === undefined || limit === undefined) return undefined;
    const triggered = order.direction === "long" ? bar.high >= stop : bar.low <= stop;
    if (!triggered) return undefined;
    const filled = order.direction === "long" ? bar.low <= limit : bar.high >= limit;
    return filled ? limit : undefined;
  }

  /** Applies a fill to the position book and balance, and emits an update. */
  private applyFill(orderId: string, order: OrderRequest, rawFill: number): void {
    const { fillPrice, commission } = this.applyCommission(rawFill, order.qty);
    const position = this.positions.get(order.symbol);
    if (position === undefined) {
      this.applyFreshEntryFill(orderId, order, fillPrice, commission);
      return;
    }
    if (position.direction !== order.direction) {
      this.applyReversalFill(orderId, order, fillPrice, commission, position);
      return;
    }
    this.applyPyramidingFill(orderId, order, fillPrice, commission, position);
  }

  /** Opens a fresh position; balance changes by realised P&L (= -commission). */
  private applyFreshEntryFill(
    orderId: string,
    order: OrderRequest,
    fillPrice: number,
    commission: number,
  ): void {
    this.positions.set(order.symbol, {
      symbol: order.symbol,
      direction: order.direction,
      qty: order.qty,
      avgEntryPrice: fillPrice,
      unrealisedPnl: 0,
    });
    this.balance += -commission;
    this.markFilled(orderId, order, fillPrice);
  }

  /** Reverses an opposite position; opens residual of the new direction. */
  private applyReversalFill(
    orderId: string,
    order: OrderRequest,
    fillPrice: number,
    commission: number,
    position: Position,
  ): void {
    const closedQty = Math.min(position.qty, order.qty);
    const grossPnl =
      position.direction === "long"
        ? (fillPrice - position.avgEntryPrice) * closedQty
        : (position.avgEntryPrice - fillPrice) * closedQty;
    const realisedPnl = grossPnl - commission;
    const residual = order.qty - closedQty;
    if (residual <= 0) {
      this.reduceOrDeletePosition(order.symbol, position, closedQty);
      this.balance += realisedPnl;
      this.markFilled(orderId, order, fillPrice);
      return;
    }
    this.reduceOrDeletePosition(order.symbol, position, closedQty);
    this.positions.set(order.symbol, {
      symbol: order.symbol,
      direction: order.direction,
      qty: residual,
      avgEntryPrice: fillPrice,
      unrealisedPnl: 0,
    });
    this.balance += realisedPnl;
    this.markFilled(orderId, order, fillPrice);
  }

  /** Increases the existing position with the new fill (pyramiding). */
  private applyPyramidingFill(
    orderId: string,
    order: OrderRequest,
    fillPrice: number,
    commission: number,
    position: Position,
  ): void {
    const newTotalQty = position.qty + order.qty;
    const newAvg =
      (position.avgEntryPrice * position.qty + fillPrice * order.qty) / newTotalQty;
    this.positions.set(order.symbol, {
      symbol: order.symbol,
      direction: position.direction,
      qty: newTotalQty,
      avgEntryPrice: newAvg,
      unrealisedPnl: 0,
    });
    this.balance -= commission;
    this.markFilled(orderId, order, fillPrice);
  }

  /** Reduces a position by `closedQty`; deletes it if the qty reaches 0. */
  private reduceOrDeletePosition(symbol: string, position: Position, closedQty: number): void {
    const remaining = position.qty - closedQty;
    if (remaining > 0) {
      this.positions.set(symbol, { ...position, qty: remaining });
    } else {
      this.positions.delete(symbol);
    }
  }

  /** Marks an order as filled and emits an update. */
  private markFilled(orderId: string, order: OrderRequest, fillPrice: number): void {
    const result: OrderResult = {
      orderId,
      clientId: order.clientId,
      status: "filled",
      filledQty: order.qty,
      avgFillPrice: fillPrice,
      rejectReason: undefined,
    };
    this.orders.set(orderId, result);
    this.emit({
      orderId,
      clientId: order.clientId,
      status: "filled",
      filledQty: order.qty,
      avgFillPrice: fillPrice,
      rejectReason: undefined,
      symbol: order.symbol,
    });
    // OCA: cancel sibling orders with the same oca_name (excluding the just-filled order itself).
    if (order.ocaName !== undefined) {
      for (const [id, req] of this.pending) {
        if (id !== orderId && req.ocaName === order.ocaName) {
          this.pending.delete(id);
          const canceled = this.orders.get(id);
          if (canceled !== undefined) {
            this.orders.set(id, { ...canceled, status: "canceled" });
            this.emit({
              orderId: id,
              clientId: canceled.clientId,
              status: "canceled",
              filledQty: 0,
              avgFillPrice: undefined,
              rejectReason: undefined,
              symbol: req.symbol,
            });
          }
        }
      }
    }
  }

  /** Computes the post-commission, post-slippage fill price and commission. */
  private applyCommission(price: number, qty: number): { fillPrice: number; commission: number } {
    const slippage = this.options.slippage ?? 0;
    const slippageUnit = this.options.slippageUnit ?? "points";
    const filled = slippageUnit === "points" ? price + slippage : price * (1 + slippage / 100);
    const commissionType = this.options.commissionType ?? "percent";
    const commissionValue = this.options.commissionValue ?? 0;
    const commission =
      commissionType === "percent"
        ? (filled * qty * commissionValue) / 100
        : commissionValue;
    return { fillPrice: filled, commission };
  }

  /** Emits an update to every subscriber. */
  private emit(update: OrderUpdate): void {
    for (const cb of this.updateCallbacks) cb(update);
  }
}

// ---------- BinanceBrokerAdapter scaffold ----------

/** Binance-side order status, used in both submit-order responses and order updates. */
export type BinanceOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED";

/** Typed scaffold for a Binance live-trading broker adapter. The actual
 * integration with `@nemesis-oss/binance-sdk`'s trading surface requires
 * real API credentials and is left to downstream integrators; this module
 * defines the contract surface so a downstream `BinanceBrokerAdapter`
 * implementation can be wired up cleanly.
 *
 * Usage (downstream):
 *
 * ```ts
 * import { BinanceClient } from "@nemesis-oss/binance-sdk";
 * import { BinanceBrokerAdapter } from "your-broker-package";
 *
 * const client = new BinanceClient({ ... });
 * const adapter = new BinanceBrokerAdapter({ trading: client.spot.trading });
 * await strategyEngine.setBrokerAdapter(adapter);
 * ```
 *
 * The scaffold's `BinanceTradingSurface` interface is the minimal shape a
 * downstream adapter consumes — extend it to match the SDK's trading
 * surface and implement `submitOrder`/`cancelOrder`/`getPosition`/
 * `getBalance`/`onOrderUpdate` against the SDK's REST + websocket streams.
 */
export interface BinanceTradingSurface {
  /** Submits a new order. Returns the broker-assigned order id and status. */
  newOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
    quantity: number;
    price: number | undefined;
    stopPrice: number | undefined;
    timeInForce: "GTC" | "IOC" | "FOK";
    clientOrderId: string;
  }): Promise<{
    orderId: string;
    status: BinanceOrderStatus;
    executedQty: number;
    avgPrice: number | undefined;
    rejectReason: string | undefined;
  }>;
  /** Cancels an existing order. */
  cancelOrder(params: { symbol: string; orderId: string }): Promise<void>;
  /** Queries the current position for a symbol. */
  getPosition(symbol: string): Promise<{
    symbol: string;
    side: "LONG" | "SHORT";
    qty: number;
    avgEntryPrice: number;
    unrealisedPnl: number;
  } | undefined>;
  /** Queries the account's quote-currency balance. */
  getBalance(): Promise<number>;
  /** Subscribes to order-update events (websocket). */
  onOrderUpdate(
    callback: (event: {
      orderId: string;
      clientOrderId: string;
      status: BinanceOrderStatus;
      executedQty: number;
      avgPrice: number | undefined;
      rejectReason: string | undefined;
      symbol: string;
    }) => void,
  ): () => void;
}

/**
 * Scaffold for a Binance live-trading broker adapter. Downstream
 * integrators implement the methods against the SDK's trading surface
 * (which must structurally extend `BinanceTradingSurface`).
 */
export class BinanceBrokerAdapter implements BrokerAdapter {
  public constructor(
    private readonly trading: BinanceTradingSurface,
    private readonly options: { readonly symbol: string },
  ) {}

  public async submitOrder(order: OrderRequest): Promise<OrderResult> {
    const result = await this.trading.newOrder({
      symbol: order.symbol,
      side: order.direction === "long" ? "BUY" : "SELL",
      type: binanceOrderTypeFromBroker(order.orderType),
      quantity: order.qty,
      price: order.limitPrice,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce === "GTD" ? "GTC" : order.timeInForce,
      clientOrderId: order.clientId,
    });
    return {
      orderId: result.orderId,
      clientId: order.clientId,
      status: binanceStatusToBroker(result.status),
      filledQty: result.executedQty,
      avgFillPrice: result.avgPrice,
      rejectReason: result.rejectReason,
    };
  }

  public async cancelOrder(orderId: string): Promise<void> {
    await this.trading.cancelOrder({ symbol: this.options.symbol, orderId });
  }

  public async getPosition(symbol: string): Promise<Position | undefined> {
    const p = await this.trading.getPosition(symbol);
    if (p === undefined) return undefined;
    return {
      symbol: p.symbol,
      direction: p.side === "LONG" ? "long" : "short",
      qty: p.qty,
      avgEntryPrice: p.avgEntryPrice,
      unrealisedPnl: p.unrealisedPnl,
    };
  }

  public async getBalance(): Promise<number> {
    return this.trading.getBalance();
  }

  public onOrderUpdate(callback: (update: OrderUpdate) => void): () => void {
    return this.trading.onOrderUpdate((e) => {
      callback({
        orderId: e.orderId,
        clientId: e.clientOrderId,
        status: binanceStatusToBroker(e.status),
        filledQty: e.executedQty,
        avgFillPrice: e.avgPrice,
        rejectReason: e.rejectReason,
        symbol: e.symbol,
      });
    });
  }
}

/** Maps a broker-side order type to the Binance REST order type. */
const binanceOrderTypeFromBroker = (
  type: BrokerOrderType,
): "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" => {
  switch (type) {
    case "market":
      return "MARKET";
    case "limit":
      return "LIMIT";
    case "stop":
      return "STOP";
    case "stop-limit":
      return "STOP_LIMIT";
    default:
      return "MARKET";
  }
};

/** Maps a Binance order status (REST or websocket) to the broker-side status. */
const binanceStatusToBroker = (status: BinanceOrderStatus): OrderStatus => {
  switch (status) {
    case "FILLED":
      return "filled";
    case "PARTIALLY_FILLED":
      return "partially_filled";
    case "CANCELED":
      return "canceled";
    case "REJECTED":
      return "rejected";
    case "NEW":
    default:
      return "new";
  }
};
