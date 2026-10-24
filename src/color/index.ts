/**
 * Pine Script v6 `color.*` namespace — color creation and manipulation.
 *
 * A color is an `r,g,b,t` tuple where `r`/`g`/`b` are 0–255 channel values
 * and `t` is transparency (0 = opaque, 100 = fully transparent). Pine v6
 * exposes colors as the same `color` type that drawing functions consume.
 * Here we represent it as a branded `{ r, g, b, t }` object so it round-trips
 * cleanly through TypeScript types; the underlying value is plain data so
 * any visual adapter can read the channels directly.
 */

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Transparency 0..100. 0 is opaque, 100 is fully transparent. */
  readonly t: number;
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const clampTransparency = (t: number): number => Math.max(0, Math.min(100, Math.round(t)));

/**
 * `color.new(col, transparency)`. Returns a copy of `col` with the given
 * transparency (0 = opaque, 100 = fully transparent).
 */
export const new_ = (col: Color, transparency: number): Color => ({
  r: col.r,
  g: col.g,
  b: col.b,
  t: clampTransparency(transparency),
});

/**
 * `color.rgb(red, green, blue, transparency?)`. Builds a color from raw
 * channel values. `transparency` defaults to 0 (opaque). Each channel is
 * clamped to 0–255; transparency to 0–100.
 */
export const rgb = (
  red: number,
  green: number,
  blue: number,
  transparency = 0,
): Color => ({
  r: clampByte(red),
  g: clampByte(green),
  b: clampByte(blue),
  t: clampTransparency(transparency),
});

/**
 * `color.r(col)`. Red channel of `col`, 0–255.
 */
export const r = (col: Color): number => col.r;

/**
 * `color.g(col)`. Green channel of `col`, 0–255.
 */
export const g = (col: Color): number => col.g;

/**
 * `color.b(col)`. Blue channel of `col`, 0–255.
 */
export const b = (col: Color): number => col.b;

/**
 * `color.t(col)`. Transparency of `col`, 0–100.
 */
export const t = (col: Color): number => col.t;

/**
 * `color.from_gradient(value, min_value, max_value, min_color, max_color)`.
 * Returns the linearly interpolated color between `min_color` and
 * `max_color` for `value` in the `[min_value, max_value]` range. Below the
 * range returns `min_color`; above it returns `max_color`. Transparency is
 * interpolated linearly like the channels.
 */
export const from_gradient = (
  value: number,
  minValue: number,
  maxValue: number,
  minColor: Color,
  maxColor: Color,
): Color => {
  if (minValue === maxValue) return value <= minValue ? minColor : maxColor;
  const ratio = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  return {
    r: clampByte(minColor.r + (maxColor.r - minColor.r) * ratio),
    g: clampByte(minColor.g + (maxColor.g - minColor.g) * ratio),
    b: clampByte(minColor.b + (maxColor.b - minColor.b) * ratio),
    t: clampTransparency(minColor.t + (maxColor.t - minColor.t) * ratio),
  };
};

// ---------- Named color constants (Pine v6) ----------
// All standard 17 Pine v6 color constants, exposed as opaque colors with t=0.

const constant = (red: number, green: number, blue: number): Color =>
  ({ r: clampByte(red), g: clampByte(green), b: clampByte(blue), t: 0 });

export const black: Color = constant(0, 0, 0);
export const white: Color = constant(255, 255, 255);
export const red: Color = constant(255, 82, 82);
export const orange: Color = constant(255, 152, 0);
export const yellow: Color = constant(255, 234, 0);
export const olive: Color = constant(128, 128, 0);
export const lime: Color = constant(118, 238, 0);
export const green: Color = constant(0, 200, 83);
export const aqua: Color = constant(0, 255, 255);
export const teal: Color = constant(0, 128, 128);
export const navy: Color = constant(0, 0, 128);
export const blue: Color = constant(41, 98, 255);
export const purple: Color = constant(156, 39, 176);
export const fuchsia: Color = constant(255, 0, 255);
export const maroon: Color = constant(128, 0, 0);
export const gray: Color = constant(128, 128, 128);
export const silver: Color = constant(192, 192, 192);
