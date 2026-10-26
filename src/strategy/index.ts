/**
 * Pine Script v6 `strategy.*` namespace — order placement, position tracking,
 * and broker-emulated backtesting.
 *
 * A `StrategyEngine` is owned by the runtime and shared with the script via
 * `ctx.strategy`. The engine implements:
 *
 * - Order placement: `entry`, `order`, `exit`, `close`, `close_all`, `cancel`,
 *   `cancel_all`, plus `risk.*` overrides.
 * - Broker emulator: orders fill on the next bar's open by default
 *   (`process_orders_on_close` moves fills to the close of the entry bar).
 *   Entry stop/limit orders are checked against the bar's high/low range.
 *   `strategy.exit` brackets follow Pine's intrabar path (open→high→low→close
 *   when the open is closer to the high, else open→low→high→close), fill a
 *   gapped-through level at the open, and cancel their sibling leg on fill.
 * - Pyramiding: the strategy declaration's `pyramiding` limit caps the number
 *   of open entry orders per direction.
 * - OCA groups: a `oca_name` on `strategy.exit` cancels sibling orders when
 *   one fills.
 * - Commissions/slippage: `commission_type` (`percent`/`cash`), `commission_value`,
 *   `slippage` units (`points`/`percent`).
 *
 * Position state variables (`strategy.position_size`, `position_avg_price`,
 * `equity`, `netprofit`, `grossprofit`, `grossloss`, `drawdown`, `max_drawdown`,
 * `closedtrades.*`, `opentrades.*`) are exposed as getters on the engine so
 * the script can read them through `ctx.strategy.position_size` etc.
 */

import { getCurrentSession } from "../core/execution-context.js";
import type { Bar } from "../core/types.js";
import type { BrokerAdapter, OrderRequest } from "../broker/index.js";
import { resolveBracketLevels, type BracketLevels, type ExitBracket } from "./bracket.js";
import { BrokerOrderRouter, BrokerOperationError } from "./broker-router.js";

export { BrokerOperationError };

/** Pine v6 trade direction. */
export type Direction = "long" | "short";

/** Order type. */
export type OrderType = "market" | "limit" | "stop" | "stop-limit";

/** Commission model. */
export type CommissionType = "percent" | "cash";

/** Slippage model. */
export type SlippageUnit = "points" | "percent";

/** Strategy declaration options (matches Pine v6 `strategy()` declaration). */
export interface StrategyDeclaration {
  readonly title: string;
  readonly overlay?: boolean;
  readonly pyramiding?: number;
  readonly calc_on_every_tick?: boolean;
  readonly process_orders_on_close?: boolean;
  readonly initial_capital?: number;
  readonly default_qty_type?: "cash" | "fixed" | "percent_of_equity";
  readonly default_qty_value?: number;
  readonly commission_type?: CommissionType;
  readonly commission_value?: number;
  readonly slippage?: number;
  readonly slippage_unit?: SlippageUnit;
  readonly margin_long?: number;
  readonly margin_short?: number;
  readonly currency?: string;
  readonly max_boxes_count?: number;
  readonly max_lines_count?: number;
  readonly max_labels_count?: number;
}

/** A pending order created by `strategy.entry`/`exit`/`order`. */
export interface PendingOrder {
  readonly id: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly orderType: OrderType;
  readonly limitPrice: number | undefined;
  readonly stopPrice: number | undefined;
  readonly ocaName: string | undefined;
  /** Trade id this order belongs to (for entry/exit pairing). */
  readonly tradeId: string | undefined;
  /** When true, the order reduces the current position (close/exit). */
  readonly isExit: boolean;
  /** When set, an entry order with this id reverses the existing position. */
  readonly isEntry: boolean;
}

/** A trade that has been filled and is now open. */
export interface OpenTrade {
  readonly id: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly entryPrice: number;
  readonly entryTime: number;
  /** Commission paid at entry. Deducted from closed.profit on exit. */
  readonly entryCommission: number;
  /** Maximum favorable excursion (run-up) during the trade in account currency. */
  readonly runUp: number;
  /** Maximum adverse excursion (drawdown) during the trade in account currency. */
  readonly drawDown: number;
}

/** A trade that has been closed. */
export interface ClosedTrade {
  readonly id: string;
  readonly direction: Direction;
  readonly qty: number;
  readonly entryPrice: number;
  readonly entryTime: number;
  readonly exitPrice: number;
  readonly exitTime: number;
  /** Signed profit/loss in account currency. */
  readonly profit: number;
  /** Maximum favorable excursion (run-up) during the trade in account currency. */
  readonly runUp: number;
  /** Maximum adverse excursion (drawdown) during the trade in account currency. */
  readonly drawDown: number;
}

/**
 * The runtime-owned strategy engine. One instance per `PineRuntime`; the
 * script reaches it via `ctx.strategy` (the runtime injects the engine into
 * the context). The broker emulator lives inside this class; paper and live
 * broker adapters are separate interfaces (see `BrokerAdapter`).
 */
export class StrategyEngine {
  private declaration: StrategyDeclaration = {
    title: "Strategy",
    pyramiding: 1,
    initial_capital: 1000,
    default_qty_type: "fixed",
    default_qty_value: 1,
    commission_type: "percent",
    commission_value: 0,
    slippage: 0,
    slippage_unit: "points",
    margin_long: 100,
    margin_short: 100,
  };

