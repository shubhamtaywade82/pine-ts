export interface TimeframeInfo {
  readonly period: string;
  readonly multiplier: number;
  readonly isintraday: boolean;
  readonly isdaily: boolean;
  readonly isweekly: boolean;
  readonly ismonthly: boolean;
  readonly isminutes: boolean;
  readonly isseconds: boolean;
  readonly isticks: boolean;
  /** Daily, weekly, or monthly. */
  readonly isdwm: boolean;
}

/** Parses a Pine-style timeframe string into its constituent parts. */
export const parse = (tf: string): TimeframeInfo => {
  // Ticks: e.g. "1T"
  if (/^\d+T$/i.test(tf)) {
    const multiplier = parseInt(tf, 10);
    return {
      period: "T",
      multiplier,
      isintraday: false,
      isdaily: false,
      isweekly: false,
      ismonthly: false,
      isminutes: false,
      isseconds: false,
      isticks: true,
      isdwm: false,
    };
  }
  // Seconds: e.g. "30S"
  if (/^\d+S$/i.test(tf)) {
    const multiplier = parseInt(tf, 10);
    return {
      period: "S",
      multiplier,
      isintraday: true,
      isdaily: false,
      isweekly: false,
      ismonthly: false,
      isminutes: false,
      isseconds: true,
      isticks: false,
      isdwm: false,
    };
  }
  // Weekly: "W" or "1W"
  if (/^\d*W$/i.test(tf)) {
    const multiplier = parseInt(tf, 10) || 1;
    return {
      period: "W",
      multiplier,
      isintraday: false,
      isdaily: false,
      isweekly: true,
      ismonthly: false,
      isminutes: false,
      isseconds: false,
      isticks: false,
      isdwm: true,
    };
  }
  // Monthly: "M" or "1M"
  if (/^\d*M$/.test(tf)) {
    const multiplier = parseInt(tf, 10) || 1;
    return {
      period: "M",
      multiplier,
      isintraday: false,
      isdaily: false,
      isweekly: false,
      ismonthly: true,
      isminutes: false,
      isseconds: false,
      isticks: false,
      isdwm: true,
    };
  }
  // Daily: "D" or "1D"
  if (/^\d*D$/i.test(tf)) {
    const multiplier = parseInt(tf, 10) || 1;
    return {
      period: "D",
      multiplier,
      isintraday: false,
      isdaily: true,
      isweekly: false,
      ismonthly: false,
      isminutes: false,
      isseconds: false,
      isticks: false,
      isdwm: true,
    };
  }
  // Intraday minutes: numeric or suffixed with "m"/"h"
  // Pine accepts plain numbers ("1", "5", "60") as minutes.
  const minuteMatch = /^(\d+)[mh]?$/i.exec(tf);
  if (minuteMatch) {
    const raw = parseInt(minuteMatch[1]!, 10);
    const multiplier = /h$/i.test(tf) ? raw * 60 : raw;
    return {
      period: "",
      multiplier,
      isintraday: true,
      isdaily: false,
      isweekly: false,
      ismonthly: false,
      isminutes: true,
      isseconds: false,
      isticks: false,
      isdwm: false,
    };
  }
  throw new Error(`Unrecognised timeframe string: "${tf}"`);
};

/**
 * Returns the duration of the timeframe in seconds (Pine: `timeframe.in_seconds()`).
 * Months are approximated as 30 days, matching Pine v6 behaviour.
 */
export const in_seconds = (tf?: string): number => {
  const info = parse(tf ?? "1");
  if (info.isticks) return 0;
  if (info.isseconds) return info.multiplier;
  if (info.isminutes) return info.multiplier * 60;
  if (info.isdaily) return info.multiplier * 86400;
  if (info.isweekly) return info.multiplier * 604800;
  // Monthly — Pine approximates to 30 days
  return info.multiplier * 2592000;
};

/**
 * Returns the Pine-style timeframe string for a given number of seconds
 * (Pine: `timeframe.from_seconds()`).
 */
export const from_seconds = (seconds: number): string => {
  if (seconds >= 2592000 && seconds % 2592000 === 0) return `${seconds / 2592000}M`;
  if (seconds >= 604800 && seconds % 604800 === 0) return `${seconds / 604800}W`;
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400}D`;
  if (seconds % 60 === 0) return `${seconds / 60}`;
  return `${seconds}S`;
};
