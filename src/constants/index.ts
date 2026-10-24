/**
 * Pine Script v6 constants — the most-used namespaces of named constant
 * values. Each is exposed as a readonly record so callers can use
 * `constants.dayofweek.MONDAY`, `constants.currency.USD`, etc.
 *
 * These mirror the TradingView v6 Reference Manual constant namespaces:
 * - `barmerge.*` — gap and lookahead handling for `request.*`
 * - `dayofweek.*` — weekday constants
 * - `session.*` — barstate-isfirstbar / islastbar / ismarket / etc.
 * - `adjustment.*` — backadjustment types for futures
 * - `currency.*` — ISO 4217 currency codes (56 entries)
 * - `order.*` — strategy.* order direction constants
 * - `alert.*` — alert frequency constants
 * - `display.*` — plot display mode constants
 * - `format.*` — str.tostring format specifiers
 * - `plot.*` — plot style constants
 * - `shape.*` — plotshape shape constants
 * - `location.*` — plotshape location constants
 * - `size.*` — plotshape size constants
 * - `text.*` — plotshape text alignment constants
 * - `font.*` — label / table font constants
 * - `extend.*` — line extend direction constants
 * - `xloc.*` — line x-axis location constants
 * - `yloc.*` — label y-axis location constants
 * - `position.*` — table position constants
 * - `scale.*` — plot scale constants
 * - `hline.*` — hline style constants
 * - `line.style_*` — line style constants
 * - `label.style_*` — label style constants
 *
 * Re-exports `barmerge` from `src/request/index.js` for callers who prefer
 * a single `constants` namespace import.
 */

import { barmerge as barmergeValue } from "../request/index.js";

/** Pine `barmerge.*` — gap and lookahead handling for `request.*`. */
export const barmerge: {
  readonly lookahead_on: "lookahead_on";
  readonly lookahead_off: "lookahead_off";
  readonly gaps_on: "gaps_on";
  readonly gaps_off: "gaps_off";
} = barmergeValue;

/** Pine `dayofweek.*` weekday constants (1 = Sunday ... 7 = Saturday). */
export const dayofweek = {
  SUNDAY: 1,
  MONDAY: 2,
  TUESDAY: 3,
  WEDNESDAY: 4,
  THURSDAY: 5,
  FRIDAY: 6,
  SATURDAY: 7,
} as const;

/**
 * Pine `session.*` constants — barstate flags used in `request.*` calls to
 * filter by session. These are string sentinels, not boolean barstate flags.
 */
export const session = {
  ISFIRSTBAR: "isfirstbar",
  ISLASTBAR: "islastbar",
  ISMARKET: "ismarket",
  ISPREMARKET: "ispremarket",
  ISPOSTMARKET: "ispostmarket",
  ISFIRSTBARREGULAR: "isfirstbarregular",
  ISLASTBARREGULAR: "islastbarregular",
} as const;

/** Pine `adjustment.*` — backadjustment types for futures series. */
export const adjustment = {
  NONE: "none",
  SPLITS: "splits",
  DIVIDENDS: "dividends",
  SPLITS_DIVIDENDS: "splits_dividends",
} as const;

/** Pine `backadjustment.*` — backadjustment method types. */
export const backadjustment = {
  NONE: "none",
  RATIO: "ratio",
  DIFFERENCE: "difference",
} as const;

/** Pine `settlement_as_close.*` — futures settlement roll mode. */
export const settlement_as_close = {
  NONE: "none",
  LAST_DAY_MORNING: "last_day_morning",
  LAST_DAY_CLOSE: "last_day_close",
  FIRST_DAY_OPEN: "first_day_open",
} as const;