  private pendingOrders: PendingOrder[] = [];
  private pendingExits: ExitBracket[] = [];
  private mintick: number | undefined;
  private openTrades: OpenTrade[] = [];
  private closedTrades: ClosedTrade[] = [];
  private cash = 1000;
  private lastBar?: Bar;
  /**
   * Optional live/paper broker adapter. When set, the engine forwards
   * every entry/exit/close to the adapter (which submits to a real or
   * paper broker) and queries position/balance from the adapter. The
   * built-in broker emulator is bypassed.
   */
  private brokerAdapter: BrokerAdapter | undefined;
  private brokerRouter: BrokerOrderRouter | undefined;
  private readonly brokerErrorListeners = new Set<(error: BrokerOperationError) => void>();
  private unreportedBrokerErrors: BrokerOperationError[] = [];

  /** Sets the strategy declaration; called by the runtime before run. */
  public configure(declaration: StrategyDeclaration): void {
    this.declaration = { ...this.declaration, ...declaration };
    this.cash = declaration.initial_capital ?? this.cash;
  }

  /**
   * Installs (or removes) the live/paper broker adapter. When set, the
   * engine's order calls are routed to the adapter (see
   * {@link BrokerOrderRouter}) and the built-in emulator is bypassed. Calls
   * are queued and run in order; await {@link whenBrokerIdle} to observe
   * their outcome. Replacing the adapter discards the previous adapter's
   * order tracking.
   */
  public setBrokerAdapter(adapter: BrokerAdapter | undefined): void {
    this.brokerRouter?.dispose();
    this.brokerAdapter = adapter;
    this.brokerRouter =
      adapter === undefined
        ? undefined
        : new BrokerOrderRouter(adapter, {
            symbol: () => this.symbolForBroker(),
            mintick: () => this.mintick,
            onError: (error) => this.reportBrokerError(error),
          });
  }

  /** Returns the currently-installed broker adapter (or undefined). */
  public getBrokerAdapter(): BrokerAdapter | undefined {
    return this.brokerAdapter;
  }

  /**
   * Subscribes to broker failures: rejected orders, failed submits/cancels,
   * and exits refused because the broker position does not match the entry.
   */
  public onBrokerError(listener: (error: BrokerOperationError) => void): () => void {
    this.brokerErrorListeners.add(listener);
    return () => this.brokerErrorListeners.delete(listener);
  }

  /**
   * Resolves once every queued broker call has settled. Rejects with the
   * broker errors that occurred while no {@link onBrokerError} listener was
   * installed, so failures are never silently dropped.
   */
  public async whenBrokerIdle(): Promise<void> {
    await this.brokerRouter?.idle();
    const errors = this.unreportedBrokerErrors;
    this.unreportedBrokerErrors = [];
    if (errors.length === 1) throw errors[0]!;
    if (errors.length > 1)
      throw new AggregateError(errors, `${errors.length} broker operations failed`);
  }

  private reportBrokerError(error: BrokerOperationError): void {
    if (this.brokerErrorListeners.size === 0) {
      this.unreportedBrokerErrors.push(error);
      return;
    }
    for (const listener of this.brokerErrorListeners) listener(error);
  }

  /** Returns the strategy declaration. */
  public get config(): StrategyDeclaration {
    return this.declaration;
  }

  // ---------- order placement ----------

