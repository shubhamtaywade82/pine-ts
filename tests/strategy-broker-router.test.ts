/**
 * StrategyEngine → BrokerAdapter routing (live/paper path).
 *
 * The engine cannot know a broker position synchronously, so it serializes
 * adapter calls, tracks entry fills from order results/updates, derives exit
 * direction and size from those fills, verifies them against the broker
 * position before reducing it, and reports failures instead of guessing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PaperBrokerAdapter,
  StrategyEngine,
  type Bar,
  type BrokerAdapter,
  type OrderRequest,
  type OrderResult,
  type OrderStatus,
  type OrderUpdate,
  type Position,
} from "../src/index.js";

const SYMBOL = "TEST";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  isClosed: true,
});

describe("StrategyEngine routing to PaperBrokerAdapter", () => {
  let engine: StrategyEngine;
  let broker: PaperBrokerAdapter;
  let submitted: OrderRequest[];
  let errors: Error[];

  const settle = (): Promise<void> => engine.whenBrokerIdle();
  const runBar = async (b: Bar): Promise<void> => {
    broker.processBar(b);
    await settle();
  };
  const position = (): Promise<Position | undefined> => broker.getPosition(SYMBOL);

  const openPosition = async (
    id: string,
    direction: "long" | "short",
    qty: number,
  ): Promise<void> => {
    engine.entry(id, direction, qty);
    await settle();
    await runBar(bar(1, 100, 101, 99, 100));
  };

  beforeEach(() => {
    engine = new StrategyEngine();
    engine.configure({ title: SYMBOL, initial_capital: 10_000 });
    broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
    submitted = [];
    errors = [];
    const submit = broker.submitOrder.bind(broker);
    broker.submitOrder = (order: OrderRequest): Promise<OrderResult> => {
      submitted.push(order);
      return submit(order);
    };
    engine.setBrokerAdapter(broker);
    engine.onBrokerError((error) => errors.push(error));
  });

  describe("close", () => {
    it("buys back a short position (opposite side, full quantity)", async () => {
      await openPosition("S", "short", 5);
      engine.close("S");
      await settle();

      const order = submitted.at(-1);
      expect(order).toMatchObject({ direction: "long", qty: 5, orderType: "market", isExit: true });
      await runBar(bar(2, 101, 102, 100, 101));
      expect(await position()).toBeUndefined();
      expect(errors).toEqual([]);
    });

    it("sells a long position", async () => {
      await openPosition("L", "long", 3);
      engine.close("L");
      await settle();
      expect(submitted.at(-1)).toMatchObject({ direction: "short", qty: 3 });
    });

    it("closes a partial quantity, capped at the entry size", async () => {
      await openPosition("L", "long", 3);
      engine.close("L", 1);
      await settle();
      await runBar(bar(2, 100, 101, 99, 100));
      expect((await position())?.qty).toBe(2);

      engine.close("L", 50);
      await settle();
      expect(submitted.at(-1)?.qty).toBe(2);
    });

    it("sends nothing for an entry that never filled (Pine no-op)", async () => {
      engine.close("nothing");
      await settle();
      expect(submitted).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("refuses to trade when the broker position no longer matches the entry", async () => {
      await openPosition("L", "long", 3);
      // Flattened outside the strategy (manual trade on the broker).
      await submitOutsideStrategy(broker, "short", 3);
      broker.processBar(bar(2, 100, 101, 99, 100));

      engine.close("L");
      await settle();

      expect(submitted.filter((o) => o.isExit)).toEqual([]);
      expect(errors[0]?.message).toMatch(/position/);
    });

    it("keeps adapter calls in script order", async () => {
      engine.entry("L", "long", 2);
      engine.close("L");
      await settle();
      // The close ran after the entry was submitted, but the entry is unfilled.
      expect(submitted.map((o) => o.clientId)).toEqual(["L"]);
    });
  });

  describe("close_all", () => {
    it("flattens a short with a buy for the broker position size", async () => {
      await openPosition("S", "short", 4);
      engine.close_all();
      await settle();
      expect(submitted.at(-1)).toMatchObject({ direction: "long", qty: 4, isExit: true });
    });
  });

  describe("exit brackets", () => {
    it("submits take-profit and stop-loss as two linked exit orders for a long", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      await settle();

      const legs = submitted.filter((o) => o.isExit);
      expect(legs).toHaveLength(2);
      expect(legs.find((o) => o.orderType === "limit")).toMatchObject({
        direction: "short",
        qty: 2,
        limitPrice: 110,
      });
      expect(legs.find((o) => o.orderType === "stop")).toMatchObject({
        direction: "short",
        qty: 2,
        stopPrice: 95,
      });
      expect(legs[0]?.ocaName).toBeDefined();
      expect(legs[0]?.ocaName).toBe(legs[1]?.ocaName);
    });

    it("stops out a long only when price falls to the stop", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      await settle();

      await runBar(bar(2, 100, 105, 97, 103));
      expect((await position())?.qty).toBe(2);

      await runBar(bar(3, 100, 101, 94, 96));
      expect(await position()).toBeUndefined();
      expect(errors).toEqual([]);
    });

    it("buys to exit a short, with the stop above entry", async () => {
      await openPosition("S", "short", 2);
      engine.exit("X", "S", undefined, { stop: 105, limit: 90 });
      await settle();
      const legs = submitted.filter((o) => o.isExit);
      expect(legs.every((o) => o.direction === "long")).toBe(true);

      await runBar(bar(2, 100, 106, 99, 104));
      expect(await position()).toBeUndefined();
    });

    it("waits for a pending entry to fill before placing the bracket", async () => {
      engine.entry("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95 });
      await settle();
      expect(submitted.filter((o) => o.isExit)).toEqual([]);

      await runBar(bar(1, 100, 101, 99, 100));
      expect(submitted.filter((o) => o.isExit)).toMatchObject([
        { orderType: "stop", stopPrice: 95, qty: 2, direction: "short" },
      ]);
    });

    it("converts profit/loss ticks from the entry fill price", async () => {
      engine.setMintick(0.5);
      await openPosition("L", "long", 1);
      engine.exit("X", "L", undefined, { profit: 20, loss: 10 });
      await settle();
      const legs = submitted.filter((o) => o.isExit);
      expect(legs.find((o) => o.orderType === "limit")?.limitPrice).toBe(110);
      expect(legs.find((o) => o.orderType === "stop")?.stopPrice).toBe(95);
    });

    it("does not resubmit an unchanged bracket when exit() is called every bar", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      await settle();
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      await settle();
      expect(submitted.filter((o) => o.isExit)).toHaveLength(2);
    });

    it("replaces the bracket when its levels change", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95 });
      await settle();
      engine.exit("X", "L", undefined, { stop: 98 });
      await settle();

      await runBar(bar(2, 100, 101, 96, 97));
      expect(await position()).toBeUndefined();
      // Only the moved stop filled; the cancelled one did not double the exit.
      expect(submitted.filter((o) => o.isExit).map((o) => o.stopPrice)).toEqual([95, 98]);
      expect(errors).toEqual([]);
    });

    it("treats exit() without an open trade as a no-op, as Pine does on every bar", async () => {
      engine.exit("X", "L", undefined, { stop: 95 });
      await settle();
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95 });
      await settle();
      await runBar(bar(2, 100, 101, 94, 96));
      expect(await position()).toBeUndefined();

      engine.exit("X", "L", undefined, { stop: 95 });
      await settle();
      expect(submitted.filter((o) => o.isExit)).toHaveLength(1);
      expect(errors).toEqual([]);
    });

    it("cancels the bracket when the trade is closed by close()", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
      await settle();
      engine.close("L");
      await settle();
      await runBar(bar(2, 100, 101, 99, 100));
      expect(await position()).toBeUndefined();

      // A later crash must not trigger the stale stop and open a short.
      await runBar(bar(3, 99, 100, 80, 85));
      expect(await position()).toBeUndefined();
    });
  });

  describe("cancel", () => {
    it("cancels a pending entry by its strategy id", async () => {
      engine.entry("L", "long", 2, { limit: 90 });
      await settle();
      engine.cancel("L");
      await settle();
      await runBar(bar(1, 100, 101, 85, 95));
      expect(await position()).toBeUndefined();
    });

    it("cancel_all cancels pending entries and brackets", async () => {
      await openPosition("L", "long", 2);
      engine.exit("X", "L", undefined, { stop: 95 });
      engine.entry("L2", "long", 1, { limit: 90 });
      await settle();
      engine.cancel_all();
      await settle();
      await runBar(bar(2, 100, 101, 85, 90));
      expect((await position())?.qty).toBe(2);
    });
  });
});

const submitOutsideStrategy = async (
  broker: BrokerAdapter,
  direction: "long" | "short",
  qty: number,
): Promise<void> => {
  await broker.submitOrder({
    clientId: "manual",
    symbol: SYMBOL,
    direction,
    qty,
    orderType: "market",
    limitPrice: undefined,
    stopPrice: undefined,
    timeInForce: "GTC",
    isExit: false,
    ocaName: undefined,
  });
};

/** A broker the test drives by hand: no OCA support, explicit fills and rejections. */
class ManualBroker implements BrokerAdapter {
  public readonly requests = new Map<string, OrderRequest>();
  public readonly cancelled: string[] = [];
  public rejectNext: string | undefined;
  public failCancel = false;
  private readonly callbacks = new Set<(update: OrderUpdate) => void>();
  private positionQty = 0;
  private positionDirection: "long" | "short" = "long";
  private counter = 0;

