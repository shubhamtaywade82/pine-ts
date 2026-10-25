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

/**
 * Pine `barstate.*` — bar-state boolean flags exposed as built-in variables.
 * Each corresponds to a `barstate.isX` variable that the script can read
 * directly. Here they are exposed as a constants record for callers that
 * want to switch on the bar state (the actual bar-state read happens via
 * `ctx.barstate.isX` — see {@link PineContext}).
 */
export const barstate = {
  // Bar identity / lifecycle.
  ISFIRSTBAR: "barstate.isfirstbar",
  ISFIRSTBAR_HISTORY: "barstate.isfirstbar_history",
  ISFIRSTBAR_REALTIME: "barstate.isfirstbar_realtime",
  ISLASTBAR: "barstate.islastbar",
  ISLASTBAR_HISTORY: "barstate.islastbar_history",
  ISLASTBAR_REALTIME: "barstate.islastbar_realtime",
  ISLASTBARINHISTORY: "barstate.islastbarinhistory",
  ISLASTBARINHISTORY_SECONDARYTIMEZONE: "barstate.islastbarinhistory_secondarytimezone",
  ISREALTIME: "barstate.isrealtime",
  ISHISTORY: "barstate.ishistory",
  ISNEW: "barstate.isnew",
  ISCLOSED: "barstate.isclosed",
  ISSTARTED: "barstate.isstarted",
  // Session / market state.
  ISTIME: "barstate.istime",
  ISSESSION: "barstate.issession",
  ISMARKET: "barstate.ismarket",
  ISPREMARKET: "barstate.ispremarket",
  ISPOSTMARKET: "barstate.ispostmarket",
  ISAFTERSESSION: "barstate.isaftersession",
  ISREGULAR: "barstate.isregular",
  ISWEEKEND: "barstate.isweekend",
  // Bar periodicity.
  ISDAILY: "barstate.isdaily",
  ISWEEKLY: "barstate.isweekly",
  ISMONTHLY: "barstate.ismonthly",
  ISQUARTERLY: "barstate.isquarterly",
  ISYEARLY: "barstate.isyearly",
  ISMINUTE: "barstate.isminute",
  ISINTRA: "barstate.isintra",
  ISMOUNTAIN: "barstate.ismountain",
} as const;

/**
 * Pine `syminfo.type` — symbol type constants. Used by `syminfo.type` and
 * the `request.security(... type...)` overload. Mirrors TradingView's
 * documented types: stock, futures, index, forex, crypto, fund, dr, cfd,
 * economy.
 */
export const syminfo_type = {
  STOCK: "stock",
  FUTURES: "futures",
  INDEX: "index",
  FOREX: "forex",
  CRYPTO: "crypto",
  FUND: "fund",
  DR: "dr",
  CFD: "cfd",
  ECONOMY: "economy",
} as const;

/**
 * Pine `months.*` — calendar month constants (January..December, integer
 * 1..12). Used by `time`/`timestamp` overloads and `month()` accessors.
 */
export const months = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
} as const;

/**
 * Pine `frequency` — frequency constants for `request.financial` queries
 * (the GICS / EDGAR-style financial statement frequency). Pine v6 exposes
 * these as `f_quarterly`, `f_yearly`, `f_monthly`, `f_semiannual`,
 * `f_trimester`, `f_weekly`, `f_daily`, `f_none` for ad-hoc request
 * periods; pine-ts exposes the named constants for callers that prefer
 * not to hard-code the string.
 */
export const frequency = {
  F_QUARTERLY: "FQ",
  F_YEARLY: "FY",
  F_MONTHLY: "FM",
  F_SEMIANNUAL: "FS",
  F_TRIMESTER: "FT",
  F_WEEKLY: "FW",
  F_DAILY: "FD",
  F_NONE: "FN",
} as const;

/**
 * Pine `display.*` extra attributes for plot declarations — `display.none`,
 * `display.all`, `display.data_window`, `display.status_line`,
 * `display.status_line_main`, `display.status_line_secondary`,
 * `display.axis`, `display.price_scale`, `display.pane`, `display.legend`,
 * `display.tooltip`, `display.tooltip_summary`. Used by `plot`/`plotshape`/
 * `plotchar`/`plotarrow`/`plotbar`/`plotcandle`/`hline`/`fill`/`bgcolor`/
 * `barcolor`.
 *
 * The base `display` record (above) only has the most-used 4 values; this
 * extended record adds the rest.
 */
export const display_extended = {
  NONE: "display.none",
  ALL: "display.all",
  DATA_WINDOW: "display.data_window",
  STATUS_LINE: "display.status_line",
  STATUS_LINE_MAIN: "display.status_line_main",
  STATUS_LINE_SECONDARY: "display.status_line_secondary",
  AXIS: "display.axis",
  PRICE_SCALE: "display.price_scale",
  PANE: "display.pane",
  LEGEND: "display.legend",
  TOOLTIP: "display.tooltip",
  TOOLTIP_SUMMARY: "display.tooltip_summary",
} as const;