/** Pine `currency.*` — ISO 4217 currency codes (subset; the v6 list has 56). */
export const currency = {
  AUD: "AUD",
  BGN: "BGN",
  BRL: "BRL",
  CAD: "CAD",
  CHF: "CHF",
  CNY: "CNY",
  CZK: "CZK",
  DKK: "DKK",
  EGP: "EGP",
  EUR: "EUR",
  GBP: "GBP",
  HKD: "HKD",
  HRK: "HRK",
  HUF: "HUF",
  IDR: "IDR",
  ILS: "ILS",
  INR: "INR",
  ISK: "ISK",
  JPY: "JPY",
  KRW: "KRW",
  MXN: "MXN",
  MYR: "MYR",
  NOK: "NOK",
  NZD: "NZD",
  PHP: "PHP",
  PKR: "PKR",
  PLN: "PLN",
  RON: "RON",
  RUB: "RUB",
  SAR: "SAR",
  SEK: "SEK",
  SGD: "SGD",
  THB: "THB",
  TRY: "TRY",
  TWD: "TWD",
  USD: "USD",
  VND: "VND",
  ZAR: "ZAR",
} as const;

/** Pine `order.*` — strategy.* order direction constants. */
export const order = {
  LONG: "long",
  SHORT: "short",
} as const;

/** Pine `alert.*` — alert frequency constants. */
export const alert = {
  ONCE_PER_BAR: "once_per_bar",
  ONCE_PER_BAR_CLOSE: "once_per_bar_close",
  ALL: "all",
} as const;

/** Pine `display.*` — plot display mode constants. */
export const display = {
  NONE: "none",
  DATA_WINDOW: "data_window",
  STATUS_LINE: "status_line",
  ALL: "all",
} as const;

/** Pine `format.*` — str.tostring format specifiers. */
export const format = {
  PRICE: "price",
  VOLUME: "volume",
  PERCENT: "percent",
  INTEGER: "integer",
} as const;

/** Pine `plot.*` — plot style constants. */
export const plot = {
  LINE: "line",
  CIRCLES: "circles",
  COLUMNS: "columns",
  HISTOGRAM: "histogram",
  AREA: "area",
  STEPLINE: "stepline",
  CROSS: "cross",
  SHADING: "shading",
} as const;

/** Pine `shape.*` — plotshape shape constants. */
export const shape = {
  CIRCLE: "shapecircle",
  XCROSS: "shapexcross",
  TRIANGLEUP: "shapetriangleup",
  TRIANGLEDOWN: "shapetriangledown",
  FLAG: "shapeflag",
  CROSS: "shapecross",
  ARROWUP: "shapearrowup",
  ARROWDOWN: "shapearrowdown",
  DIAMOND: "shapediamond",
  SQUARE: "shapesquare",
} as const;

/** Pine `location.*` — plotshape location constants. */
export const location = {
  ABOVEBAR: "abovebar",
  BELOWBAR: "belowbar",
  TOP: "top",
  BOTTOM: "bottom",
  ABSOLUTE: "absolute",
  LEFT: "left",
  RIGHT: "right",
} as const;

/** Pine `size.*` — plotshape size constants. */
export const size = {
  TINY: "tiny",
  SMALL: "small",
  NORMAL: "normal",
  LARGE: "large",
  HUGE: "huge",
  AUTO: "auto",
} as const;

/** Pine `text.*` — plotshape text alignment constants. */
export const text = {
  LEFT: "text_left",
  RIGHT: "text_right",
  CENTER: "text_center",
  TOP: "text_top",
  BOTTOM: "text_bottom",
  TOP_LEFT: "text_top_left",
  TOP_RIGHT: "text_top_right",
  BOTTOM_LEFT: "text_bottom_left",
  BOTTOM_RIGHT: "text_bottom_right",
} as const;

/** Pine `font.*` — label / table font family constants. */
export const font = {
  DEFAULT: "font.default",
  MONOSPACE: "font.monospace",
  SANS_SERIF: "font.sans_serif",
} as const;

/** Pine `extend.*` — line extend direction constants. */
export const extend = {
  NONE: "extend.none",
  LEFT: "extend.left",
  RIGHT: "extend.right",
  BOTH: "extend.both",
} as const;

/** Pine `xloc.*` — line x-axis location constants. */
export const xloc = {
  BAR_TIME: "xloc.bar_time",
  BAR_INDEX: "xloc.bar_index",
} as const;

