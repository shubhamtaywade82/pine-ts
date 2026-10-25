/**
 * Routes `strategy.*` order calls to a live/paper {@link BrokerAdapter}.
 *
 * The engine's order methods are synchronous but the broker is not, and the
 * broker — not the script — owns the position. The router therefore:
 *
 * - serializes adapter calls in script order;
 * - tracks every submitted order by broker id and applies fills (from submit
 *   results and `onOrderUpdate`) idempotently, by cumulative filled quantity;
 * - keeps a per-entry book of filled quantity and average price, from which
 *   exit side and size are derived — never hardcoded;
 * - checks the broker position before sending any position-reducing order
 *   and refuses (reporting an error) when it does not match, because a
 *   mismatched exit would open a new position instead of closing one;
 * - places `strategy.exit` as two OCA-linked orders (take-profit limit and
 *   stop-loss stop), waits for a pending entry to fill, resubmits only when
 *   levels or size change, and cancels the sibling itself when a leg fills;
 * - reports every failure through `onError` instead of swallowing it.
 */

import type { BrokerAdapter, OrderRequest, OrderStatus } from "../broker/index.js";
import { resolveBracketLevels, type ExitBracket } from "./bracket.js";
import type { Direction } from "./index.js";

/** A broker call that failed or was refused; `operation` names the strategy call. */
export class BrokerOperationError extends Error {
  public constructor(
    public readonly operation: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`${operation}: ${message}`, options);
    this.name = "BrokerOperationError";
  }
}

export interface BrokerRouterContext {
  readonly symbol: () => string;
  readonly mintick: () => number | undefined;
  readonly onError: (error: BrokerOperationError) => void;
}

type OrderRole =
  | { readonly kind: "entry"; readonly entryId: string }
  | { readonly kind: "close"; readonly entryId: string | undefined }
  | {
      readonly kind: "exit";
      readonly entryId: string;
      readonly exitId: string;
      readonly bracketKey: string;
    };

interface TrackedOrder {
  readonly orderId: string;
  readonly request: OrderRequest;
  readonly role: OrderRole;
  filledQty: number;
  notional: number;
  status: OrderStatus;
  cancelRequested: boolean;
}

interface EntryPosition {
  readonly direction: Direction;
  qty: number;
  avgPrice: number;
}

type LegType = "limit" | "stop";

interface ExitLeg {
  readonly orderType: LegType;
  readonly price: number;
  /** Requested size before capping at the broker position. */
  readonly qty: number;
}

interface PlacedLeg extends ExitLeg {
  readonly orderId: string;
}

interface BrokerBracket {
  spec: ExitBracket;
  legs: PlacedLeg[];
}

const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set(["new", "partially_filled"]);

const opposite = (direction: Direction): Direction => (direction === "long" ? "short" : "long");

const keyOf = (exitId: string, entryId: string): string => `${exitId}\u0000${entryId}`;

const isFlat = (qty: number, reference: number): boolean =>
  qty <= Number.EPSILON * Math.max(1, reference);

