import { describe, expect, it } from "vitest";
import { PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";
import * as matrix from "../src/matrix/index.js";
import * as array from "../src/array/index.js";

const testInfo: SymbolInfo = {
  ticker: "TEST",
  minTick: 0.01,
  timezone: "UTC",
};

class TestProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => this.bars;

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> => testInfo;
}

const runWithBars = async (bars: readonly Bar[], script: PineScript): Promise<void> => {
  const runtime = new PineRuntime({
    provider: new TestProvider(bars),
    symbol: "TEST",
    timeframe: "1m",
  });
  await runtime.run(script, bars);
};

describe("matrix creation and basic access", () => {
  it("creates and inspects matrix dimensions", () => {
    const m = matrix.new_matrix<number>(2, 3, 5);
    expect(matrix.rows(m)).toBe(2);
    expect(matrix.columns(m)).toBe(3);
    expect(matrix.elements_count(m)).toBe(6);
    expect(matrix.get(m, 0, 0)).toBe(5);
    expect(matrix.get(m, 1, 2)).toBe(5);

    matrix.set(m, 1, 2, 99);
    expect(matrix.get(m, 1, 2)).toBe(99);
  });

  it("extracts and manipulates rows and columns", () => {
    const m = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(m, 0, 0, 1);
    matrix.set(m, 0, 1, 2);
    matrix.set(m, 1, 0, 3);
    matrix.set(m, 1, 1, 4);

    const r0 = matrix.row(m, 0);
    expect(array.get(r0, 0)).toBe(1);
    expect(array.get(r0, 1)).toBe(2);

    const c1 = matrix.col(m, 1);
    expect(array.get(c1, 0)).toBe(2);
    expect(array.get(c1, 1)).toBe(4);

    matrix.swap_rows(m, 0, 1);
    expect(matrix.get(m, 0, 0)).toBe(3);
    expect(matrix.get(m, 1, 0)).toBe(1);

    matrix.swap_columns(m, 0, 1);
    expect(matrix.get(m, 0, 0)).toBe(4);
  });

  it("supports add_row, add_col, remove_row, remove_col", () => {
    const m = matrix.new_matrix<number>(1, 2, 10);
    const newRow = array.from(20, 30);
    matrix.add_row(m, 1, newRow);
    expect(matrix.rows(m)).toBe(2);
    expect(matrix.get(m, 1, 1)).toBe(30);

    const newCol = array.from(99, 88);
    matrix.add_col(m, 2, newCol);
    expect(matrix.columns(m)).toBe(3);
    expect(matrix.get(m, 0, 2)).toBe(99);

    const removedCol = matrix.remove_col(m, 2);
    expect(array.get(removedCol, 0)).toBe(99);
    expect(matrix.columns(m)).toBe(2);

    const removedRow = matrix.remove_row(m, 1);
    expect(array.get(removedRow, 0)).toBe(20);
    expect(matrix.rows(m)).toBe(1);
  });
});

describe("matrix transformations and statistics", () => {
  it("supports copy, fill, submatrix, reshape, reverse, concat", () => {
    const m = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(m, 0, 0, 1);
    matrix.set(m, 0, 1, 2);
    matrix.set(m, 1, 0, 3);
    matrix.set(m, 1, 1, 4);

    const sub = matrix.submatrix(m, 0, 1, 0, 1);
    expect(matrix.rows(sub)).toBe(1);
    expect(matrix.columns(sub)).toBe(1);
    expect(matrix.get(sub, 0, 0)).toBe(1);

    const cloned = matrix.copy(m);
    matrix.fill(cloned, 7);
    expect(matrix.get(cloned, 0, 0)).toBe(7);
    expect(matrix.get(cloned, 1, 1)).toBe(7);
    expect(matrix.get(m, 0, 0)).toBe(1); // original untouched

    matrix.reshape(m, 4, 1);
    expect(matrix.rows(m)).toBe(4);
    expect(matrix.columns(m)).toBe(1);

    matrix.reverse(m);
    expect(matrix.get(m, 0, 0)).toBe(4);
  });

  it("calculates statistics: avg, min, max, sum, median, mode", () => {
    const m = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(m, 0, 0, 10);
    matrix.set(m, 0, 1, 20);
    matrix.set(m, 1, 0, 20);
    matrix.set(m, 1, 1, 30);

    expect(matrix.min(m)).toBe(10);
    expect(matrix.max(m)).toBe(30);
    expect(matrix.sum(m)).toBe(80);
    expect(matrix.avg(m)).toBeCloseTo(20, 4);
    expect(matrix.median(m)).toBeCloseTo(20, 4);
    expect(matrix.mode(m)).toBe(20);
  });
});

