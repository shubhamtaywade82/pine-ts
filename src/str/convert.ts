import { consumeQuotedSpan } from "./internal.js";
import type { PineString } from "./core.js";

/**
 * `format.mintick` equivalent for {@link tostring}. Pine reads the chart's
 * `syminfo.mintick`; pine-ts has no ambient chart, so the mintick is carried
 * explicitly: `str.tostring(price, str.mintick(0.01))`.
 */
export interface MintickFormat {
  readonly kind: "mintick";
  readonly mintick: number;
}

export const mintick = (mintickValue: number): MintickFormat => ({
  kind: "mintick",
  mintick: mintickValue,
});

/** Any format a `str.tostring` call accepts. */
export type ToStringFormat = string | MintickFormat;

const isValidNumber = (value: number): boolean => Number.isFinite(value);

const defaultNumberToString = (value: number): string => {
  if (!isValidNumber(value)) return "NaN";
  // Shortest round-trip representation, matching how the Pine runtime prints
  // doubles. Values at or above 1e21 render in exponential form.
  const text = String(value);
  return text === "-0" ? "0" : text;
};

interface DecimalFormatSpec {
  readonly minimumIntegerDigits: number;
  readonly maximumFractionDigits: number;
  readonly minimumFractionDigits: number;
  readonly grouping: boolean;
}

const DECIMAL_PATTERN_ALLOWED = /^[0#.,]+$/;

/**
 * Parses the supported Java-DecimalFormat subset: `#` (optional digit),
 * `0` (required digit), `.` (fraction boundary) and `,` (grouping). The
 * fraction keeps up to the placeholder count of digits and at least the
 * number of `0` placeholders, e.g. `#.##` (0-2 digits), `#.000` (exactly 3),
 * `0` (integer), `#,##0.00` (grouped, 2 fixed decimals).
 */
const parseDecimalPattern = (pattern: string): DecimalFormatSpec => {
  if (pattern === "" || !DECIMAL_PATTERN_ALLOWED.test(pattern)) {
    throw new RangeError(
      `str format patterns support only '#', '0', '.' and ',': got "${pattern}"`,
    );
  }
  const [integerPart = "", fractionPart = ""] = pattern.split(".");
  const integerZeros = integerPart.replaceAll("#", "").length;
  const fractionZeros = fractionPart.replaceAll("#", "").length;
  return {
    minimumIntegerDigits: integerPart === "" ? 0 : Math.max(integerZeros, 1),
    maximumFractionDigits: fractionPart.length,
    minimumFractionDigits: fractionZeros,
    grouping: integerPart.includes(","),
  };
};

const groupIntegerDigits = (digits: string): string => {
  // Insert a separator every three digits from the right; short integers
  // (fewer than four digits) never group.
  if (digits.length < 4) return digits;
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    const remaining = digits.length - index;
    grouped += digits[index];
    if (remaining > 1 && remaining % 3 === 1) grouped += ",";
  }
  return grouped;
};

const applyDecimalSpec = (value: number, spec: DecimalFormatSpec): string => {
  if (!isValidNumber(value)) return "NaN";

  // Zero normalizes without a sign so `-0.0` prints as "0".
  const negative = value < 0 && value !== 0;
  const magnitude = Math.abs(value);
  // Number.toFixed rounds the binary double to the requested decimal count,
  // the same operation the Java runtime's formatter performs.
  const fixed = magnitude.toFixed(spec.maximumFractionDigits);
  const [integerPartRaw, fractionRaw = ""] = fixed.split(".") as [string, string?];
  let integerPart: string = integerPartRaw ?? "0";
  if (integerPart.length < spec.minimumIntegerDigits) {
    integerPart = integerPart.padStart(spec.minimumIntegerDigits, "0");
  }
  let fractionPart = fractionRaw ?? "";
  while (fractionPart.length > spec.minimumFractionDigits && fractionPart.endsWith("0")) {
    fractionPart = fractionPart.slice(0, -1);
  }
  if (spec.grouping) integerPart = groupIntegerDigits(integerPart);
  const sign = negative ? "-" : "";
  return fractionPart === "" ? `${sign}${integerPart}` : `${sign}${integerPart}.${fractionPart}`;
};

/** Formats a number with a Java-DecimalFormat-style pattern string. */
export const formatNumberPattern = (value: number, pattern: string): string =>
  applyDecimalSpec(value, parseDecimalPattern(pattern));

const decimalPlacesOf = (mintick: number): number => {
  const text = String(mintick);
  const exponent = /e-(\d+)$/i.exec(text);
  if (exponent !== null) return Number.parseInt(exponent[1] ?? "0", 10);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
};

const mintickToString = (value: number, mintickValue: number): string => {
  if (!isValidNumber(value) || !isValidNumber(mintickValue) || mintickValue <= 0) return "NaN";
  const snapped = Math.round(value / mintickValue) * mintickValue;
  const places = decimalPlacesOf(mintickValue);
  const formatted = applyDecimalSpec(snapped, {
    minimumIntegerDigits: 1,
    maximumFractionDigits: places,
    minimumFractionDigits: places,
    grouping: false,
  });
  return formatted;
};

