/**
 * Compensated (Kahan) running sum — ported arithmetic, not ported architecture.
 *
 * PineScript does not re-sum a window on each bar. It keeps a compensated
 * (Kahan) running sum: each bar first removes (with a Kahan step) the
 * compensated value that was added for the value leaving the window, then
 * adds the new value with a Kahan step and stores its compensation; when the
 * pending compensation would be lost when applied to the new value (it moves
 * the sum toward +infinity by less than |c| on the floating-point grid), the
 * sum is recomputed from the window values NEWEST-FIRST and the compensation
 * resets. Reproducing this chain bit-for-bit is what makes `math.sum` /
 * `ta.sma` / `ta.stdev` / `ta.variance` / `ta.mfi` agree with PineScript
 * reference vectors (see tests/reference-pine-vectors-running-sum.test.ts).
 *
 * The class is the state object inside an `IndicatorDef` — `step()` / `stepNa()`
 * are pure with respect to committed state (they only mutate working fields
 * that the next `step` ignores), so pine-ts's rollback-correct evaluate /
 * commit / rollback lifecycle holds by construction.
 *
 * Attribution: arithmetic transcribed from OakScriptJS's `RunningSum`
 * (https://github.com/deepentropy/oakscriptJS, MIT, v0.12.3); rewritten as a
 * session-scoped state class. See `docs/ECOSYSTEM.md` rule 4: "ported
 * arithmetic, not ported architecture".
 */

/**
 * Whether the compensation `c` is (partly) lost when it is applied to `x`:
 * `x + |c|` in floating point moves `x` by less than `|c|`. Moving toward
 * +infinity uses the grid above `x`, as PineScript does (measured bit for
 * bit, #142).
 */
const compensationLost = (x: number, c: number): boolean => {
  if (c === 0 || x === 0) return false;
  const size = Math.abs(c);
  return Math.abs(x + size - x) < size;
};

/**
 * Running window sum with the floating-point behaviour of PineScript
 * `math.sum` / `ta.sma` / `ta.stdev` / `ta.variance` / `ta.mfi`.
 *
 * The state machine:
 * - `step(x, length)` computes the running sum at the new bar given the new
 *   value `x` and the (possibly new) window length `length`. Committed
 *   state is unchanged until `commit()` is called.
 * - `stepNa(length)` computes the running sum on an na bar (no new value
 *   added). The result is the previous sum (with the new length applied if
 *   the length is a series).
 * - `commit()` promotes the last step's working state to committed state.
 *
 * The length can change from one step to the next (a series length). When it
 * does, the kernel first moves the kept sum to the new length with Kahan
 * steps of the raw values (not the stored compensated values): a smaller
 * length removes the values that leave the window oldest-first; a larger
 * length adds back the values from the one before the old window down to the
 * one `length` values back, newest first.
 */
export class RunningSum {
  private readonly values: number[] = [];
  private readonly stored: number[] = [];
  private keptLength = Number.NaN;
  private s = 0;
  private c = 0;
  private stepLength = Number.NaN;
  private stepX = Number.NaN;
  private stepY = 0;
  private stepS = 0;
  private stepC = 0;

  /** Kahan steps that move the kept sum from the kept length to `len`. */
  private resize(len: number): void {
    const values = this.values;
    const n = values.length;
    const kept = this.keptLength;
    let s = this.s;
    let c = this.c;
    const add = (v: number): void => {
      const y = v - c;
      const t = s + y;
      c = t - s - y;
      s = t;
    };
    if (len < kept) {
      for (let k = Math.max(0, n - kept); k <= n - len - 1; k += 1) add(-values[k]!);
    } else if (len > kept) {
      for (let k = n - kept - 1; k >= Math.max(0, n - len); k -= 1) add(values[k]!);
    }
    this.stepS = s;
    this.stepC = c;
  }

  /**
   * The running sum of the last `length` values with the (not na) value `x`
   * added, from the kept state; the state is unchanged until `commit()`.
   *
   * @returns The sum, or NaN while fewer than `length` values exist (with `x`).
   */
  step(x: number, length: number): number {
    const len = length;
    const values = this.values;
    this.resize(len);
    let s = this.stepS;
    let c = this.stepC;
    const c0 = c;
    const n = values.length;
    if (n >= len) {
      const y = -this.stored[n - len]! - c;
      const t = s + y;
      c = t - s - y;
      s = t;
    }
    if (compensationLost(x, c0)) {
      let fresh = x;
      for (let k = n - 1; k >= Math.max(0, n + 1 - len); k -= 1) fresh += values[k]!;
      s = fresh;
      c = 0;
      this.stepY = x;
    } else {
      const y = x - c;
      const t = s + y;
      c = t - s - y;
      s = t;
      this.stepY = y;
    }
    this.stepLength = len;
    this.stepX = x;
    this.stepS = s;
    this.stepC = c;
    return n + 1 >= len ? s : Number.NaN;
  }

  /**
   * The running sum of the last `length` values on a bar with an na value
   * (no value added), from the kept state; the state is unchanged until
   * `commit()`. With an unchanged length, the result is the previous sum.
   *
   * @returns The sum, or NaN while fewer than `length` values exist.
   */
  stepNa(length: number): number {
    this.resize(length);
    this.stepLength = length;
    this.stepX = Number.NaN;
    const n = this.values.length;
    return n > 0 && n >= length ? this.stepS : Number.NaN;
  }

  /** Keeps the state of the last `step` or `stepNa`. */
  commit(): void {
    if (!Number.isNaN(this.stepX)) {
      this.values.push(this.stepX);
      this.stored.push(this.stepY);
    }
    this.keptLength = this.stepLength;
    this.s = this.stepS;
    this.c = this.stepC;
  }

  /** The number of values currently committed (excludes the pending step). */
  get committedCount(): number {
    return this.values.length;
  }

  /** The committed sum (excludes the pending step). */
  get committedSum(): number {
    return this.s;
  }
}

/**
 * Variance from the running sums of the values and of their squares, as
 * PineScript computes it: biased `sumSq / n - mean * mean`, unbiased
 * `sumSq / (n - 1) - mean * sum / (n - 1)` with `mean = sum / n`.
 *
 * @param sum - The running sum of the values.
 * @param sumSq - The running sum of the squares of the values.
 * @param length - The window length.
 * @param biased - true for population variance, false for sample.
 */
export const varianceFromSums = (
  sum: number,
  sumSq: number,
  length: number,
  biased: boolean,
): number => {
  const mean = sum / length;
  return biased ? sumSq / length - mean * mean : sumSq / (length - 1) - (mean * sum) / (length - 1);
};
