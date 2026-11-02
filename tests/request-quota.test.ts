import { describe, expect, it, beforeEach } from "vitest";
import {
  configureRequestQuota,
  countRequestSite,
  requestQuotaLimit,
  requestSitesUsed,
  resetRequestQuota,
  RequestQuotaExceeded,
  DEFAULT_REQUEST_QUOTA,
} from "../src/request/quota.js";

describe("request.*() call-site quota", () => {
  beforeEach(() => {
    resetRequestQuota();
    configureRequestQuota(DEFAULT_REQUEST_QUOTA);
  });

  it("defaults to TradingView Ultimate's 40-call budget", () => {
    expect(DEFAULT_REQUEST_QUOTA).toBe(40);
    expect(requestQuotaLimit()).toBe(40);
  });

  it("counts distinct call sites, not invocations", () => {
    expect(countRequestSite("security:BTCUSDT:60:fn")).toBe(true);
    expect(countRequestSite("security:BTCUSDT:60:fn")).toBe(true); // same site, free
    expect(countRequestSite("security:BTCUSDT:60:fn")).toBe(true);
    expect(requestSitesUsed()).toBe(1);
    expect(countRequestSite("security:ETHUSDT:240:fn")).toBe(true);
    expect(requestSitesUsed()).toBe(2);
  });

  it("throws RequestQuotaExceeded when the budget is spent", () => {
    configureRequestQuota(3);
    expect(countRequestSite("a")).toBe(true);
    expect(countRequestSite("b")).toBe(true);
    expect(countRequestSite("c")).toBe(true);
    expect(() => countRequestSite("d")).toThrow(RequestQuotaExceeded);
    expect(() => countRequestSite("d")).toThrow(/quota is 3/);
    // Existing sites still fine after the budget is spent.
    expect(countRequestSite("a")).toBe(true);
  });

  it("can be configured to degrade instead of throw", () => {
    configureRequestQuota(1, false);
    expect(countRequestSite("a")).toBe(true);
    expect(countRequestSite("b")).toBe(false); // rejected, not thrown
  });

  it("resetRequestQuota re-arms the counter between runs", () => {
    configureRequestQuota(2);
    countRequestSite("a");
    countRequestSite("b");
    expect(() => countRequestSite("c")).toThrow(RequestQuotaExceeded);
    resetRequestQuota();
    expect(requestSitesUsed()).toBe(0);
    expect(countRequestSite("c")).toBe(true);
  });

  it("rejects invalid limits", () => {
    expect(() => configureRequestQuota(0)).toThrow(RangeError);
    expect(() => configureRequestQuota(1.5)).toThrow(RangeError);
  });
});