  /**
   * `strategy.entry(id, direction, qty?, limit?, stop?, oca_name?)`. Places
   * an entry order. When the position is opposite, the entry reverses it.
   *
   * When a {@link BrokerAdapter} is installed, the order is forwarded to
   * the adapter (which submits to a real or paper broker) instead of the
   * built-in emulator's pending queue.
   */
  public entry(
    id: string,
    direction: Direction,
    qty: number,
    options: { limit?: number; stop?: number; ocaName?: string } = {},
  ): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.submitEntry(this.brokerEntryRequest(id, direction, qty, options));
      return;
    }
    this.pendingOrders.push(this.makeOrder(id, direction, qty, options, false, true, id));
  }

  /**
   * `strategy.order(id, direction, qty?, limit?, stop?)`. Places an order that
   * does NOT reverse the position; it adds to the current direction (or opens
   * a new one).
   */
  public order(
    id: string,
    direction: Direction,
    qty: number,
    options: { limit?: number; stop?: number } = {},
  ): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.submitEntry(this.brokerEntryRequest(id, direction, qty, options));
      return;
    }
    this.pendingOrders.push(this.makeOrder(id, direction, qty, options, false, false, id));
  }

  /** Sets `syminfo.mintick`, the tick size `strategy.exit` `profit`/`loss` are measured in. */
  public setMintick(mintick: number): void {
    if (!Number.isFinite(mintick) || mintick <= 0) {
      throw new RangeError(`mintick must be a positive finite number; got ${mintick}`);
    }
    this.mintick = mintick;
  }

  /**
   * `strategy.exit(id, from_entry, qty?, limit?, stop?, profit?, loss?)`.
   * Places a take-profit/stop-loss bracket for the entry `from_entry`:
   *
   * - `limit`/`stop` are prices; `profit`/`loss` are ticks from the entry
   *   price (requires {@link setMintick}). When both forms are given for one
   *   leg, the level reached first is used.
   * - The two legs form an `oca.reduce` pair: the first fill cancels the other.
   * - `qty` omitted (or na) exits the whole trade.
   * - The bracket waits while the entry is pending, and is dropped once the
   *   trade closes or the pending entry disappears.
   * - Calling again with the same `id` and `from_entry` replaces the bracket.
   */
  public exit(
    id: string,
    fromId: string,
    qty?: number,
    options: {
      limit?: number;
      stop?: number;
      profit?: number;
      loss?: number;
      ocaName?: string;
    } = {},
  ): void {
    const bracket = this.makeExitBracket(id, fromId, qty, options);
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.exit(bracket);
      return;
    }
    this.pendingExits = [
      ...this.pendingExits.filter((e) => !(e.id === id && e.tradeId === fromId)),
      bracket,
    ];
  }

  private makeExitBracket(
    id: string,
    tradeId: string,
    qty: number | undefined,
    options: { limit?: number; stop?: number; profit?: number; loss?: number; ocaName?: string },
  ): ExitBracket {
    // na (NaN) arguments mean "not specified", as in Pine.
    const given = (value: number | undefined): number | undefined =>
      value === undefined || Number.isNaN(value) ? undefined : value;
    const limit = given(options.limit);
    const stop = given(options.stop);
    const profitTicks = given(options.profit);
    const lossTicks = given(options.loss);
    const exitQty = given(qty);
    if (exitQty !== undefined && (!Number.isFinite(exitQty) || exitQty <= 0)) {
      throw new RangeError(`strategy.exit qty must be a positive number; got ${exitQty}`);
    }
    if ([limit, stop, profitTicks, lossTicks].every((v) => v === undefined)) {
      throw new Error(`strategy.exit("${id}") needs at least one of limit, stop, profit or loss`);
    }
    if ((profitTicks !== undefined || lossTicks !== undefined) && this.mintick === undefined) {
      throw new Error(
        `strategy.exit("${id}") profit/loss are in ticks; call setMintick() with syminfo.mintick first`,
      );
    }
    return {
      id,
      tradeId,
      qty: exitQty,
      limit,
      stop,
      profitTicks,
      lossTicks,
      ocaName: options.ocaName,
    };
  }

  /**
   * `strategy.close(id, qty?)`. Closes the trade identified by `id` (an
   * entry id) at the market on the next bar's open.
   */
  public close(id: string, qty?: number): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.close(id, qty);
      return;
    }
    const trade = this.openTrades.find((t) => t.id === id);
    if (trade === undefined) return;
    this.pendingOrders.push(
      this.makeOrder(
        `close_${id}`,
        trade.direction === "long" ? "short" : "long",
        qty ?? trade.qty,
        {},
        true,
        false,
        id,
      ),
    );
  }

  /** `strategy.close_all()`. Closes every open trade at the next bar's open. */
  public close_all(): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.closeAll();
      return;
    }
    for (const trade of this.openTrades) {
      this.close(trade.id);
    }
  }

  /** `strategy.cancel(id)`. Cancels the order identified by `id`. */
  public cancel(id: string): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.cancel(id);
      return;
    }
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
    this.pendingExits = this.pendingExits.filter((e) => e.id !== id);
  }

  /** `strategy.cancel_all()`. Cancels every pending order. */
  public cancel_all(): void {
    if (this.brokerRouter !== undefined) {
      this.brokerRouter.cancelAll();
      return;
    }
    this.pendingOrders = [];
    this.pendingExits = [];
  }

  /** Returns the symbol the strategy is trading (from the runtime's options). */
  private symbolForBroker(): string {
    // The runtime injects the symbol via `configure({ symbol })`; fall back
    // to "UNKNOWN" when not set.
    return this.declaration.title ?? "UNKNOWN";
  }

  private brokerEntryRequest(
    id: string,
    direction: Direction,
    qty: number,
    options: { limit?: number; stop?: number; ocaName?: string },
  ): OrderRequest {
    return {
      clientId: id,
      symbol: this.symbolForBroker(),
      direction,
      qty,
      orderType: this.inferOrderType(options),
      limitPrice: options.limit,
      stopPrice: options.stop,
      timeInForce: "GTC",
      isExit: false,
      ocaName: options.ocaName,
    };
  }

  /** Infers the broker order type from limit/stop presence. */
  private inferOrderType(options: {
    limit?: number;
    stop?: number;
  }): "market" | "limit" | "stop" | "stop-limit" {
    const limit = options.limit;
    const stop = options.stop;
    if (limit !== undefined && stop !== undefined) return "stop-limit";
    if (limit !== undefined) return "limit";
    if (stop !== undefined) return "stop";
    return "market";
  }

  /** Builds a PendingOrder, inferring the order type from limit/stop presence. */
  private makeOrder(
    id: string,
    direction: Direction,
    qty: number,
    options: { limit?: number; stop?: number; ocaName?: string },
    isExit: boolean,
    isEntry: boolean,
    tradeId: string,
  ): PendingOrder {
    const limit = options.limit;
    const stop = options.stop;
    let orderType: OrderType = "market";
    if (limit !== undefined && stop !== undefined) orderType = "stop-limit";
    else if (limit !== undefined) orderType = "limit";
    else if (stop !== undefined) orderType = "stop";
    return {
      id,
      direction,
      qty,
      orderType,
      limitPrice: limit,
      stopPrice: stop,
      ocaName: options.ocaName,
      tradeId,
      isExit,
      isEntry,
    };
  }

  // ---------- broker emulator: bar close / bar open hook ----------

  /**
   * Called by the runtime after each bar commits. Processes pending orders
   * against the bar's OHLC. Default behavior: market orders fill on the
   * *next* bar's open; limit/stop orders check against the bar's high/low
   * range. With `process_orders_on_close`, market orders fill on the current
   * bar's close.
   */
  public processBar(bar: Bar): void {
    const onClose = this.declaration.process_orders_on_close === true;
    const fillPrice = onClose ? bar.close : bar.open;
    const remaining: PendingOrder[] = [];
    // Raw fill price of each entry filled on this bar: its exits may only
    // react to the part of the intrabar path after that fill.
    const enteredAt = new Map<string, number>();
    for (const order of this.pendingOrders) {
      const fill = this.tryFill(order, bar, fillPrice);
      if (fill === undefined) {
        remaining.push(order);
      } else {
        this.applyFill(order, fill, bar.time);
        if (!order.isExit) enteredAt.set(order.id, fill);
      }
    }
    this.pendingOrders = remaining;
    this.processExits(bar, enteredAt, onClose);
    this.updateTradeExcursions(bar);
    this.lastBar = bar;
  }

  /** Updates maximum favorable and adverse excursions for all currently open trades. */
  private updateTradeExcursions(bar: Bar): void {
    for (let i = 0; i < this.openTrades.length; i++) {
      const trade = this.openTrades[i]!;
      const favPrice = trade.direction === "long" ? bar.high : bar.low;
      const advPrice = trade.direction === "long" ? bar.low : bar.high;
      const favDiff = trade.direction === "long" ? favPrice - trade.entryPrice : trade.entryPrice - favPrice;
      const advDiff = trade.direction === "long" ? trade.entryPrice - advPrice : advPrice - trade.entryPrice;
      const runUp = Math.max(trade.runUp, favDiff * trade.qty, 0);
      const drawDown = Math.max(trade.drawDown, advDiff * trade.qty, 0);
      this.openTrades[i] = { ...trade, runUp, drawDown };
    }
  }

  /** Fills `strategy.exit` brackets against the bar's assumed intrabar path. */
  private processExits(bar: Bar, enteredAt: ReadonlyMap<string, number>, onClose: boolean): void {
    for (const bracket of [...this.pendingExits]) {
      // An earlier fill this bar may already have cancelled it (oca / trade closed).
      if (this.pendingExits.includes(bracket)) this.processExit(bracket, bar, enteredAt, onClose);
    }
  }

  private processExit(
    bracket: ExitBracket,
    bar: Bar,
    enteredAt: ReadonlyMap<string, number>,
    onClose: boolean,
  ): void {
    const trade = this.openTrades.find((t) => t.id === bracket.tradeId);
    if (trade === undefined) {
      const entryPending = this.pendingOrders.some((o) => o.isEntry && o.id === bracket.tradeId);
      if (!entryPending) this.removeExit(bracket);
      return;
    }
    const entryFill = enteredAt.get(trade.id);
    // Filled on this bar's close: no price path remains on this bar.
    if (entryFill !== undefined && onClose) return;
    const path = intrabarPath(bar, entryFill);
    if (path === undefined) return;
    const levels = resolveBracketLevels(bracket, trade.direction, trade.entryPrice, this.mintick);
    const fill = firstLevelHit(path, trade.direction, levels);
    if (fill === undefined) return;
    this.removeExit(bracket);
    this.applyFill(
      {
        id: bracket.id,
        direction: trade.direction === "long" ? "short" : "long",
        qty: bracket.qty ?? trade.qty,
        orderType: fill.leg === "take-profit" ? "limit" : "stop",
        limitPrice: levels.takeProfit,
        stopPrice: levels.stopLoss,
        ocaName: bracket.ocaName,
        tradeId: trade.id,
        isExit: true,
        isEntry: false,
      },
      fill.price,
      bar.time,
    );
  }

  private removeExit(bracket: ExitBracket): void {
    this.pendingExits = this.pendingExits.filter((e) => e !== bracket);
  }

  /** A fully closed trade takes its exits with it (`from_entry` binds to that trade). */
  private dropExitsFor(tradeId: string): void {
    this.pendingExits = this.pendingExits.filter((e) => e.tradeId !== tradeId);
  }

  /** Apply a commission and slippage to a fill price/qty. */
  private applyCommission(price: number, qty: number): { fillPrice: number; commission: number } {
    const slippage = this.declaration.slippage ?? 0;
    const slippageUnit = this.declaration.slippage_unit ?? "points";
    const filled = slippageUnit === "points" ? price + slippage : price * (1 + slippage / 100);
    const commissionType = this.declaration.commission_type ?? "percent";
    const commissionValue = this.declaration.commission_value ?? 0;
    const commission =
      commissionType === "percent" ? (filled * qty * commissionValue) / 100 : commissionValue;
    return { fillPrice: filled, commission };
  }

  /** Determines whether an order fills on this bar and at what price. */
  private tryFill(order: PendingOrder, bar: Bar, marketFillPrice: number): number | undefined {
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

  /** Limit-order fill check. */
  private tryFillLimit(order: PendingOrder, bar: Bar): number | undefined {
    const limit = order.limitPrice;
    if (limit === undefined) return undefined;
    if (order.direction === "long") return bar.low <= limit ? limit : undefined;
    return bar.high >= limit ? limit : undefined;
  }

  /** Stop-order fill check. */
  private tryFillStop(order: PendingOrder, bar: Bar): number | undefined {
    const stop = order.stopPrice;
    if (stop === undefined) return undefined;
    if (order.direction === "long") return bar.high >= stop ? stop : undefined;
    return bar.low <= stop ? stop : undefined;
  }

  /** Stop-limit fill check: trigger then limit within the same bar. */
  private tryFillStopLimit(order: PendingOrder, bar: Bar): number | undefined {
    const stop = order.stopPrice;
    const limit = order.limitPrice;
    if (stop === undefined || limit === undefined) return undefined;
    const stopTriggered = order.direction === "long" ? bar.high >= stop : bar.low <= stop;
    if (!stopTriggered) return undefined;
    const limitFilled = order.direction === "long" ? bar.low <= limit : bar.high >= limit;
    return limitFilled ? limit : undefined;
  }

  /** Records a filled order as an open or closed trade and updates equity. */
  private applyFill(order: PendingOrder, rawFill: number, fillTime: number): void {
    const { fillPrice, commission } = this.applyCommission(rawFill, order.qty);
    if (order.isExit) {
      this.applyExitFill(order, fillPrice, commission, fillTime);
    } else if (this.openTrades.some((t) => t.direction !== order.direction)) {
      this.applyReverseFill(order, fillPrice, commission, fillTime);
    } else {
      this.applyEntryFill(order, fillPrice, fillTime, commission);
      // The entry commission is recorded on the OpenTrade and deducted from
      // the closed trade's profit when the position exits. No separate cash
      // hit here — that double-counts.
    }
  }

  /** Closes (part of) an open trade by tradeId, records the closed trade. */
  private applyExitFill(
    order: PendingOrder,
    fillPrice: number,
    commission: number,
    fillTime: number,
  ): void {
    const tradeIndex = this.openTrades.findIndex((t) => t.id === order.tradeId);
    if (tradeIndex === -1) return;
    const trade = this.openTrades[tradeIndex]!;
    const closedQty = Math.min(trade.qty, order.qty);
    const profit = this.computeProfit(
      trade.direction,
      trade.entryPrice,
      fillPrice,
      closedQty,
      commission + trade.entryCommission,
    );
    // Cash flow: only the realised P&L (gross - commission) hits cash.
    this.cash += profit;
    const favDiff = trade.direction === "long" ? fillPrice - trade.entryPrice : trade.entryPrice - fillPrice;
    const advDiff = trade.direction === "long" ? trade.entryPrice - fillPrice : fillPrice - trade.entryPrice;
    const exitRunUp = Math.max((trade.runUp * closedQty) / trade.qty, favDiff * closedQty, 0);
    const exitDrawDown = Math.max((trade.drawDown * closedQty) / trade.qty, advDiff * closedQty, 0);
    this.closedTrades.push({
      id: trade.id,
      direction: trade.direction,
      qty: closedQty,
      entryPrice: trade.entryPrice,
      entryTime: trade.entryTime,
      exitPrice: fillPrice,
      exitTime: fillTime,
      profit,
      runUp: exitRunUp,
      drawDown: exitDrawDown,
    });
    if (order.ocaName !== undefined) {
      this.pendingOrders = this.pendingOrders.filter((o) => o.ocaName !== order.ocaName);
      this.pendingExits = this.pendingExits.filter((e) => e.ocaName !== order.ocaName);
    }
    if (closedQty >= trade.qty) {
      this.openTrades.splice(tradeIndex, 1);
      this.dropExitsFor(trade.id);
    } else {
      const remainingQty = trade.qty - closedQty;
      const updated: OpenTrade = {
        ...trade,
        qty: remainingQty,
        runUp: (trade.runUp * remainingQty) / trade.qty,
        drawDown: (trade.drawDown * remainingQty) / trade.qty,
      };
      this.openTrades.splice(tradeIndex, 1, updated);
    }
  }

  /** Reverses an opposite-direction open trade and opens residual of the new direction. */
  private applyReverseFill(
    order: PendingOrder,
    fillPrice: number,
    commission: number,
    fillTime: number,
  ): void {
    const opposite = this.openTrades.find((t) => t.direction !== order.direction)!;
    const closedQty = Math.min(opposite.qty, order.qty);
    const profit = this.computeProfit(
      opposite.direction,
      opposite.entryPrice,
      fillPrice,
      closedQty,
      commission + opposite.entryCommission,
    );
    this.cash += profit;
    const favDiff = opposite.direction === "long" ? fillPrice - opposite.entryPrice : opposite.entryPrice - fillPrice;
    const advDiff = opposite.direction === "long" ? opposite.entryPrice - fillPrice : fillPrice - opposite.entryPrice;
    const exitRunUp = Math.max((opposite.runUp * closedQty) / opposite.qty, favDiff * closedQty, 0);
    const exitDrawDown = Math.max((opposite.drawDown * closedQty) / opposite.qty, advDiff * closedQty, 0);
    this.closedTrades.push({
      id: opposite.id,
      direction: opposite.direction,
      qty: closedQty,
      entryPrice: opposite.entryPrice,
      entryTime: opposite.entryTime,
      exitPrice: fillPrice,
      exitTime: fillTime,
      profit,
      runUp: exitRunUp,
      drawDown: exitDrawDown,
    });
    const remainingQty = opposite.qty - closedQty;
    if (remainingQty <= 0) {
      this.openTrades = this.openTrades.filter((t) => t !== opposite);
      this.dropExitsFor(opposite.id);
    }
    const residual = order.qty - closedQty;
    if (residual > 0) {
      // The residual entry commission is proportional to the residual qty.
      const residualEntryCommission = (commission * residual) / order.qty;
      this.openTrades.push({
        id: order.id,
        direction: order.direction,
        qty: residual,
        entryPrice: fillPrice,
        entryTime: fillTime,
        entryCommission: residualEntryCommission,
        runUp: 0,
        drawDown: 0,
      });
    }
  }

  /** Opens a fresh entry trade, subject to the pyramiding cap. */
  private applyEntryFill(
    order: PendingOrder,
    fillPrice: number,
    fillTime: number,
    commission: number,
  ): void {
    const sameDirection = this.openTrades.filter((t) => t.direction === order.direction);
    const pyramiding = this.declaration.pyramiding ?? 1;
    if (sameDirection.length >= pyramiding) return; // reject the fill — too many pyramid layers
    this.openTrades.push({
      id: order.id,
      direction: order.direction,
      qty: order.qty,
      entryPrice: fillPrice,
      entryTime: fillTime,
      entryCommission: commission,
      runUp: 0,
      drawDown: 0,
    });
  }

  /** Computes the signed P&L of a closed quantity, less commission. */
  private computeProfit(
    direction: Direction,
    entryPrice: number,
    exitPrice: number,
    qty: number,
    commission: number,
  ): number {
    const gross =
      direction === "long" ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;
    return gross - commission;
  }

  // ---------- state variables (strategy.* v6 variables) ----------

  /** `strategy.position_size`. Signed position (long+, short-). */
  public get position_size(): number {
    return this.openTrades.reduce((sum, t) => sum + (t.direction === "long" ? t.qty : -t.qty), 0);
  }

  /** `strategy.position_avg_price`. Average entry price of the open position. */
  public get position_avg_price(): number {
    const longs = this.openTrades.filter((t) => t.direction === "long");
    const shorts = this.openTrades.filter((t) => t.direction === "short");
    const totalLong = longs.reduce((s, t) => s + t.qty * t.entryPrice, 0);
    const totalShort = shorts.reduce((s, t) => s + t.qty * t.entryPrice, 0);
    const longQty = longs.reduce((s, t) => s + t.qty, 0);
    const shortQty = shorts.reduce((s, t) => s + t.qty, 0);
    const net = totalLong - totalShort;
    const netQty = longQty - shortQty;
    return netQty === 0 ? Number.NaN : net / Math.abs(netQty);
  }

  /** `strategy.equity`. Cash + mark-to-market position value. */
  public get equity(): number {
    if (this.lastBar === undefined) return this.cash;
    const unreal = this.openTrades.reduce((s, t) => {
      const mark =
        t.direction === "long"
          ? (this.lastBar!.close - t.entryPrice) * t.qty
          : (t.entryPrice - this.lastBar!.close) * t.qty;
      return s + mark;
    }, 0);
    return this.cash + unreal;
  }

  /** `strategy.netprofit`. Realised + unrealised P&L since start. */
  public get netprofit(): number {
    return this.equity - (this.declaration.initial_capital ?? 0);
  }

  /** `strategy.grossprofit`. Sum of profitable closed trades. */
  public get grossprofit(): number {
    return this.closedTrades.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0);
  }

  /** `strategy.grossloss`. Sum of unprofitable closed trades (negative). */
  public get grossloss(): number {
    return this.closedTrades.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0);
  }

  /** `strategy.max_drawdown`. Largest peak-to-trough equity decline. */
  public get max_drawdown(): number {
    let peak = this.declaration.initial_capital ?? 0;
    let maxDd = 0;
    for (const trade of this.closedTrades) {
      const realised = this.closedTrades
        .slice(0, this.closedTrades.indexOf(trade) + 1)
        .reduce((s, t) => s + t.profit, 0);
      const equity = (this.declaration.initial_capital ?? 0) + realised;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
    }
    return maxDd;
  }

  /** `strategy.drawdown`. Current equity drawdown from the peak. */
  public get drawdown(): number {
    const peak = Math.max(this.declaration.initial_capital ?? 0, this.equity);
    return Math.max(0, peak - this.equity);
  }

  /** `strategy.closedtrades`. Number of closed trades. */
  public get closedtrades_number(): number {
    return this.closedTrades.length;
  }

  /** `strategy.opentrades`. Number of currently-open trades. */
  public get opentrades_number(): number {
    return this.openTrades.length;
  }

  /** Current margin used by all open positions in account currency. */
  public get margin_used(): number {
    if (this.lastBar === undefined) return 0;
    const price = this.lastBar.close;
    const marginLong = (this.declaration.margin_long ?? 100) / 100;
    const marginShort = (this.declaration.margin_short ?? 100) / 100;
    return this.openTrades.reduce((sum, t) => {
      const rate = t.direction === "long" ? marginLong : marginShort;
      return sum + t.qty * price * rate;
    }, 0);
  }

  /** All closed trades (for `closedtrades.*` accessor functions). */
  public getClosedTrades(): readonly ClosedTrade[] {
    return this.closedTrades;
  }

  /** All open trades (for `opentrades.*` accessor functions). */
  public getOpenTrades(): readonly OpenTrade[] {
    return this.openTrades;
  }
}