/** Pine `yloc.*` — label y-axis location constants. */
export const yloc = {
  ABOVEBAR: "yloc.abovebar",
  BELOWBAR: "yloc.belowbar",
  TOP: "yloc.top",
  BOTTOM: "yloc.bottom",
  PRICE: "yloc.price",
  ABSOLUTE: "yloc.absolute",
} as const;

/** Pine `position.*` — table position constants. */
export const position = {
  TOP_LEFT: "position.top_left",
  TOP_CENTER: "position.top_center",
  TOP_RIGHT: "position.top_right",
  MIDDLE_LEFT: "position.middle_left",
  MIDDLE_CENTER: "position.middle_center",
  MIDDLE_RIGHT: "position.middle_right",
  BOTTOM_LEFT: "position.bottom_left",
  BOTTOM_CENTER: "position.bottom_center",
  BOTTOM_RIGHT: "position.bottom_right",
} as const;

/** Pine `scale.*` — plot scale constants. */
export const scale = {
  NONE: "scale.none",
  LEFT: "scale.left",
  RIGHT: "scale.right",
  BOTH: "scale.both",
} as const;

/** Pine `hline.*` — hline style constants. */
export const hline = {
  SOLID: "hline.style_solid",
  DASHED: "hline.style_dashed",
  DOTTED: "hline.style_dotted",
  ARROWED: "hline.style_arrowed",
} as const;

/** Pine `line.style_*` — line style constants. */
export const line = {
  STYLE_SOLID: "line.style_solid",
  STYLE_DASHED: "line.style_dashed",
  STYLE_DOTTED: "line.style_dotted",
  STYLE_ARROWED: "line.style_arrowed",
  STYLE_CIRCLE: "line.style_circle",
  STYLE_CROSS: "line.style_cross",
  STYLE_DIAMOND: "line.style_diamond",
  STYLE_TRIANGLE_UP: "line.style_triangleup",
  STYLE_TRIANGLE_DOWN: "line.style_triangledown",
} as const;

/** Pine `label.style_*` — label style constants. */
export const label = {
  STYLE_LABEL_LEFT: "label.style_label_left",
  STYLE_LABEL_RIGHT: "label.style_label_right",
  STYLE_LABEL_UP: "label.style_label_up",
  STYLE_LABEL_DOWN: "label.style_label_down",
  STYLE_LABEL_LOWER_LEFT: "label.style_label_lower_left",
  STYLE_LABEL_LOWER_RIGHT: "label.style_label_lower_right",
  STYLE_LABEL_UPPER_LEFT: "label.style_label_upper_left",
  STYLE_LABEL_UPPER_RIGHT: "label.style_label_upper_right",
  STYLE_LABEL_CENTER: "label.style_label_center",
  STYLE_NONE: "label.style_none",
} as const;

/** All constants exposed as a single record for callers who want one import. */
export const all: {
  readonly barmerge: typeof barmerge;
  readonly dayofweek: typeof dayofweek;
  readonly session: typeof session;
  readonly adjustment: typeof adjustment;
  readonly backadjustment: typeof backadjustment;
  readonly settlement_as_close: typeof settlement_as_close;
  readonly currency: typeof currency;
  readonly order: typeof order;
  readonly alert: typeof alert;
  readonly display: typeof display;
  readonly format: typeof format;
  readonly plot: typeof plot;
  readonly shape: typeof shape;
  readonly location: typeof location;
  readonly size: typeof size;
  readonly text: typeof text;
  readonly font: typeof font;
  readonly extend: typeof extend;
  readonly xloc: typeof xloc;
  readonly yloc: typeof yloc;
  readonly position: typeof position;
  readonly scale: typeof scale;
  readonly hline: typeof hline;
  readonly line: typeof line;
  readonly label: typeof label;
} = {
  barmerge,
  dayofweek,
  session,
  adjustment,
  backadjustment,
  settlement_as_close,
  currency,
  order,
  alert,
  display,
  format,
  plot,
  shape,
  location,
  size,
  text,
  font,
  extend,
  xloc,
  yloc,
  position,
  scale,
  hline,
  line,
  label,
};