  public submitOrder(order: OrderRequest): Promise<OrderResult> {
    this.counter += 1;
    const orderId = `m${this.counter}`;
    this.requests.set(orderId, order);
    const status: OrderStatus = this.rejectNext === undefined ? "new" : "rejected";
    const rejectReason = this.rejectNext;
    this.rejectNext = undefined;
    return Promise.resolve({
      orderId,
      clientId: order.clientId,
      status,
      filledQty: 0,
      avgFillPrice: undefined,
      rejectReason,
    });
  }

  public cancelOrder(orderId: string): Promise<void> {
    if (this.failCancel) return Promise.reject(new Error(`cancel ${orderId} failed`));
    this.cancelled.push(orderId);
    this.emit(orderId, "canceled", 0, undefined);
    return Promise.resolve();
  }

  public getPosition(symbol: string): Promise<Position | undefined> {
    if (this.positionQty === 0) return Promise.resolve(undefined);
    return Promise.resolve({
      symbol,
      direction: this.positionDirection,
      qty: this.positionQty,
      avgEntryPrice: 0,
      unrealisedPnl: 0,
    });
  }

  public getBalance(): Promise<number> {
    return Promise.resolve(0);
  }

  public onOrderUpdate(callback: (update: OrderUpdate) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /** Fills `filledQty` (cumulative) of the order at `price`. */
  public fill(orderId: string, filledQty: number, price: number): void {
    const order = this.requests.get(orderId);
    if (order === undefined) throw new Error(`unknown ${orderId}`);
    const signed = order.direction === "long" ? 1 : -1;
    const current = this.positionDirection === "long" ? this.positionQty : -this.positionQty;
    const next = current + signed * (filledQty - this.filled(orderId));
    this.positionDirection = next >= 0 ? "long" : "short";
    this.positionQty = Math.abs(next);
    this.filledById.set(orderId, filledQty);
    this.emit(orderId, filledQty >= order.qty ? "filled" : "partially_filled", filledQty, price);
  }

  public idOf(predicate: (order: OrderRequest) => boolean): string {
    const match = [...this.requests].find(([, order]) => predicate(order));
    if (match === undefined) throw new Error("no matching order");
    return match[0];
  }

  private readonly filledById = new Map<string, number>();

  private filled(orderId: string): number {
    return this.filledById.get(orderId) ?? 0;
  }

  private emit(
    orderId: string,
    status: OrderStatus,
    filledQty: number,
    avgFillPrice: number | undefined,
  ): void {
    const order = this.requests.get(orderId);
    for (const callback of this.callbacks) {
      callback({
        orderId,
        clientId: order?.clientId ?? "",
        status,
        filledQty,
        avgFillPrice,
        rejectReason: undefined,
        symbol: SYMBOL,
      });
    }
  }
}

describe("StrategyEngine routing to an adapter without native OCA", () => {
  let engine: StrategyEngine;
  let broker: ManualBroker;
  let errors: Error[];

  beforeEach(() => {
    engine = new StrategyEngine();
    engine.configure({ title: SYMBOL, initial_capital: 10_000 });
    broker = new ManualBroker();
    errors = [];
    engine.setBrokerAdapter(broker);
    engine.onBrokerError((error) => errors.push(error));
  });

  const openLong = async (qty: number): Promise<void> => {
    engine.entry("L", "long", qty);
    await engine.whenBrokerIdle();
    broker.fill(
      broker.idOf((o) => o.clientId === "L"),
      qty,
      100,
    );
    await engine.whenBrokerIdle();
  };

  it("cancels the sibling leg itself when one leg fills", async () => {
    await openLong(2);
    engine.exit("X", "L", undefined, { stop: 95, limit: 110 });
    await engine.whenBrokerIdle();
    const stopId = broker.idOf((o) => o.isExit && o.orderType === "stop");
    const limitId = broker.idOf((o) => o.isExit && o.orderType === "limit");

    broker.fill(stopId, 2, 95);
    await engine.whenBrokerIdle();

    expect(broker.cancelled).toEqual([limitId]);
    expect(errors).toEqual([]);
  });

  it("resizes the bracket after a partial entry fill grows to full", async () => {
    engine.entry("L", "long", 4);
    engine.exit("X", "L", undefined, { stop: 95 });
    await engine.whenBrokerIdle();
    const entryId = broker.idOf((o) => o.clientId === "L");

    broker.fill(entryId, 1, 100);
    await engine.whenBrokerIdle();
    broker.fill(entryId, 4, 100);
    await engine.whenBrokerIdle();

    const stops = [...broker.requests.values()].filter((o) => o.isExit);
    expect(stops.map((o) => o.qty)).toEqual([1, 4]);
    expect(broker.cancelled).toHaveLength(1);
  });

  it("reports a rejected order", async () => {
    broker.rejectNext = "insufficient margin";
    engine.entry("L", "long", 1);
    await engine.whenBrokerIdle();
    expect(errors[0]?.message).toMatch(/insufficient margin/);
  });

  it("reports a failed cancel instead of swallowing it", async () => {
    engine.entry("L", "long", 1, { limit: 90 });
    await engine.whenBrokerIdle();
    broker.failCancel = true;
    engine.cancel("L");
    await engine.whenBrokerIdle();
    expect(errors[0]?.message).toMatch(/cancel/);
  });

  it("rejects whenBrokerIdle() with unreported errors when no listener is installed", async () => {
    const quiet = new StrategyEngine();
    quiet.configure({ title: SYMBOL });
    const quietBroker = new ManualBroker();
    quiet.setBrokerAdapter(quietBroker);
    quietBroker.rejectNext = "halted";
    quiet.entry("L", "long", 1);
    await expect(quiet.whenBrokerIdle()).rejects.toThrow(/halted/);
    await expect(quiet.whenBrokerIdle()).resolves.toBeUndefined();
  });
});