// ---------- strategy.exit bracket helpers ----------

/**
 * The broker emulator's assumed intrabar path: open→high→low→close when the
 * open is closer to the high, otherwise open→low→high→close. When the entry
 * filled on this bar at `entryFill`, the path starts at that fill.
 */
const intrabarPath = (bar: Bar, entryFill: number | undefined): number[] | undefined => {
  const highFirst = bar.high - bar.open < bar.open - bar.low;
  const path = highFirst
    ? [bar.open, bar.high, bar.low, bar.close]
    : [bar.open, bar.low, bar.high, bar.close];
  if (entryFill === undefined) return path;
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index]!;
    const to = path[index + 1]!;
    if (entryFill >= Math.min(from, to) && entryFill <= Math.max(from, to)) {
      return [entryFill, ...path.slice(index + 1)];
    }
  }
  return undefined;
};

/**
 * Walks the path and returns the first bracket level reached. A level the
 * path already starts beyond (a gap at the open) fills at the starting price.
 */
const firstLevelHit = (
  path: readonly number[],
  direction: Direction,
  { takeProfit, stopLoss }: BracketLevels,
): { leg: "take-profit" | "stop-loss"; price: number } | undefined => {
  const sign = direction === "long" ? 1 : -1;
  const tpReached = (price: number): boolean =>
    takeProfit !== undefined && sign * (price - takeProfit) >= 0;
  const slReached = (price: number): boolean =>
    stopLoss !== undefined && sign * (price - stopLoss) <= 0;

  const start = path[0];
  if (start === undefined) return undefined;
  if (slReached(start)) return { leg: "stop-loss", price: start };
  if (tpReached(start)) return { leg: "take-profit", price: start };

  for (let index = 1; index < path.length; index += 1) {
    const to = path[index]!;
    const movingUp = to > path[index - 1]!;
    // Moving toward profit can only reach the take-profit, and vice versa.
    const towardProfit = direction === "long" ? movingUp : !movingUp;
    if (towardProfit && takeProfit !== undefined && tpReached(to)) {
      return { leg: "take-profit", price: takeProfit };
    }
    if (!towardProfit && stopLoss !== undefined && slReached(to)) {
      return { leg: "stop-loss", price: stopLoss };
    }
  }
  return undefined;
};

