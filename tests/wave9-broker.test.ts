/**
 * Tests for Wave 9 — broker adapter boundary:
 *   - PaperBrokerAdapter: in-memory broker with market/limit/stop/stop-limit fills,
 *     commission + slippage, position reversal, pyramiding, OCA groups.
 *   - StrategyEngine + BrokerAdapter wiring: when an adapter is installed,
 *     entry/exit/close calls forward to the adapter instead of the emulator's
 *     pending queue.
 *   - BinanceBrokerAdapter: structural typing of `BinanceTradingSurface`
 *     (the SDK's trading surface must extend it for downstream wiring).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PaperBrokerAdapter,
  BinanceBrokerAdapter,
  MockBinanceTradingSurface,
  StrategyEngine,
  type BrokerAdapter,
  type OrderRequest,
  type OrderUpdate,
  type BinanceTradingSurface,
  type Bar,
} from "../src/index.js";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  isClosed: true,
});

const marketOrder = (
  clientId: string,
  symbol: string,
  direction: "long" | "short",
  qty: number,
): OrderRequest => ({
  clientId,
  symbol,
  direction,
  qty,
  orderType: "market",
  limitPrice: undefined,
  stopPrice: undefined,
  timeInForce: "GTC",
  isExit: false,
  ocaName: undefined,
});

describe("PaperBrokerAdapter", () => {
  let broker: PaperBrokerAdapter;
  const updates: OrderUpdate[] = [];

  beforeEach(() => {
    broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
    updates.length = 0;
    broker.onOrderUpdate((u) => updates.push(u));
  });

  // ---------- submit / cancel ----------

  describe("submitOrder / cancelOrder", () => {
    it("submitOrder returns a 'new' status and emits an update", async () => {
      const result = await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      expect(result.status).toBe("new");
      expect(result.clientId).toBe("o1");
      expect(updates[0]?.status).toBe("new");
      expect(updates[0]?.clientId).toBe("o1");
    });

    it("cancelOrder moves the order to 'canceled' and emits an update", async () => {
      const result = await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      await broker.cancelOrder(result.orderId);
      const lastUpdate = updates.at(-1);
      expect(lastUpdate?.status).toBe("canceled");
      expect(lastUpdate?.orderId).toBe(result.orderId);
    });

    it("cancelOrder on a filled order throws", async () => {
      const result = await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      await expect(broker.cancelOrder(result.orderId)).rejects.toThrow();
    });
  });

  // ---------- market fills ----------

  describe("market fills", () => {
    it("fills at the bar's open by default", async () => {
      await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.direction).toBe("long");
      expect(pos?.qty).toBe(10);
      expect(pos?.avgEntryPrice).toBe(100);
      expect(updates.at(-1)?.status).toBe("filled");
      expect(updates.at(-1)?.avgFillPrice).toBe(100);
    });

    it("fills at the bar's close when processOrdersOnClose is set", async () => {
      broker = new PaperBrokerAdapter({
        initialBalance: 10_000,
        processOrdersOnClose: true,
      });
      broker.onOrderUpdate((u) => updates.push(u));
      await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.avgEntryPrice).toBe(102);
    });
  });

  // ---------- limit / stop fills ----------

  describe("limit fills", () => {
    it("fills when the bar low reaches the limit (long)", async () => {
      const order: OrderRequest = {
        ...marketOrder("o1", "BTCUSDT", "long", 10),
        orderType: "limit",
        limitPrice: 95,
      };
      await broker.submitOrder(order);
      broker.processBar(bar(1, 100, 105, 90, 102)); // low 90 <= 95 → fill
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.avgEntryPrice).toBe(95);
    });

    it("does not fill when the bar low stays above the limit", async () => {
      const order: OrderRequest = {
        ...marketOrder("o1", "BTCUSDT", "long", 10),
        orderType: "limit",
        limitPrice: 95,
      };
      await broker.submitOrder(order);
      broker.processBar(bar(1, 100, 105, 96, 102)); // low 96 > 95 → no fill
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos).toBeUndefined();
    });
  });

  describe("stop fills", () => {
    it("fills when the bar high reaches the stop (long)", async () => {
      const order: OrderRequest = {
        ...marketOrder("o1", "BTCUSDT", "long", 10),
        orderType: "stop",
        stopPrice: 105,
      };
      await broker.submitOrder(order);
      broker.processBar(bar(1, 100, 110, 95, 102)); // high 110 >= 105 → fill
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.avgEntryPrice).toBe(105);
    });
  });

  // ---------- reversal / pyramiding ----------

  describe("reversal and pyramiding", () => {
    it("reverses the position when an entry arrives in the opposite direction", async () => {
      await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      // Now submit a short for 15 — should close 10 long, open 5 short.
      await broker.submitOrder(marketOrder("o2", "BTCUSDT", "short", 15));
      broker.processBar(bar(2, 110, 115, 105, 112));
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.direction).toBe("short");
      expect(pos?.qty).toBe(5);
      expect(pos?.avgEntryPrice).toBe(110);
      // The fill update should reflect the short entry.
      const fillUpdate = updates.filter((u) => u.clientId === "o2" && u.status === "filled");
      expect(fillUpdate).toHaveLength(1);
    });

    it("pyramids when an entry arrives in the same direction", async () => {
      await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      await broker.submitOrder(marketOrder("o2", "BTCUSDT", "long", 20));
      broker.processBar(bar(2, 102, 108, 100, 105));
      const pos = await broker.getPosition("BTCUSDT");
      // Avg = (100*10 + 102*20) / 30 = (1000 + 2040) / 30 = 101.333
      expect(pos?.qty).toBe(30);
      expect(pos?.avgEntryPrice).toBeCloseTo(3040 / 30, 5);
    });
  });

  // ---------- commission / slippage ----------

  describe("commission and slippage", () => {
    it("applies percent commission and points slippage to fills", async () => {
      broker = new PaperBrokerAdapter({
        initialBalance: 10_000,
        commissionType: "percent",
        commissionValue: 0.1, // 0.1%
        slippage: 0.5, // points
        slippageUnit: "points",
      });
      broker.onOrderUpdate((u) => updates.push(u));
      await broker.submitOrder(marketOrder("o1", "BTCUSDT", "long", 10));
      broker.processBar(bar(1, 100, 105, 95, 102));
      const pos = await broker.getPosition("BTCUSDT");
      expect(pos?.avgEntryPrice).toBeCloseTo(100.5, 5);
      // Balance decreases by entry commission: 100.5 * 10 * 0.001 = 1.005
      const balance = await broker.getBalance();
      expect(balance).toBeCloseTo(10_000 - 1.005, 5);
    });
  });

  // ---------- OCA groups ----------

  describe("OCA groups", () => {
    it("cancels sibling orders when one fills", async () => {
      const base = marketOrder("base", "BTCUSDT", "long", 10);
      const oca: OrderRequest = { ...base, clientId: "oca1", ocaName: "grp" };
      const oca2: OrderRequest = { ...base, clientId: "oca2", ocaName: "grp" };
      await broker.submitOrder(oca);
      await broker.submitOrder(oca2);
      broker.processBar(bar(1, 100, 105, 95, 102));
      // One of the OCA orders fills; the other is canceled.
      const statuses = updates.filter((u) => u.status === "filled" || u.status === "canceled");
      expect(statuses).toHaveLength(2);
      const filledCount = statuses.filter((u) => u.status === "filled").length;
      const canceledCount = statuses.filter((u) => u.status === "canceled").length;
      expect(filledCount).toBe(1);
      expect(canceledCount).toBe(1);
    });
  });
});

// ---------- StrategyEngine + BrokerAdapter wiring ----------

describe("StrategyEngine + BrokerAdapter wiring", () => {
  let engine: StrategyEngine;
  let broker: PaperBrokerAdapter;
  const submittedOrders: OrderRequest[] = [];

  beforeEach(() => {
    engine = new StrategyEngine();
    engine.configure({ title: "TEST", initial_capital: 10_000 });
    broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
    submittedOrders.length = 0;
    const original = broker.submitOrder.bind(broker);
    broker.submitOrder = (order: OrderRequest) => {
      submittedOrders.push(order);
      return original(order);
    };
    engine.setBrokerAdapter(broker);
  });

  it("entry forwards to the broker adapter", async () => {
    engine.entry("long1", "long", 10);
    await engine.whenBrokerIdle();
    expect(submittedOrders).toHaveLength(1);
    expect(submittedOrders[0]?.clientId).toBe("long1");
    expect(submittedOrders[0]?.direction).toBe("long");
    expect(submittedOrders[0]?.qty).toBe(10);
    expect(submittedOrders[0]?.isExit).toBe(false);
  });

  it("close forwards to the broker adapter as an opposite-side market exit", async () => {
    engine.entry("long1", "long", 10);
    await engine.whenBrokerIdle();
    broker.processBar(bar(1, 100, 101, 99, 100));
    engine.close("long1");
    await engine.whenBrokerIdle();
    expect(submittedOrders).toHaveLength(2);
    expect(submittedOrders[1]).toMatchObject({
      clientId: "close_long1",
      orderType: "market",
      direction: "short",
      qty: 10,
      isExit: true,
    });
  });

  it("setBrokerAdapter(undefined) restores the emulator path", async () => {
    engine.setBrokerAdapter(undefined);
    engine.entry("long1", "long", 10);
    await engine.whenBrokerIdle();
    expect(submittedOrders).toHaveLength(0);
  });

  it("getBrokerAdapter returns the installed adapter", () => {
    expect(engine.getBrokerAdapter()).toBe(broker);
  });
});

// ---------- BinanceBrokerAdapter structural typing ----------

describe("BinanceBrokerAdapter structural typing", () => {
  it("BinanceTradingSurface accepts an in-memory mock implementation", () => {
    const mock: BinanceTradingSurface = {
      newOrder: async () => ({
        orderId: "bin_1",
        status: "NEW",
        executedQty: 0,
        avgPrice: undefined,
        rejectReason: undefined,
      }),
      cancelOrder: async () => undefined,
      getPosition: async () => undefined,
      getBalance: async () => 10_000,
      onOrderUpdate: () => () => undefined,
    };
    const adapter: BrokerAdapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    expect(adapter).toBeDefined();
    expect(typeof adapter.submitOrder).toBe("function");
  });
});

// ---------- MockBinanceTradingSurface (reference implementation) ----------

describe("MockBinanceTradingSurface (reference implementation)", () => {
  const mkOrder = (
    overrides: Partial<OrderRequest> &
      Pick<OrderRequest, "symbol" | "direction" | "orderType" | "qty" | "clientId">,
  ): OrderRequest => ({
    limitPrice: undefined,
    stopPrice: undefined,
    timeInForce: "GTC",
    isExit: false,
    ocaName: undefined,
    ...overrides,
  });

  it("fills market orders at the bar's close and tracks position", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 105, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    const result = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "market",
        qty: 0.5,
        clientId: "c1",
      }),
    );
    expect(result.status).toBe("filled");
    expect(result.filledQty).toBe(0.5);
    expect(result.avgFillPrice).toBe(100);
    const pos = await adapter.getPosition("BTCUSDT");
    expect(pos?.direction).toBe("long");
    expect(pos?.qty).toBe(0.5);
    expect(pos?.avgEntryPrice).toBe(100);
  });

  it("fills limit BUY orders only when the bar's low ≤ limit price", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 105, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    const below = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "limit",
        qty: 0.5,
        limitPrice: 90,
        clientId: "c1",
      }),
    );
    expect(below.status).toBe("new");
    const at = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "limit",
        qty: 0.5,
        limitPrice: 95,
        clientId: "c2",
      }),
    );
    expect(at.status).toBe("filled");
    expect(at.avgFillPrice).toBe(95);
  });

  it("fills stop orders when the bar's high ≥ stop price", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 110, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    const triggered = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "stop",
        qty: 0.5,
        stopPrice: 105,
        clientId: "c1",
      }),
    );
    expect(triggered.status).toBe("filled");
    expect(triggered.avgFillPrice).toBe(105);
  });

  it("fires onOrderUpdate callbacks on fills and cancellations", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 105, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    const updates: OrderUpdate[] = [];
    adapter.onOrderUpdate((u) => updates.push(u));
    const r1 = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "market",
        qty: 0.5,
        clientId: "c1",
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe("filled");
    expect(updates[0]?.orderId).toBe(r1.orderId);

    // Cancel a resting limit order.
    const r2 = await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "limit",
        qty: 0.5,
        limitPrice: 50,
        clientId: "c2",
      }),
    );
    expect(r2.status).toBe("new");
    await adapter.cancelOrder(r2.orderId);
    expect(updates.at(-1)?.status).toBe("canceled");
  });

  it("pyramids into an existing position with weighted-average entry", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 105, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "market",
        qty: 0.5,
        clientId: "c1",
      }),
    );
    mock.setBar({ high: 110, low: 100, close: 105 });
    await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "market",
        qty: 0.5,
        clientId: "c2",
      }),
    );
    const pos = await adapter.getPosition("BTCUSDT");
    expect(pos?.qty).toBe(1);
    // Weighted avg = (100*0.5 + 105*0.5) / 1 = 102.5.
    expect(pos?.avgEntryPrice).toBeCloseTo(102.5, 10);
  });

  it("getOpenOrders returns resting limit orders", async () => {
    const mock = new MockBinanceTradingSurface({ startingBalance: 10_000 });
    mock.setBar({ high: 105, low: 95, close: 100 });
    const adapter = new BinanceBrokerAdapter(mock, { symbol: "BTCUSDT" });
    await adapter.submitOrder(
      mkOrder({
        symbol: "BTCUSDT",
        direction: "long",
        orderType: "limit",
        qty: 0.5,
        limitPrice: 50,
        clientId: "c1",
      }),
    );
    expect(mock.getOpenOrders()).toHaveLength(1);
    expect(mock.getOpenOrders()[0]?.clientOrderId).toBe("c1");
  });
});
