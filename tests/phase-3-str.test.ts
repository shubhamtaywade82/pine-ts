import { describe, expect, it } from "vitest";
import { str } from "../src/index.js";

describe("Phase 3 — str predicates and casing", () => {
  it("detects substrings, prefixes and suffixes", () => {
    expect(str.contains("NASDAQ:AAPL", ":")).toBe(true);
    expect(str.contains("NASDAQ:AAPL", "NYSE")).toBe(false);
    expect(str.contains("abc", "")).toBe(true);
    expect(str.endswith("FTX:BTCUSD", "USD")).toBe(true);
    expect(str.startswith("FTX:BTCUSD", "FTX")).toBe(true);
    expect(str.endswith("FTX:BTCUSD", "BTC")).toBe(false);
  });

  it("propagates na strings as na", () => {
    expect(str.contains(undefined, "x")).toBeUndefined();
    expect(str.endswith(undefined, "x")).toBeUndefined();
    expect(str.startswith(undefined, "x")).toBeUndefined();
    expect(str.length(undefined)).toBeUndefined();
    expect(str.lower(undefined)).toBeUndefined();
    expect(str.upper(undefined)).toBeUndefined();
    expect(str.pos(undefined, "x")).toBeUndefined();
  });

  it("counts length, changes case and trims control characters", () => {
    expect(str.length("NASDAQ:AAPL")).toBe(11);
    expect(str.length("")).toBe(0);
    expect(str.lower("PiNe-Ts")).toBe("pine-ts");
    expect(str.upper("PiNe-Ts")).toBe("PINE-TS");
    expect(str.trim("  abc\t\n")).toBe("abc");
    expect(str.trim("\u0007buzz\u001F")).toBe("buzz");
    expect(str.trim("   ")).toBe("");
    // na sources trim to the empty string, per the v6 remark.
    expect(str.trim(undefined)).toBe("");
  });

  it("finds positions with na for missing substrings", () => {
    expect(str.pos("NASDAQ:AAPL", ":")).toBe(6);
    expect(str.pos("aaa", "aa")).toBe(0);
    expect(str.pos("abc", "z")).toBeUndefined();
  });
});

describe("Phase 3 — str transformation", () => {
  it("repeats with separators", () => {
    expect(str.repeat("?", 3, ",")).toBe("?,?,?");
    expect(str.repeat("ab", 2)).toBe("abab");
    expect(str.repeat("ab", 0)).toBe("");
    expect(str.repeat(undefined, 3)).toBeUndefined();
    expect(() => str.repeat("a", -1)).toThrow(RangeError);
    expect(() => str.repeat("a", 1.5)).toThrow(RangeError);
  });

  it("replaces the nth occurrence only", () => {
    expect(str.replace("FTX:BTCUSD / FTX:BTCEUR", "FTX", "BINANCE", 0)).toBe(
      "BINANCE:BTCUSD / FTX:BTCEUR",
    );
    expect(str.replace("FTX:BTCUSD / FTX:BTCEUR", "FTX", "BINANCE", 1)).toBe(
      "FTX:BTCUSD / BINANCE:BTCEUR",
    );
    // Requesting an occurrence beyond what exists leaves the source unchanged.
    expect(str.replace("one FTX", "FTX", "X", 3)).toBe("one FTX");
    expect(str.replace("a-b-c", "-", "+")).toBe("a+b-c");
    expect(str.replace(undefined, "a", "b")).toBeUndefined();
  });

  it("replaces every occurrence", () => {
    expect(str.replaceAll("a-b-c-d", "-", "+")).toBe("a+b+c+d");
    expect(str.replaceAll("mississippi", "ss", "s")).toBe("misisippi");
    expect(str.replaceAll(undefined, "a", "b")).toBeUndefined();
  });

  it("extracts substrings with inclusive begin and exclusive end", () => {
    expect(str.substring("NASDAQ:AAPL", 7)).toBe("AAPL");
    expect(str.substring("NASDAQ:AAPL", 0, 6)).toBe("NASDAQ");
    expect(str.substring("abc", 1, 1)).toBe("");
    expect(str.substring("abc", 3)).toBe("");
    expect(str.substring(undefined, 0)).toBeUndefined();
    expect(() => str.substring("abc", -1)).toThrow(RangeError);
    expect(() => str.substring("abc", 2, 1)).toThrow(RangeError);
    expect(() => str.substring("abc", 0, 4)).toThrow(RangeError);
  });

  it("returns the first regex match or an empty string", () => {
    expect(str.match("It's time to sell some NASDAQ:AAPL!", "[\\w]+:[\\w]+")).toBe("NASDAQ:AAPL");
    expect(str.match("hello world", "\\d+")).toBe("");
    expect(str.match(undefined, "x")).toBeUndefined();
    expect(() => str.match("x", "[")).toThrow(SyntaxError);
  });
});