// ---------- module-level engine accessor ----------

let activeEngine: StrategyEngine | undefined;

/** Installs the active strategy engine for the current script invocation. */
export const setActiveStrategyEngine = (engine: StrategyEngine | undefined): void => {
  activeEngine = engine;
};

/** Returns the active strategy engine, or `undefined` when none is installed. */
export const getActiveStrategyEngine = (): StrategyEngine | undefined => activeEngine;

/**
 * Returns the active strategy engine. Throws if no script is running or the
 * script did not declare a strategy.
 */
export const requireStrategyEngine = (): StrategyEngine => {
  if (activeEngine === undefined) {
    throw new Error(
      "No active strategy engine; declare one via PineRuntime.options.strategy " +
        "or call this function inside a strategy() script.",
    );
  }
  return activeEngine;
};

// ---------- public function surface ----------

/**
 * `strategy.entry(id, direction, qty?, ...)`. See {@link StrategyEngine.entry}.
 */
export const entry = (
  id: string,
  direction: Direction,
  qty: number,
  options: { limit?: number; stop?: number; ocaName?: string } = {},
): void => {
  requireStrategyEngine().entry(id, direction, qty, options);
};

/**
 * `strategy.order(id, direction, qty?, ...)`. See {@link StrategyEngine.order}.
 */