/**
 * str.tostring — the string representation of a value.
 *
 * - a string value is returned as is;
 * - bool arguments return "true" or "false";
 * - when the value is na, the function returns the string "NaN";
 * - a pattern like `#.000` rounds to the placeholder count (`#` trims
 *   trailing zeros, `0` keeps them);
 * - `str.mintick(t)` (Pine's `format.mintick`) rounds to the nearest
 *   multiple of the mintick and prints trailing zeros.
 */
export const tostring = (value: PineString | number | boolean, format?: ToStringFormat): string => {
  if (value === undefined) return "NaN";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";

  if (format === undefined) return defaultNumberToString(value);
  if (typeof format === "string") return formatNumberPattern(value, format);
  return mintickToString(value, format.mintick);
};

type FormatArgument = number | boolean | string | undefined;

const formatArgument = (argument: FormatArgument, style?: string): string => {
  if (argument === undefined) return "NaN";
  if (typeof argument === "boolean") return argument ? "true" : "false";
  if (typeof argument === "string") {
    if (style !== undefined) {
      throw new TypeError("str.format number styles apply only to numeric arguments");
    }
    return argument;
  }

  if (style === undefined) return defaultNumberToString(argument);
  if (style === "integer") {
    return applyDecimalSpec(argument, {
      minimumIntegerDigits: 1,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
      grouping: true,
    });
  }
  if (style === "currency") {
    const body = applyDecimalSpec(argument, {
      minimumIntegerDigits: 1,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      grouping: true,
    });
    return body === "NaN" ? body : `$${body}`;
  }
  if (style === "percent") {
    const body = applyDecimalSpec(argument * 100, {
      minimumIntegerDigits: 1,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
      grouping: true,
    });
    return body === "NaN" ? body : `${body}%`;
  }
  return formatNumberPattern(argument, style);
};

interface PlaceholderSegment {
  readonly index: number;
  readonly style?: string | undefined;
}

type FormatSegment = { readonly literal: string } | PlaceholderSegment;

interface ParsedPlaceholder {
  readonly segment: PlaceholderSegment;
  readonly nextIndex: number;
}

/**
 * Parses one `{index[, type[, style]]}` placeholder starting at its opening
 * brace. Only the `number` type is supported (the only type Pine documents);
 * the style may be `integer`, `currency`, `percent`, or a `#.##` pattern.
 */
const parsePlaceholder = (formatString: string, opening: number): ParsedPlaceholder => {
  const closing = formatString.indexOf("}", opening + 1);
  if (closing === -1) {
    throw new Error(`str.format: unmatched '{' at position ${opening}`);
  }
  const parts = formatString
    .slice(opening + 1, closing)
    .split(",")
    .map((part) => part.trim());
  const position = Number(parts[0]);
  if (!Number.isInteger(position) || position < 0) {
    throw new RangeError(`str.format: invalid placeholder index "${parts[0]}"`);
  }
  if (parts.length > 1 && parts[1] !== "" && parts[1] !== "number") {
    throw new RangeError(`str.format: unsupported placeholder type "${parts[1]}"`);
  }
  const style = parts.length > 2 && parts[2] !== "" ? parts[2] : undefined;
  return { segment: { index: position, style }, nextIndex: closing + 1 };
};

/**
 * Splits a MessageFormat-style format string into literal and placeholder
 * segments. Apostrophes quote spans literally (`'{'` adds a literal `{`;
 * `''` adds a literal `'`), and every unquoted `{` must find its `}` or the
 * call is a runtime error, per the v6 remarks.
 */
const parseFormatString = (formatString: string): readonly FormatSegment[] => {
  const segments: FormatSegment[] = [];
  let literal = "";
  let index = 0;

  const flushLiteral = (): void => {
    if (literal !== "") {
      segments.push({ literal });
      literal = "";
    }
  };

  while (index < formatString.length) {
    const character = formatString[index]!;
    if (character === "'") {
      const span = consumeQuotedSpan(formatString, index);
      literal += span.literal;
      index = span.nextIndex;
      continue;
    }

    if (character === "{") {
      const parsed = parsePlaceholder(formatString, index);
      flushLiteral();
      segments.push(parsed.segment);
      index = parsed.nextIndex;
      continue;
    }

    literal += character;
    index += 1;
  }

  flushLiteral();
  return segments;
};

/**
 * str.format — a formatted string built from a MessageFormat-style template.
 * Placeholders in curly brackets refer to the positional arguments (`{0}` is
 * the first argument after the format string); numeric placeholders accept
 * `{n, number, style}` modifiers where style is `integer`, `currency`,
 * `percent`, or a `#.##`-style pattern. Apostrophes quote literal spans, and
 * imbalanced braces are a runtime error.
 */
export const format = (formatString: string, ...args: readonly FormatArgument[]): string => {
  const segments = parseFormatString(formatString);
  let result = "";
  for (const segment of segments) {
    if ("literal" in segment) {
      result += segment.literal;
      continue;
    }
    const argument = args[segment.index];
    if (argument === undefined && segment.index >= args.length) {
      throw new RangeError(`str.format: missing argument for placeholder {${segment.index}}`);
    }
    result += formatArgument(argument, segment.style);
  }
  return result;
};