describe("matrix linear algebra and predicates", () => {
  it("evaluates predicates: is_square, is_identity, is_zero, is_symmetric", () => {
    const idMat = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(idMat, 0, 0, 1);
    matrix.set(idMat, 1, 1, 1);

    expect(matrix.is_square(idMat)).toBe(true);
    expect(matrix.is_identity(idMat)).toBe(true);
    expect(matrix.is_zero(idMat)).toBe(false);
    expect(matrix.is_symmetric(idMat)).toBe(true);
    expect(matrix.is_diagonal(idMat)).toBe(true);
  });

  it("calculates determinant, trace, transpose, mult, inv, diff, pow", () => {
    const a = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(a, 0, 0, 4);
    matrix.set(a, 0, 1, 7);
    matrix.set(a, 1, 0, 2);
    matrix.set(a, 1, 1, 6);

    // det(a) = 4*6 - 7*2 = 24 - 14 = 10
    expect(matrix.det(a)).toBeCloseTo(10, 4);
    expect(matrix.trace(a)).toBe(10);

    const t = matrix.transpose(a);
    expect(matrix.get(t, 0, 1)).toBe(2);
    expect(matrix.get(t, 1, 0)).toBe(7);

    // inv(a) = 1/10 * [6 -7; -2 4]
    const invA = matrix.inv(a);
    expect(matrix.get(invA, 0, 0)).toBeCloseTo(0.6, 4);
    expect(matrix.get(invA, 0, 1)).toBeCloseTo(-0.7, 4);
    expect(matrix.get(invA, 1, 0)).toBeCloseTo(-0.2, 4);
    expect(matrix.get(invA, 1, 1)).toBeCloseTo(0.4, 4);

    // mult: a * invA = Identity
    const prod = matrix.mult(a, invA);
    expect(matrix.is_identity(prod)).toBe(true);

    const diffMat = matrix.diff(a, a);
    expect(matrix.is_zero(diffMat)).toBe(true);

    const powMat = matrix.pow(a, 2);
    const expectedPow = matrix.mult(a, a);
    expect(matrix.get(powMat, 0, 0)).toBe(matrix.get(expectedPow, 0, 0));

    expect(matrix.rank(a)).toBe(2);
    const pinvA = matrix.pinv(a);
    expect(matrix.get(pinvA, 0, 0)).toBeCloseTo(matrix.get(invA, 0, 0), 4);

    const idMat = matrix.new_matrix<number>(2, 2, 0);
    matrix.set(idMat, 0, 0, 1);
    matrix.set(idMat, 1, 1, 1);
    const kronMat = matrix.kron(a, idMat);
    expect(matrix.rows(kronMat)).toBe(4);
    expect(matrix.columns(kronMat)).toBe(4);

    const ev = matrix.eigenvalues(a);
    expect(array.size(ev)).toBe(2);
    const eigenVectors = matrix.eigenvectors(a);
    expect(matrix.rows(eigenVectors)).toBe(2);
  });

  it("sorts matrix rows by column", () => {
    const m = matrix.new_matrix<number>(3, 2, 0);
    matrix.set(m, 0, 0, 30);
    matrix.set(m, 1, 0, 10);
    matrix.set(m, 2, 0, 20);
    matrix.sort(m, 0, "asc");
    expect(matrix.get(m, 0, 0)).toBe(10);
    expect(matrix.get(m, 1, 0)).toBe(20);
    expect(matrix.get(m, 2, 0)).toBe(30);
  });
});

describe("matrix realtime rollback integration", () => {
  it("rolls back intrabar var matrix mutations on revised realtime ticks", async () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 10, low: 10, close: 10, volume: 100, isClosed: true },
      { time: 2000, open: 12, high: 12, low: 12, close: 12, volume: 100, isClosed: false },
    ];

    let lastVal = 0;
    await runWithBars(bars, (ctx) => {
      const m = ctx.state.var("trackedMatrix", () => matrix.new_matrix<number>(2, 2, 0));
      matrix.set(m.value, 0, 0, ctx.close.value);
      lastVal = matrix.get(m.value, 0, 0);
    });

    expect(lastVal).toBe(12);
  });
});