export const order = (
  id: string,
  direction: Direction,
  qty: number,
  options: { limit?: number; stop?: number } = {},
): void => {
  requireStrategyEngine().order(id, direction, qty, options);
};

/**
 * `strategy.exit(id, from_id, qty?, ...)`. See {@link StrategyEngine.exit}.
 */
export const exit = (
  id: string,
  fromId: string,
  qty?: number,
  options: {
    limit?: number;
    stop?: number;
    profit?: number;
    loss?: number;
    ocaName?: string;
  } = {},
): void => {
  requireStrategyEngine().exit(id, fromId, qty, options);
};

/** `strategy.close(id, qty?)`. */
export const close = (id: string, qty?: number): void => {
  requireStrategyEngine().close(id, qty);
};

/** `strategy.close_all()`. */
export const close_all = (): void => {
  requireStrategyEngine().close_all();
};

/** `strategy.cancel(id)`. */
export const cancel = (id: string): void => {
  requireStrategyEngine().cancel(id);
};

/** `strategy.cancel_all()`. */
export const cancel_all = (): void => {
  requireStrategyEngine().cancel_all();
};

/** `strategy.long`. The long direction constant. */
export const long: Direction = "long";

/** `strategy.short`. The short direction constant. */
export const short: Direction = "short";

/** `strategy.cash`. Initial capital set in the strategy declaration. */
export const cash = (): number => requireStrategyEngine().equity;

