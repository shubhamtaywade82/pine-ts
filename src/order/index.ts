/**
 * The `sort_order` built-in constants used by `array.sort`,
 * `array.sort_indices` (and, later, the `matrix.*` counterparts). Pine
 * models these as `order.ascending` / `order.descending`; pine-ts encodes
 * them as the equivalent literal strings so they remain serializable.
 */
export const order = {
  ascending: "ascending",
  descending: "descending",
} as const;

export type SortOrder = (typeof order)[keyof typeof order];
