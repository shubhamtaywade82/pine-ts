/** Returns the year (in UTC) for the given UNIX timestamp in milliseconds. */
export const year = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCFullYear();

/** Returns the 1-based month (1-12 in UTC) for the given timestamp. */
export const month = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCMonth() + 1;

/** Returns the day of month (1-31 in UTC) for the given timestamp. */
export const dayofmonth = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCDate();

/** Returns the day of week (1 = Sunday, ..., 7 = Saturday in UTC) for the given timestamp. */
export const dayofweek = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCDay() + 1;

/** Returns the hour of day (0-23 in UTC) for the given timestamp. */
export const hour = (timestamp?: number): number => new Date(timestamp ?? Date.now()).getUTCHours();

/** Returns the minute (0-59 in UTC) for the given timestamp. */
export const minute = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCMinutes();

/** Returns the second (0-59 in UTC) for the given timestamp. */
export const second = (timestamp?: number): number =>
  new Date(timestamp ?? Date.now()).getUTCSeconds();

/** Returns the ISO week of the year (1-53) for the given timestamp. */
export const weekofyear = (timestamp?: number): number => {
  const d = new Date(timestamp ?? Date.now());
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
};