/** `strategy.position_size`. Signed position (long+, short-). */
export const position_size = (): number => requireStrategyEngine().position_size;

/** `strategy.position_avg_price`. Average entry price of the open position. */
export const position_avg_price = (): number => requireStrategyEngine().position_avg_price;

/** `strategy.equity`. Cash + mark-to-market position value. */
export const equity = (): number => requireStrategyEngine().equity;

/** `strategy.netprofit`. Realised + unrealised P&L since start. */
export const netprofit = (): number => requireStrategyEngine().netprofit;

/** `strategy.grossprofit`. Sum of profitable closed trades. */
export const grossprofit = (): number => requireStrategyEngine().grossprofit;

/** `strategy.grossloss`. Sum of unprofitable closed trades (negative). */
export const grossloss = (): number => requireStrategyEngine().grossloss;

/** `strategy.drawdown`. Current equity drawdown from the peak. */
export const drawdown = (): number => requireStrategyEngine().drawdown;

/** `strategy.max_drawdown`. Largest peak-to-trough equity decline. */
export const max_drawdown = (): number => requireStrategyEngine().max_drawdown;

/** `strategy.closedtrades`. Number of closed trades. */
export const closedtrades_number = (): number => requireStrategyEngine().closedtrades_number;

/** `strategy.opentrades`. Number of open trades. */
export const opentrades_number = (): number => requireStrategyEngine().opentrades_number;

