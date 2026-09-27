/**
 * Internal scanning helpers shared by the `str` formatting modules. Not part
 * of the public Pine surface — `str/index.ts` deliberately does not re-export
 * this module.
 */

/** A consumed span of a format string: its literal text and the next index. */
export interface ConsumedSpan {
  readonly literal: string;
  readonly nextIndex: number;
}

/**
 * Consumes a Java-style quoted span starting at `index` (which must point at
 * an apostrophe), the quoting convention both `str.format` (MessageFormat)
 * and `str.format_time` (SimpleDateFormat) inherit: `''` yields a literal
 * apostrophe, any other span runs to the closing apostrophe, and an
 * unterminated span takes the rest of the string literally.
 */
export const consumeQuotedSpan = (text: string, index: number): ConsumedSpan => {
  if (text[index + 1] === "'") {
    return { literal: "'", nextIndex: index + 2 };
  }
  const closing = text.indexOf("'", index + 1);
  if (closing === -1) {
    return { literal: text.slice(index + 1), nextIndex: text.length };
  }
  return { literal: text.slice(index + 1, closing), nextIndex: closing + 1 };
};