/**
 * Pine `plot.freq_*` — the `freq` parameter for `plot`/`plotshape`/`plotchar`
 * /`plotarrow`/`plotbar`/`plotcandle`/`hline`/`fill`/`bgcolor`/`barcolor`.
 * Controls the timeframes on which the visual is rendered.
 */
export const plot_freq = {
  FREQ_ALL: "freq.all",
  FREQ_DAILY: "freq.daily",
  FREQ_WEEKLY: "freq.weekly",
  FREQ_MONTHLY: "freq.monthly",
  FREQ_QUARTERLY: "freq.quarterly",
  FREQ_YEARLY: "freq.yearly",
  FREQ_NONE: "freq.none",
  FREQ_1MINUTE: "freq.1minute",
  FREQ_5MINUTES: "freq.5minutes",
  FREQ_15MINUTES: "freq.15minutes",
  FREQ_30MINUTES: "freq.30minutes",
  FREQ_45MINUTES: "freq.45minutes",
  FREQ_1HOUR: "freq.1hour",
  FREQ_2HOURS: "freq.2hours",
  FREQ_4HOURS: "freq.4hours",
  FREQ_1DAY: "freq.1day",
  FREQ_1WEEK: "freq.1week",
  FREQ_1MONTH: "freq.1month",
} as const;

/**
 * Pine `earnings.*` — earnings event constants used by
 * `request.earnings` queries. Each is the string sentinel for the
 * earnings announcement timing relative to the regular session.
 */
export const earnings = {
  BMO: "BMO", // Before Market Open
  AMC: "AMC", // After Market Close
  UNSET: "Unset",
} as const;

/**
 * Pine `quandl.*` — Quandl API tier constants used by `request.quandl`.
 * `quandl.tier_free` and `quandl.tier_premium` distinguish the data tier.
 */
export const quandl = {
  TIER_FREE: "free",
  TIER_PREMIUM: "premium",
} as const;

/**
 * Pine `economic.*` — FRED-style economic release source constants used by
 * `request.economic`. The string sentinels name the data provider.
 */
export const economic = {
  SOURCE_FED: "federal_reserve",
  SOURCE_BEA: "bea",
  SOURCE_BLS: "bls",
  SOURCE_CENSUS: "census",
  SOURCE_TREASURY: "treasury",
  SOURCE_OECD: "oecd",
  SOURCE_ECB: "ecb",
  SOURCE_OTHER: "other",
} as const;

/**
 * Pine `syminfo.volumetype` — volume type constants. Used by
 * `syminfo.volumetype` accessor and `request.security` overloads.
 */
export const volumetype = {
  NONE: "none",
  TICK: "tick",
  SHARE: "share",
  CONTRACT: "contract",
  LOTS: "lots",
  BASE_CCURRENCY: "base_currency",
  QUOTE_CURRENCY: "quote_currency",
} as const;

/**
 * Pine `barmerge.*` extended gaps constants — the legacy Pine v5 names that
 * some v6 scripts still reference. Already exposed via `barmerge` above;
 * these are the explicit string sentinels for callers who prefer to read
 * them by name.
 */
export const barmerge_gaps = {
  GAPS_ON: "gaps_on",
  GAPS_OFF: "gaps_off",
  GAPS_NA: "gaps_na",
} as const;

/**
 * Pine `line.style_*` additional styles. The base `line` record (above) has
 * the most-common 9; this adds the v6-only line styles for extended
 * drawing objects.
 */
export const line_extended = {
  STYLE_SOLID_CROSS: "line.style_solid_cross",
  STYLE_DASHED_CROSS: "line.style_dashed_cross",
  STYLE_DOTTED_CROSS: "line.style_dotted_cross",
} as const;

/**
 * Pine `color.bg` — the named background palette used by `plot`/`plotshape`/
 * `bgcolor` defaults. Already exposed as functions in `src/color/index.ts`;
 * these string sentinels are for callers that want to switch on a palette
 * name and resolve the color via `color.from_name(...)`.
 */
export const color_palette = {
  BACKGROUND: "background",
  FOREGROUND: "foreground",
  UP: "up",
  DOWN: "down",
  NEUTRAL: "neutral",
  ACCENT: "accent",
} as const;

/**
 * Pine `text.align_*` — text alignment constants for `plotshape` and
 * `label.set_text_align`. Already partially covered by the base `text`
 * record above; this adds the combined alignment strings.
 */
export const text_align = {
  LEFT: "text.align_left",
  CENTER: "text.align_center",
  RIGHT: "text.align_right",
  TOP: "text.align_top",
  BOTTOM: "text.align_bottom",
  TOP_LEFT: "text.align_top_left",
  TOP_RIGHT: "text.align_top_right",
  BOTTOM_LEFT: "text.align_bottom_left",
  BOTTOM_RIGHT: "text.align_bottom_right",
} as const;

/**
 * Pine `text.wrap_*` — text wrapping mode for `label`/`table` cells.
 */
export const text_wrap = {
  NONE: "text.wrap_none",
  AUTO: "text.wrap_auto",
} as const;