export class BrokerOrderRouter {
  private queue: Promise<void> = Promise.resolve();
  private readonly orders = new Map<string, TrackedOrder>();
  private readonly entries = new Map<string, EntryPosition>();
  private readonly brackets = new Map<string, BrokerBracket>();
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly adapter: BrokerAdapter,
    private readonly context: BrokerRouterContext,
  ) {
    this.unsubscribe = adapter.onOrderUpdate((update) => {
      const tracked = this.orders.get(update.orderId);
      // An update can precede the submit result (synchronous brokers); the
      // result applies the same cumulative state, so nothing is lost.
      if (tracked === undefined) return;
      this.progress(
        tracked,
        update.status,
        update.filledQty,
        update.avgFillPrice,
        update.rejectReason,
      );
    });
  }

  public dispose(): void {
    this.unsubscribe();
  }

  /** Resolves once every queued broker call, including follow-ups they caused, has settled. */
  public async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.queue;
      await current;
    } while (current !== this.queue);
  }

  public submitEntry(request: OrderRequest): void {
    this.enqueue(`strategy.entry("${request.clientId}")`, async () => {
      await this.submit(request, { kind: "entry", entryId: request.clientId });
    });
  }

  public close(id: string, qty: number | undefined): void {
    if (qty !== undefined && !(Number.isFinite(qty) && qty > 0)) {
      throw new RangeError(`strategy.close qty must be a positive number; got ${qty}`);
    }
    this.enqueue(`strategy.close("${id}")`, async () => {
      const entry = this.entries.get(id);
      if (entry === undefined) return; // Pine: closing an entry with no open trade is a no-op.
      const position = await this.verifiedPosition(id, entry);
      const closeQty = Math.min(qty ?? entry.qty, entry.qty, position.qty);
      await this.submit(this.exitRequest(`close_${id}`, entry.direction, closeQty, "market"), {
        kind: "close",
        entryId: id,
      });
    });
  }

  public closeAll(): void {
    this.enqueue("strategy.close_all()", async () => {
      const position = await this.adapter.getPosition(this.context.symbol());
      if (position === undefined || position.qty <= 0) return;
      await this.submit(this.exitRequest("close_all", position.direction, position.qty, "market"), {
        kind: "close",
        entryId: undefined,
      });
    });
  }

  public exit(spec: ExitBracket): void {
    const key = keyOf(spec.id, spec.tradeId);
    const existing = this.brackets.get(key);
    if (existing === undefined) this.brackets.set(key, { spec, legs: [] });
    else existing.spec = spec;
    this.enqueue(`strategy.exit("${spec.id}")`, () => this.syncBracket(key));
  }

  public cancel(id: string): void {
    this.enqueue(`strategy.cancel("${id}")`, async () => {
      for (const [key, bracket] of this.brackets) {
        if (bracket.spec.id === id) this.brackets.delete(key);
      }
      await this.cancelOrders(
        this.openOrders().filter(
          (order) =>
            order.request.clientId === id ||
            (order.role.kind === "exit" && order.role.exitId === id),
        ),
      );
    });
  }

  public cancelAll(): void {
    this.enqueue("strategy.cancel_all()", async () => {
      this.brackets.clear();
      await this.cancelOrders(this.openOrders());
    });
  }

  // ---------- queue & errors ----------

  private enqueue(operation: string, task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => this.report(operation, error));
  }

  private report(operation: string, error: unknown): void {
    if (error instanceof BrokerOperationError) {
      this.context.onError(error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.context.onError(new BrokerOperationError(operation, message, { cause: error }));
  }

  // ---------- order lifecycle ----------

  private async submit(request: OrderRequest, role: OrderRole): Promise<TrackedOrder> {
    const result = await this.adapter.submitOrder(request);
    const tracked: TrackedOrder = {
      orderId: result.orderId,
      request,
      role,
      filledQty: 0,
      notional: 0,
      status: "new",
      cancelRequested: false,
    };
    this.orders.set(result.orderId, tracked);
    this.progress(
      tracked,
      result.status,
      result.filledQty,
      result.avgFillPrice,
      result.rejectReason,
    );
    return tracked;
  }

  /** Applies a cumulative order state; duplicates and stale updates are no-ops. */
  private progress(
    order: TrackedOrder,
    status: OrderStatus,
    filledQty: number,
    avgFillPrice: number | undefined,
    rejectReason: string | undefined,
  ): void {
    const wasOpen = OPEN_STATUSES.has(order.status);
    const delta = filledQty - order.filledQty;
    let fillPrice = Number.NaN;
    if (delta > 0) {
      const notional = avgFillPrice === undefined ? Number.NaN : filledQty * avgFillPrice;
      fillPrice = (notional - order.notional) / delta;
      order.filledQty = filledQty;
      order.notional = notional;
    }
    if (!wasOpen && delta <= 0) return;
    if (wasOpen) order.status = status;

    if (wasOpen && status === "rejected") {
      this.report(
        `order "${order.request.clientId}"`,
        new Error(`rejected by broker: ${rejectReason ?? "no reason given"}`),
      );
    }
    if (delta > 0) this.onFill(order, delta, fillPrice);
    if (wasOpen && !OPEN_STATUSES.has(status) && order.role.kind === "entry") {
      // A cancelled/rejected entry may leave brackets with nothing to protect.
      this.resyncBracketsFor(order.role.entryId);
    }
  }

  private onFill(order: TrackedOrder, qty: number, price: number): void {
    const role = order.role;
    switch (role.kind) {
      case "entry":
        this.applyEntryFill(role.entryId, order.request.direction, qty, price);
        this.resyncBracketsFor(role.entryId);
        return;
      case "close":
        if (role.entryId === undefined)
          this.reduceDirection(opposite(order.request.direction), qty);
        else this.reduceEntry(role.entryId, qty);
        return;
      case "exit":
        this.onExitLegFill(order, role, qty);
        return;
    }
  }

  private onExitLegFill(
    order: TrackedOrder,
    role: Extract<OrderRole, { kind: "exit" }>,
    qty: number,
  ): void {
    const bracket = this.brackets.get(role.bracketKey);
    if (order.status === "filled" && bracket !== undefined) {
      // oca.reduce: the first leg to fill cancels its sibling, even on brokers
      // that ignore `ocaName`.
      this.brackets.delete(role.bracketKey);
      const siblings = bracket.legs.filter((leg) => leg.orderId !== order.orderId);
      this.enqueue(`strategy.exit("${role.exitId}") sibling cancel`, () =>
        this.cancelLegs(siblings),
      );
    }
    this.reduceEntry(role.entryId, qty);
    if (this.brackets.has(role.bracketKey)) {
      this.enqueue(`strategy.exit("${role.exitId}") resize`, () =>
        this.syncBracket(role.bracketKey),
      );
    }
  }

  // ---------- entry book ----------

  /** An opposite-side entry nets against open entries first, as the broker nets the position. */
  private applyEntryFill(entryId: string, direction: Direction, qty: number, price: number): void {
    const remaining = this.reduceDirection(opposite(direction), qty);
    if (isFlat(remaining, qty)) return;
    const existing = this.entries.get(entryId);
    if (existing?.direction === direction) {
      const total = existing.qty + remaining;
      existing.avgPrice = (existing.avgPrice * existing.qty + price * remaining) / total;
      existing.qty = total;
      return;
    }
    this.entries.set(entryId, { direction, qty: remaining, avgPrice: price });
  }

  /** Reduces entries of `direction` oldest-first; returns the quantity left over. */
  private reduceDirection(direction: Direction, qty: number): number {
    let remaining = qty;
    for (const [id, entry] of [...this.entries]) {
      if (entry.direction !== direction || isFlat(remaining, qty)) continue;
      const used = Math.min(entry.qty, remaining);
      this.reduceEntry(id, used);
      remaining -= used;
    }
    return remaining;
  }

  private reduceEntry(entryId: string, qty: number): void {
    const entry = this.entries.get(entryId);
    if (entry === undefined) return;
    entry.qty -= qty;
    if (!isFlat(entry.qty, qty)) return;
    this.entries.delete(entryId);
    // A closed trade takes its exits with it.
    for (const [key, bracket] of [...this.brackets]) {
      if (bracket.spec.tradeId !== entryId) continue;
      this.brackets.delete(key);
      this.enqueue(`strategy.exit("${bracket.spec.id}") cleanup`, () =>
        this.cancelLegs(bracket.legs),
      );
    }
  }

  // ---------- brackets ----------

  private resyncBracketsFor(entryId: string): void {
    for (const [key, bracket] of this.brackets) {
      if (bracket.spec.tradeId === entryId) {
        this.enqueue(`strategy.exit("${bracket.spec.id}")`, () => this.syncBracket(key));
      }
    }
  }

  private async syncBracket(key: string): Promise<void> {
    const bracket = this.brackets.get(key);
    if (bracket === undefined) return;
    const { spec } = bracket;
    const entry = this.entries.get(spec.tradeId);
    if (entry === undefined) {
      if (this.hasOpenEntryOrder(spec.tradeId)) return; // Pine: wait for the entry to fill.
      // Pine: an exit for an entry with no open trade is a no-op. Scripts
      // routinely call strategy.exit every bar, before and after a trade.
      this.brackets.delete(key);
      await this.cancelLegs(bracket.legs);
      return;
    }

    const desired = this.desiredLegs(spec, entry);
    if (this.legsMatch(bracket.legs, desired)) return;
    await this.cancelLegs(bracket.legs);
    bracket.legs = [];

    const position = await this.verifiedPosition(spec.tradeId, entry);
    for (const leg of desired) {
      // A leg that filled on submission consumed the bracket: stop placing legs.
      if (this.brackets.get(key) !== bracket) return;
      const request = this.exitRequest(
        `${spec.id}|${spec.tradeId}|${leg.orderType === "limit" ? "tp" : "sl"}`,
        entry.direction,
        Math.min(leg.qty, position.qty),
        leg.orderType,
        leg.price,
        spec.ocaName ?? `exit:${spec.id}:${spec.tradeId}`,
      );
      const placed = await this.submit(request, {
        kind: "exit",
        entryId: spec.tradeId,
        exitId: spec.id,
        bracketKey: key,
      });
      bracket.legs.push({ ...leg, orderId: placed.orderId });
    }
  }

  private desiredLegs(spec: ExitBracket, entry: EntryPosition): ExitLeg[] {
    const levels = resolveBracketLevels(
      spec,
      entry.direction,
      entry.avgPrice,
      this.context.mintick(),
    );
    const qty = Math.min(spec.qty ?? entry.qty, entry.qty);
    const legs: ExitLeg[] = [];
    if (levels.takeProfit !== undefined) {
      legs.push({ orderType: "limit", price: levels.takeProfit, qty });
    }
    if (levels.stopLoss !== undefined)
      legs.push({ orderType: "stop", price: levels.stopLoss, qty });
    if (legs.some((leg) => !Number.isFinite(leg.price))) {
      throw new Error(
        `cannot price exit "${spec.id}": entry "${spec.tradeId}" fill price is unknown (broker reported no average fill price)`,
      );
    }
    return legs;
  }

  /** True when the live (still open) legs are exactly the desired ones. */
  private legsMatch(placed: readonly PlacedLeg[], desired: readonly ExitLeg[]): boolean {
    const live = placed.filter((leg) => this.isOpen(leg.orderId));
    if (live.length !== placed.length || live.length !== desired.length) return false;
    return desired.every((want) =>
      live.some(
        (leg) =>
          leg.orderType === want.orderType && leg.price === want.price && leg.qty === want.qty,
      ),
    );
  }

  // ---------- helpers ----------

  /** The broker position must still be the entry's side, or an exit would open a new position. */
  private async verifiedPosition(
    entryId: string,
    entry: EntryPosition,
  ): Promise<{ readonly qty: number }> {
    const position = await this.adapter.getPosition(this.context.symbol());
    if (position === undefined || position.qty <= 0 || position.direction !== entry.direction) {
      const actual =
        position === undefined || position.qty <= 0
          ? "flat"
          : `${position.direction} ${position.qty}`;
      throw new Error(
        `broker position is ${actual} but entry "${entryId}" is ${entry.direction} ${entry.qty}; refusing to send an exit that could open a new position`,
      );
    }
    return position;
  }

  private exitRequest(
    clientId: string,
    positionDirection: Direction,
    qty: number,
    orderType: "market" | LegType,
    price?: number,
    ocaName?: string,
  ): OrderRequest {
    return {
      clientId,
      symbol: this.context.symbol(),
      direction: opposite(positionDirection),
      qty,
      orderType,
      limitPrice: orderType === "limit" ? price : undefined,
      stopPrice: orderType === "stop" ? price : undefined,
      timeInForce: "GTC",
      isExit: true,
      ocaName,
    };
  }

  private hasOpenEntryOrder(entryId: string): boolean {
    return this.openOrders().some(
      (order) => order.role.kind === "entry" && order.role.entryId === entryId,
    );
  }

  private isOpen(orderId: string): boolean {
    const order = this.orders.get(orderId);
    return order !== undefined && OPEN_STATUSES.has(order.status);
  }

  private openOrders(): TrackedOrder[] {
    return [...this.orders.values()].filter((order) => OPEN_STATUSES.has(order.status));
  }

  private async cancelLegs(legs: readonly PlacedLeg[]): Promise<void> {
    await this.cancelOrders(
      legs.flatMap((leg) => {
        const order = this.orders.get(leg.orderId);
        return order === undefined ? [] : [order];
      }),
    );
  }

  /** Cancels every still-open order; one failure does not stop the others. */
  private async cancelOrders(orders: readonly TrackedOrder[]): Promise<void> {
    const failures: string[] = [];
    for (const order of orders) {
      if (!OPEN_STATUSES.has(order.status) || order.cancelRequested) continue;
      order.cancelRequested = true;
      try {
        await this.adapter.cancelOrder(order.orderId);
      } catch (error) {
        order.cancelRequested = false;
        failures.push(
          `cancel ${order.orderId} ("${order.request.clientId}") failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
  }
}