describe("Phase 3 — str numeric conversion", () => {
  it("parses properly formed numbers and rejects the rest with na", () => {
    expect(str.tonumber("42")).toBe(42);
    expect(str.tonumber("-3.5")).toBe(-3.5);
    expect(str.tonumber("+.5")).toBeCloseTo(0.5, 15);
    expect(str.tonumber("1.5e3")).toBeCloseTo(1500, 15);
    expect(str.tonumber("-2E-2")).toBeCloseTo(-0.02, 15);
    expect(str.tonumber("abc")).toBeNaN();
    expect(str.tonumber("")).toBeNaN();
    expect(str.tonumber("0x10")).toBeNaN();
    expect(str.tonumber("Infinity")).toBeNaN();
    expect(str.tonumber(" 1.5")).toBeNaN();
    expect(str.tonumber(undefined)).toBeNaN();
  });

  it("stringifies values with the documented na spelling", () => {
    expect(str.tostring(42)).toBe("42");
    expect(str.tostring(3.5)).toBe("3.5");
    expect(str.tostring(true)).toBe("true");
    expect(str.tostring(false)).toBe("false");
    expect(str.tostring("as is")).toBe("as is");
    expect(str.tostring(Number.NaN)).toBe("NaN");
    expect(str.tostring(undefined)).toBe("NaN");
  });

  it("stringifies numbers with DecimalFormat-style patterns", () => {
    // The v6 reference example: '#' rounds 3.99 up to 4.
    expect(str.tostring(3.99, "#")).toBe("4");
    expect(str.tostring(3.99, "#.#")).toBe("4");
    expect(str.tostring(1.34, "#.##")).toBe("1.34");
    expect(str.tostring(1.3, "#.##")).toBe("1.3");
    expect(str.tostring(1.3, "#.00")).toBe("1.30");
    expect(str.tostring(0.5, "#.000")).toBe("0.500");
    expect(str.tostring(1234.5, "#,##0.0")).toBe("1,234.5");
    expect(str.tostring(-1234.5, "#,##0.0")).toBe("-1,234.5");
    expect(str.tostring(42, "000")).toBe("042");
    expect(str.tostring(Number.NaN, "#.#")).toBe("NaN");
    expect(() => str.tostring(1, "x.#")).toThrow(RangeError);
  });

  it("stringifies mintick-formatted values with trailing zeros", () => {
    expect(str.tostring(1.234, str.mintick(0.01))).toBe("1.23");
    expect(str.tostring(1.2, str.mintick(0.01))).toBe("1.20");
    expect(str.tostring(1234.5, str.mintick(0.25))).toBe("1234.50");
    expect(str.tostring(Number.NaN, str.mintick(0.01))).toBe("NaN");
  });
});

