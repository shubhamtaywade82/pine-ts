/**
 * Tests for the Wave 3 utility namespaces:
 *   str.*  (18 functions)
 *   color.* (7 functions + 17 named constants)
 *   input.* (13 functions)
 *   log.*  (4 functions + RuntimeError)
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as str from "../src/str/index.js";
import * as color from "../src/color/index.js";
import * as input from "../src/input/index.js";
import * as log from "../src/log/index.js";

// ---------- str.* ----------

describe("str.*", () => {
  it("contains / startswith / endswith return boolean or undefined", () => {
    expect(str.contains("hello world", "world")).toBe(true);
    expect(str.contains("hello world", "World")).toBe(false);
    expect(str.startswith("hello world", "hello")).toBe(true);
    expect(str.endswith("hello world", "world")).toBe(true);
    expect(str.contains(undefined, "x")).toBeUndefined();
    expect(str.contains("hello", undefined)).toBeUndefined();
  });

  it("length returns the UTF-16 code-unit count, na on na input", () => {
    expect(str.length("hello")).toBe(5);
    expect(str.length("😀x")).toBe(3); // surrogate pair + 1 = 3 code units
    expect(str.length(undefined)).toBeUndefined();
  });

  it("lower / upper / trim / trimleft / trimright transform naively", () => {
    expect(str.lower("HeLLo")).toBe("hello");
    expect(str.upper("HeLLo")).toBe("HELLO");
    expect(str.trim("  hi  ")).toBe("hi");
    expect(str.trimleft("  hi  ")).toBe("hi  ");
    expect(str.trimright("  hi  ")).toBe("  hi");
    expect(str.lower(undefined)).toBeUndefined();
  });

  it("substring clamps negative indices and supports open-ended end", () => {
    expect(str.substring("hello", 1, 3)).toBe("el");
    expect(str.substring("hello", 1)).toBe("ello");
    expect(str.substring("hello", -10, 3)).toBe("hel");
    expect(str.substring("hello", 10)).toBe("");
  });

  it("pos returns the 0-based index of the first occurrence or -1", () => {
    expect(str.pos("hello world", "o")).toBe(4);
    expect(str.pos("hello world", "x")).toBe(-1);
  });

  it("replace replaces N occurrences; replace_all replaces all", () => {
    expect(str.replace("a-b-a-b", "-", "_", 1)).toBe("a_b-a-b");
    expect(str.replace("a-b-a-b", "-", "_", 2)).toBe("a_b_a-b");
    expect(str.replace("a-b-a-b", "-", "_")).toBe("a_b_a_b"); // default all
    expect(str.replace_all("a-b-a-b", "-", "_")).toBe("a_b_a_b");
    expect(str.replace("a-b-a-b", "", "_")).toBe("a-b-a-b"); // empty target no-op
  });

  it("split divides on every separator; empty separator splits code units", () => {
    expect(str.split("a,b,c,d", ",")).toEqual(["a", "b", "c", "d"]);
    expect(str.split("abc", "")).toEqual(["a", "b", "c"]);
    expect(str.split(undefined, ",")).toBeUndefined();
  });

  it("tostring formats numbers and strings; honours format specifiers", () => {
    expect(str.tostring(123)).toBe("123");
    expect(str.tostring(1.5)).toBe("1.5");
    expect(str.tostring(Number.NaN)).toBe("NaN");
    expect(str.tostring(1.5, "0.00")).toBe("1.50");
    expect(str.tostring(1.5, "#.##")).toBe("1.5");
    expect(str.tostring(0.75, "0%")).toBe("75%");
    expect(str.tostring("hello")).toBe("hello");
    expect(str.tostring(undefined)).toBeUndefined();
  });

  it("format substitutes positional placeholders and formats numbers", () => {
    expect(str.format("Hello, {0}!", "world")).toBe("Hello, world!");
    expect(str.format("Price={0}", 42.5)).toBe("Price=42.5");
    expect(str.format("Price={0,number,#.##}", 42.5)).toBe("Price=42.5");
    expect(str.format("Price={0,number,0.00}", 42.5)).toBe("Price=42.50");
  });

  it("match returns the matched substring or undefined", () => {
    expect(str.match("hello world", "w.rld")).toBe("world");
    expect(str.match("hello world", "xyz")).toBeUndefined();
  });
});

// ---------- color.* ----------

describe("color.*", () => {
  it("rgb clamps channels and transparency", () => {
    const c = color.rgb(300, -10, 128, 200);
    expect(color.r(c)).toBe(255);
    expect(color.g(c)).toBe(0);
    expect(color.b(c)).toBe(128);
    expect(color.t(c)).toBe(100);
  });

  it("new_ updates transparency, keeps channels", () => {
    const base = color.rgb(255, 0, 0);
    const withT = color.new_(base, 50);
    expect(color.r(withT)).toBe(255);
    expect(color.t(withT)).toBe(50);
  });

  it("from_gradient interpolates linearly across the range", () => {
    const lo = color.rgb(0, 0, 0);
    const hi = color.rgb(100, 200, 50);
    const mid = color.from_gradient(5, 0, 10, lo, hi);
    expect(color.r(mid)).toBe(50);
    expect(color.g(mid)).toBe(100);
    expect(color.b(mid)).toBe(25);
  });

  it("from_gradient clamps outside the range", () => {
    const lo = color.rgb(0, 0, 0);
    const hi = color.rgb(100, 0, 0);
    expect(color.from_gradient(-5, 0, 10, lo, hi)).toEqual(lo);
    expect(color.from_gradient(15, 0, 10, lo, hi)).toEqual(hi);
  });

  it("named constants are opaque (t=0) and have the documented channels", () => {
    expect(color.t(color.black)).toBe(0);
    expect(color.r(color.black)).toBe(0);
    expect(color.g(color.white)).toBe(255);
    expect(color.b(color.red)).toBe(82);
    expect(color.r(color.green)).toBe(0);
    expect(color.b(color.blue)).toBe(255);
  });
});

// ---------- input.* ----------

describe("input.*", () => {
  beforeEach(() => {
    input.setActiveBindings({});
    // Clear seen inputs by re-importing won't work; instead we accept that
    // seenInputs accumulates across tests and only check binding resolution.
  });

  it("returns the default value when no binding is set", () => {
    expect(input.int(5, "len", { minval: 1, maxval: 100 })).toBe(5);
    expect(input.float(1.5, "mult")).toBe(1.5);
    expect(input.bool(true, "use_long")).toBe(true);
    expect(input.string("close", "src")).toBe("close");
    expect(input.interval(60, "tf")).toBe(60);
  });

  it("returns the bound value when a binding is set", () => {
    input.setActiveBindings({ len: 14, mult: 2.5, use_long: false });
    expect(input.int(5, "len")).toBe(14);
    expect(input.float(1.5, "mult")).toBe(2.5);
    expect(input.bool(true, "use_long")).toBe(false);
  });

  it("clamps integer bindings to the declared range", () => {
    input.setActiveBindings({ len: -5 });
    expect(input.int(5, "len", { minval: 1, maxval: 100 })).toBe(1);
    input.setActiveBindings({ len: 999 });
    expect(input.int(5, "len", { minval: 1, maxval: 100 })).toBe(100);
  });

  it("string input falls back to default when options reject the binding", () => {
    input.setActiveBindings({ src: "open" });
    expect(input.string("close", "src", { options: ["close", "high"] })).toBe("close");
    input.setActiveBindings({ src: "high" });
    expect(input.string("close", "src", { options: ["close", "high"] })).toBe("high");
  });

  it("qty clamps to minval (default 0)", () => {
    expect(input.qty(0.5, "size")).toBe(0.5);
    input.setActiveBindings({ size: -1 });
    expect(input.qty(0.5, "size")).toBe(0);
  });

  it("color input returns the bound color or default", () => {
    const def = color.rgb(0, 0, 0);
    expect(input.color(def, "c")).toEqual(def);
    const bound = color.rgb(255, 0, 0);
    input.setActiveBindings({ c: bound });
    expect(input.color(def, "c")).toEqual(bound);
  });
});

// ---------- log.* + runtime.error ----------

describe("log.* + runtime.error", () => {
  it("captures log entries to the installed sink", () => {
    const entries: log.LogEntry[] = [];
    log.setLogSink((entry) => entries.push(entry));
    try {
      log.info("hello");
      log.warning("warn");
      log.error("err");
    } finally {
      log.setLogSink(undefined);
    }
    expect(entries.map((e) => e.level)).toEqual(["info", "warning", "error"]);
    expect(entries.map((e) => e.message)).toEqual(["hello", "warn", "err"]);
  });

  it("silently drops entries when no sink is installed", () => {
    log.setLogSink(undefined);
    expect(() => log.info("nothing")).not.toThrow();
  });

  it("runtime.error throws a RuntimeError that aborts evaluation", () => {
    expect(() => log.runtimeError("boom")).toThrowError(log.RuntimeError);
    try {
      log.runtimeError("boom");
    } catch (e) {
      expect((e as Error).message).toBe("boom");
      expect((e as Error).name).toBe("RuntimeError");
    }
  });
});