/**
 * Pine `text.font_family_*` — font family for `label`/`table` text.
 */
export const text_font_family = {
  DEFAULT: "text.font_family_default",
  MONOSPACE: "text.font_family_monospace",
  SANS_SERIF: "text.font_family_sans_serif",
  SERIF: "text.font_family_serif",
  CURSIVE: "text.font_family_cursive",
  FANTASY: "text.font_family_fantasy",
} as const;

/**
 * Pine `cell.border_*` — table cell border style constants.
 */
export const cell_border = {
  TOP: "cell.border_top",
  BOTTOM: "cell.border_bottom",
  LEFT: "cell.border_left",
  RIGHT: "cell.border_right",
  ALL: "cell.border_all",
  NONE: "cell.border_none",
} as const;

/**
 * Pine `tooltip.*` — tooltip placement / orientation constants for
 * `table` cells and `label` tooltips.
 */
export const tooltip = {
  POSITION_TOP: "tooltip.position_top",
  POSITION_BOTTOM: "tooltip.position_bottom",
  POSITION_LEFT: "tooltip.position_left",
  POSITION_RIGHT: "tooltip.position_right",
  POSITION_AUTO: "tooltip.position_auto",
} as const;

/**
 * Pine `event.*` — alert event constants used by `alertcondition` and
 * `alert` to specify the event trigger (for v6 alert subscriptions).
 */
export const event = {
  BAR_CLOSED: "event.bar_closed",
  PRICE_CROSS: "event.price_cross",
  PRICE_UP: "event.price_up",
  PRICE_DOWN: "event.price_down",
  ALERT_TRIGGERED: "event.alert_triggered",
} as const;

/**
 * Pine `strategy.direction.*` — strategy direction constants used by
 * `strategy.risk.*` and `strategy.entry`/`strategy.order` for order side.
 * Already partly exposed via `order` record above; this adds the strategy
 * risk-specific direction constants.
 */
export const strategy_direction = {
  LONG: "strategy.direction.long",
  SHORT: "strategy.direction.short",
  ALL: "strategy.direction.all",
} as const;

/**
 * Pine `strategy.evaluations.*` — strategy evaluation result constants
 * for `strategy.opentrades.*`/`strategy.closedtrades.*` queries.
 */
export const strategy_evaluations = {
  PROFIT: "strategy.evaluations.profit",
  LOSS: "strategy.evaluations.loss",
  WIN: "strategy.evaluations.win",
  LOSS_TRADE: "strategy.evaluations.loss_trade",
  NEUTRAL: "strategy.evaluations.neutral",
} as const;

/**
 * Pine `chart.*` — chart-type constants for `chart.point` / `chart.bg_color`
 * / `chart.fg_color` accessors. String sentinels for the named colors used by
 * `chart` namespace built-ins.
 */
export const chart = {
  POINT_DEFAULT: "chart.point_default",
  POINT_XLOC_BAR_TIME: "chart.point_xloc_bar_time",
  POINT_XLOC_BAR_INDEX: "chart.point_xloc_bar_index",
  BG_COLOR: "chart.bg_color",
  FG_COLOR: "chart.fg_color",
} as const;

/**
 * Pine `linefill.*` — linefill variant constants for the `linefill.new`
 * extended overload (gradient direction).
 */
export const linefill = {
  STYLE_SOLID: "linefill.style_solid",
  STYLE_GRADIENT_VERTICAL: "linefill.style_gradient_vertical",
  STYLE_GRADIENT_HORIZONTAL: "linefill.style_gradient_horizontal",
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
  readonly barstate: typeof barstate;
  readonly syminfo_type: typeof syminfo_type;
  readonly months: typeof months;
  readonly frequency: typeof frequency;
  readonly display_extended: typeof display_extended;
  readonly plot_freq: typeof plot_freq;
  readonly earnings: typeof earnings;
  readonly quandl: typeof quandl;
  readonly economic: typeof economic;
  readonly volumetype: typeof volumetype;
  readonly barmerge_gaps: typeof barmerge_gaps;
  readonly line_extended: typeof line_extended;
  readonly color_palette: typeof color_palette;
  readonly text_align: typeof text_align;
  readonly text_wrap: typeof text_wrap;
  readonly text_font_family: typeof text_font_family;
  readonly cell_border: typeof cell_border;
  readonly tooltip: typeof tooltip;
  readonly event: typeof event;
  readonly strategy_direction: typeof strategy_direction;
  readonly strategy_evaluations: typeof strategy_evaluations;
  readonly chart: typeof chart;
  readonly linefill: typeof linefill;
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
  barstate,
  syminfo_type,
  months,
  frequency,
  display_extended,
  plot_freq,
  earnings,
  quandl,
  economic,
  volumetype,
  barmerge_gaps,
  line_extended,
  color_palette,
  text_align,
  text_wrap,
  text_font_family,
  cell_border,
  tooltip,
  event,
  strategy_direction,
  strategy_evaluations,
  chart,
  linefill,
};