describe("Phase 3 — str.format", () => {
  it("substitutes positional placeholders", () => {
    expect(str.format("Number {0} is not {1} to {2}", 1, "equal", 4)).toBe(
      "Number 1 is not equal to 4",
    );
    expect(str.format("{0} != {0}", 1.34)).toBe("1.34 != 1.34");
    expect(str.format("b {1} a {0}", "x", "y")).toBe("b y a x");
  });

  it("applies the documented number styles", () => {
    expect(str.format("{0,number,#.#}", 1.34)).toBe("1.3");
    expect(str.format("{0, number, integer}", 1.34)).toBe("1");
    expect(str.format("{0,number,currency}", 1.34)).toBe("$1.34");
    expect(str.format("{0, number, currency}", 1340000)).toBe("$1,340,000.00");
    expect(str.format("{0,number,percent}", 0.5)).toBe("50%");
    expect(
      str.format("Expected return is {0, number, percent} - {1, number, percent}", 0.1, 0.2),
    ).toBe("Expected return is 10% - 20%");
    expect(
      str.format(
        "{0, number, integer} is equal to 1, but {1, number, integer} is equal to 2",
        1.34,
        1.52,
      ),
    ).toBe("1 is equal to 1, but 2 is equal to 2");
  });

  it("formats booleans, strings and na", () => {
    expect(str.format("{0} and {1}", true, "false")).toBe("true and false");
    expect(str.format("value = {0}", Number.NaN)).toBe("value = NaN");
  });

  it("honors apostrophe quoting for literal braces", () => {
    expect(str.format("'{0}' is literal", 5)).toBe("{0} is literal");
    expect(str.format("it''s {0}", 1)).toBe("it's 1");
    // Unquoted closing braces are literals, so a double brace stays double.
    expect(str.format("ab }}{0} de", 1)).toBe("ab }}1 de");
    expect(str.format("ab }{0} de", 1)).toBe("ab }1 de");
  });

  it("rejects imbalanced braces and unsupported placeholders", () => {
    expect(() => str.format("ab {0 de")).toThrow();
    expect(() => str.format("''{''{0}", 1)).toThrow();
    expect(() => str.format("{0,date,short}", 1)).toThrow(RangeError);
    expect(() => str.format("{x}")).toThrow(RangeError);
    expect(() => str.format("{0} {1}", "only-one")).toThrow(RangeError);
  });
});

describe("Phase 3 — str.format_time", () => {
  // 2024-01-15 (a Monday) 14:30:45.123 UTC
  const time = Date.UTC(2024, 0, 15, 14, 30, 45, 123);

  it("formats the documented default pattern", () => {
    expect(str.formatTime(time)).toBe("2024-01-15T14:30:45+0000");
    expect(str.formatTime(time, "yyyy-MM-dd'T'HH:mm:ssZ")).toBe("2024-01-15T14:30:45+0000");
  });

  it("renders the documented token set", () => {
    expect(str.formatTime(time, "yyyy-MM-dd HH:mm:ss.SSS")).toBe("2024-01-15 14:30:45.123");
    expect(str.formatTime(time, "yy-M-d h:m:s a")).toBe("24-1-15 2:30:45 PM");
    expect(str.formatTime(time, "HH:mm")).toBe("14:30");
    expect(str.formatTime(time, "EEE yyyy/MM/dd")).toBe("Mon 2024/01/15");
    expect(str.formatTime(time, "EEEE, MMMM d, yyyy")).toBe("Monday, January 15, 2024");
    expect(str.formatTime(time, "S")).toBe("1");
  });

  it("applies IANA timezones with DST awareness", () => {
    // New York is UTC-5 in January (EST) and UTC-4 in July (EDT).
    expect(str.formatTime(time, "yyyy-MM-dd HH:mm:ss Z", "America/New_York")).toBe(
      "2024-01-15 09:30:45 -0500",
    );
    const july = Date.UTC(2024, 6, 15, 14, 30, 45, 123);
    expect(str.formatTime(july, "yyyy-MM-dd HH:mm:ss Z", "America/New_York")).toBe(
      "2024-07-15 10:30:45 -0400",
    );
    expect(str.formatTime(time, "yyyy-MM-dd HH:mm:ss.SSS", "Asia/Kolkata")).toBe(
      "2024-01-15 20:00:45.123",
    );
  });

  it("accepts UTC/GMT offset notation", () => {
    expect(str.formatTime(time, "HH:mm Z", "UTC-5")).toBe("09:30 -0500");
    expect(str.formatTime(time, "HH:mm Z", "GMT+0530")).toBe("20:00 +0530");
    expect(str.formatTime(time, "HH:mm Z", "UTC+05:30")).toBe("20:00 +0530");
    expect(str.formatTime(time, "HH:mm Z", "GMT")).toBe("14:30 +0000");
  });

  it("propagates na and rejects malformed input", () => {
    expect(str.formatTime(Number.NaN)).toBeUndefined();
    expect(() => str.formatTime(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => str.formatTime(time, "QQ")).toThrow(RangeError);
    expect(() => str.formatTime(time, "yyyy", "Not/AZone")).toThrow(RangeError);
  });
});