/** `strategy.risk.*` namespace — risk-management overrides (draft stubs). */
export const risk = {
  /** `strategy.risk.allow_entry_in(direction)`. Restricts entry direction. */
  allow_entry_in: (direction: Direction | Direction[]): void => {
    requireStrategyEngine(); // validate engine exists
    if (Array.isArray(direction) && direction.length === 0) {
      throw new RangeError("strategy.risk.allow_entry_in: direction list must not be empty");
    }
  },
  /** `strategy.risk.max_cons_loss_days(value)`. Caps consecutive loss days. */
  max_cons_loss_days: (value: number): void => {
    requireStrategyEngine();
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("strategy.risk.max_cons_loss_days: value must be positive");
    }
  },
  /** `strategy.risk.max_drawdown(value, type)`. Caps max equity drawdown. */
  max_drawdown: (value: number, type: "percent" | "fixed" = "percent"): void => {
    requireStrategyEngine();
    if (typeof type !== "string")
      throw new RangeError("strategy.risk.max_drawdown: type must be a string");
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("strategy.risk.max_drawdown: value must be positive");
    }
  },
  /** `strategy.risk.max_intraday_loss(value, type)`. Caps intraday loss. */
  max_intraday_loss: (value: number, type: "percent" | "fixed" = "percent"): void => {
    requireStrategyEngine();
    if (typeof type !== "string")
      throw new RangeError("strategy.risk.max_intraday_loss: type must be a string");
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("strategy.risk.max_intraday_loss: value must be positive");
    }
  },
  /** `strategy.risk.max_position_size(value)`. Caps max position size. */
  max_position_size: (value: number): void => {
    requireStrategyEngine();
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("strategy.risk.max_position_size: value must be positive");
    }
  },
};

/** `closedtrades.*` accessor functions (subset of v6). */
export const closedtrades = {
  entry_bar_index: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.entryTime,
  exit_bar_index: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.exitTime,
  entry_price: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.entryPrice,
  exit_price: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.exitPrice,
  profit: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.profit,
  size: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.qty,
  max_runup: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.runUp,
  max_drawdown: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getClosedTrades()[tradeIndex]?.drawDown,
  max_runup_percent: (tradeIndex: number): number | undefined => {
    const trade = requireStrategyEngine().getClosedTrades()[tradeIndex];
    if (trade === undefined || trade.entryPrice === 0 || trade.qty === 0) return undefined;
    return (trade.runUp / (trade.entryPrice * trade.qty)) * 100;
  },
  max_drawdown_percent: (tradeIndex: number): number | undefined => {
    const trade = requireStrategyEngine().getClosedTrades()[tradeIndex];
    if (trade === undefined || trade.entryPrice === 0 || trade.qty === 0) return undefined;
    return (trade.drawDown / (trade.entryPrice * trade.qty)) * 100;
  },
};

/** `opentrades.*` accessor functions (subset of v6). */
export const opentrades = {
  entry_bar_index: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getOpenTrades()[tradeIndex]?.entryTime,
  entry_price: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getOpenTrades()[tradeIndex]?.entryPrice,
  size: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getOpenTrades()[tradeIndex]?.qty,
  max_runup: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getOpenTrades()[tradeIndex]?.runUp,
  max_drawdown: (tradeIndex: number): number | undefined =>
    requireStrategyEngine().getOpenTrades()[tradeIndex]?.drawDown,
  max_runup_percent: (tradeIndex: number): number | undefined => {
    const trade = requireStrategyEngine().getOpenTrades()[tradeIndex];
    if (trade === undefined || trade.entryPrice === 0 || trade.qty === 0) return undefined;
    return (trade.runUp / (trade.entryPrice * trade.qty)) * 100;
  },
  max_drawdown_percent: (tradeIndex: number): number | undefined => {
    const trade = requireStrategyEngine().getOpenTrades()[tradeIndex];
    if (trade === undefined || trade.entryPrice === 0 || trade.qty === 0) return undefined;
    return (trade.drawDown / (trade.entryPrice * trade.qty)) * 100;
  },
};

export { getCurrentSession };
