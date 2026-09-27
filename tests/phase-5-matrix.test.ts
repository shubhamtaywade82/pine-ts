import { describe, expect, it } from "vitest";
import { array, matrix, order, PineRuntime } from "../src/index.js";
import type { Bar, MarketDataProvider, PineScript, SymbolInfo } from "../src/index.js";

const info: SymbolInfo = { ticker: "TEST", timezone: "UTC", type: "crypto", minTick: 0.25 };

const makeBars = (count: number): Bar[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index + 1,
    open: 10 + index,
    high: 12 + index,
    low: 8 + index,
    close: 11 + index,
    volume: 100 + index,
    isClosed: true,
  }));

const fromRows = (rows: number[][]): matrix.PineMatrix<number> => {
  const m = matrix.newMatrix<number>(rows.length, rows[0]!.length);
  rows.forEach((row, r) => row.forEach((value, c) => matrix.set(m, r, c, value)));
  return m;
};

const elements = (m: matrix.PineMatrix<number>): Array<Array<number | null>> =>
  m
    .toArray2D()
    .map((row) => row.map((value) => (value === undefined || Number.isNaN(value) ? null : value)));

describe("Phase 5 — matrix construction and element access", () => {
  it("creates typed matrices with na fill and validates dimensions", () => {
    const f = matrix.newFloat(2, 3);
    expect(matrix.rows(f)).toBe(2);
    expect(matrix.columns(f)).toBe(3);
    expect(matrix.get(f, 0, 0)).toBeNaN();
    const z = matrix.newInt(2, 3, 0);
    expect(matrix.get(z, 1, 2)).toBe(0);
    expect(() => matrix.newFloat(-1, 3)).toThrow(/negative dimensions/);
    expect(() => matrix.newFloat(400, 400)).toThrow(/Maximum size is 100000/);
    const empty = matrix.newMatrix<number>();
    expect(matrix.rows(empty)).toBe(0);
    expect(matrix.columns(empty)).toBe(0);
    expect(matrix.elements_count(empty)).toBe(0);
  });

  it("gets and sets with strict bounds errors", () => {
    const m = matrix.newMatrix<number>(2, 3, 0);
    matrix.set(m, 0, 1, 3);
    expect(matrix.get(m, 0, 1)).toBe(3);
    expect(() => matrix.get(m, 2, 0)).toThrow(/out of bounds/);
    expect(() => matrix.set(m, 0, -1, 1)).toThrow(/out of bounds/);
    expect(() => matrix.get(m, 0, 3)).toThrow(/Matrix size is 2x3/);
  });

  it("rows, columns, elements_count and row/col array copies", () => {
    const m = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(matrix.rows(m)).toBe(2);
    expect(matrix.columns(m)).toBe(3);
    expect(matrix.elements_count(m)).toBe(6);
    expect(matrix.row(m, 0).toArray()).toEqual([1, 2, 3]);
    expect(matrix.col(m, 2).toArray()).toEqual([3, 6]);
    const row = matrix.row(m, 0);
    row.set(0, 99);
    expect(matrix.get(m, 0, 0)).toBe(1);
    expect(() => matrix.row(m, 2)).toThrow(/out of bounds/);
    expect(() => matrix.col(m, 3)).toThrow(/out of bounds/);
  });
});

describe("Phase 5 — matrix structural edits", () => {
  it("bootstraps an empty matrix through add_row and add_col", () => {
    const m = matrix.newMatrix<number>();
    matrix.add_row(m, 0, array.from(5, 6, 7));
    expect([matrix.rows(m), matrix.columns(m)]).toEqual([1, 3]);
    matrix.add_row(m, 1, array.from(9, 10, 11));
    matrix.add_row(m, 0, array.from(1, 2, 3));
    matrix.add_col(m, 3, array.from(4, 8, 12));
    matrix.add_row(m, 3, array.from(13, 14, 15, 16));
    expect(elements(m)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ]);
  });

  it("add_col on an empty matrix sets the row count", () => {
    const m = matrix.newMatrix<number>();
    matrix.add_col(m, 0, array.from(1, 3));
    expect([matrix.rows(m), matrix.columns(m)]).toEqual([2, 1]);
    expect(elements(m)).toEqual([[1], [3]]);
  });

  it("inserts na rows and columns by default", () => {
    const m = fromRows([
      [1, 2],
      [3, 4],
    ]);
    matrix.add_row(m);
    expect(matrix.rows(m)).toBe(3);
    expect(matrix.get(m, 2, 0)).toBeUndefined();
    matrix.add_col(m, 0);
    expect(matrix.columns(m)).toBe(3);
    expect(matrix.get(m, 0, 0)).toBeUndefined();
    expect(matrix.get(m, 0, 1)).toBe(1);
  });

  it("validates array sizes and insertion indices", () => {
    const m = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(() => matrix.add_row(m, 0, array.from(1, 2, 3))).toThrow(
      /does not match matrix columns 2/,
    );
    expect(() => matrix.add_col(m, 0, array.from(1, 2, 3))).toThrow(/does not match matrix rows 2/);
    expect(() => matrix.add_row(m, 3, array.from(1, 2))).toThrow(/out of bounds/);
    expect(() => matrix.add_col(m, 3)).toThrow(/out of bounds/);
  });

  it("remove_row and remove_col return the removed elements", () => {
    const m = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(matrix.remove_row(m, 0).toArray()).toEqual([1, 2]);
    expect(elements(m)).toEqual([[3, 4]]);
    expect(matrix.remove_col(m).toArray()).toEqual([4]);
    expect(elements(m)).toEqual([[3]]);
    expect(() => matrix.remove_col(m, 5)).toThrow(/out of bounds/);
  });

  it("swaps rows and columns without changing dimensions", () => {
    const m = fromRows([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    matrix.swap_rows(m, 0, 2);
    expect(elements(m)).toEqual([
      [7, 8, 9],
      [4, 5, 6],
      [1, 2, 3],
    ]);
    matrix.swap_columns(m, 0, 2);
    expect(elements(m)).toEqual([
      [9, 8, 7],
      [6, 5, 4],
      [3, 2, 1],
    ]);
    expect(() => matrix.swap_rows(m, 0, 3)).toThrow(/out of bounds/);
  });

  it("fills rectangular [from, to) ranges", () => {
    const m = matrix.newMatrix<number>(4, 5, 0);
    matrix.fill(m, 7, 0, 2, 1, 3);
    expect(elements(m)).toEqual([
      [0, 7, 7, 0, 0],
      [0, 7, 7, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    matrix.fill(m, 1);
    expect(matrix.get(m, 3, 4)).toBe(1);
    expect(() => matrix.fill(m, 1, 0, 9, 0, 1)).toThrow(/out of bounds/);
  });

  it("copy and submatrix are independent shallow copies", () => {
    const m = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const duplicate = matrix.copy(m);
    matrix.set(duplicate, 0, 0, 99);
    expect(matrix.get(m, 0, 0)).toBe(1);
    const sub = matrix.submatrix(m, 0, 2, 1, 3);
    expect(elements(sub)).toEqual([
      [2, 3],
      [5, 6],
    ]);
    matrix.set(sub, 0, 0, 42);
    expect(matrix.get(m, 0, 1)).toBe(2);
    expect(elements(matrix.submatrix(m))).toEqual(elements(m));
  });

  it("concat appends rows onto id1 and requires matching columns", () => {
    const a = fromRows([
      [1, 2],
      [3, 4],
    ]);
    const b = fromRows([
      [5, 6],
      [7, 8],
    ]);
    const result = matrix.concat(a, b);
    expect(result).toBe(a);
    expect(elements(a)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
    const wide = fromRows([[1, 2, 3]]);
    expect(() => matrix.concat(a, wide)).toThrow(/different column counts/);
  });

  it("reshape preserves row-major order and validates the count", () => {
    const m = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    matrix.reshape(m, 3, 2);
    expect(elements(m)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(() => matrix.reshape(m, 2, 4)).toThrow(/Cannot reshape/);
  });

  it("reverse rotates the matrix 180 degrees", () => {
    const m = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    matrix.reverse(m);
    expect(elements(m)).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ]);
  });

  it("sorts rows by a key column with na sinking to the end", () => {
    const m = fromRows([
      [3, 30],
      [1, 10],
      [Number.NaN, 40],
      [2, 20],
    ]);
    matrix.sort(m, 0);
    expect(elements(m)).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
      [null, 40],
    ]);
    matrix.sort(m, 0, order.descending);
    expect(elements(m)).toEqual([
      [3, 30],
      [2, 20],
      [1, 10],
      [null, 40],
    ]);
    expect(() => matrix.sort(m, 9)).toThrow(/out of bounds/);
  });

  it("sorts string matrices lexicographically", () => {
    const m = matrix.newMatrix<string>(2, 1);
    matrix.set(m, 0, 0, "banana");
    matrix.set(m, 1, 0, "apple");
    matrix.sort(m, 0);
    expect(matrix.get(m, 0, 0)).toBe("apple");
  });
});

describe("Phase 5 — matrix statistics", () => {
  it("avg, min, max, median, mode skip na; empty or all-na yields na", () => {
    const m = fromRows([
      [1, Number.NaN],
      [3, 1],
    ]);
    expect(matrix.avg(m)).toBeCloseTo(5 / 3, 12);
    expect(matrix.min(m)).toBe(1);
    expect(matrix.max(m)).toBe(3);
    expect(matrix.median(m)).toBe(1);
    const ties = fromRows([
      [0, 0],
      [1, 1],
    ]);
    expect(matrix.mode(ties)).toBe(0);
    expect(matrix.avg(matrix.newMatrix<number>())).toBeNaN();
    expect(matrix.min(matrix.newFloat(2, 2))).toBeNaN();
    const even = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(matrix.median(even)).toBe(2.5);
  });

  it("trace sums the main diagonal", () => {
    const m = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(matrix.trace(m)).toBe(5);
    const rect = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(matrix.trace(rect)).toBe(6);
  });

  it("sum and diff work element-wise with na propagation", () => {
    const a = fromRows([
      [5, Number.NaN],
      [5, 5],
    ]);
    const b = fromRows([
      [4, 4],
      [4, 4],
    ]);
    expect(elements(matrix.sum(a, b))).toEqual([
      [9, null],
      [9, 9],
    ]);
    expect(elements(matrix.diff(a, 1))).toEqual([
      [4, null],
      [4, 4],
    ]);
    expect(elements(matrix.sum(a, 2))).toEqual([
      [7, null],
      [7, 7],
    ]);
    expect(() => matrix.diff(a, fromRows([[1, 2]]))).toThrow(/different dimensions/);
  });
});

describe("Phase 5 — matrix linear algebra", () => {
  it("transposes and multiplies matrices", () => {
    const a = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(elements(matrix.transpose(a))).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(elements(matrix.mult(a, a) as matrix.PineMatrix<number>)).toEqual([
      [7, 10],
      [15, 22],
    ]);
    expect(elements(matrix.mult(a, 2) as matrix.PineMatrix<number>)).toEqual([
      [2, 4],
      [6, 8],
    ]);
    expect((matrix.mult(a, array.from(1, 0)) as array.FloatArray).toArray()).toEqual([1, 3]);
    const tall = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(() => matrix.mult(tall, tall)).toThrow(/incompatible dimensions/);
  });

  it("computes the determinant (LU) including singular zero", () => {
    expect(
      matrix.det(
        fromRows([
          [3, 7],
          [1, -4],
        ]),
      ),
    ).toBe(-19);
    expect(
      matrix.det(
        fromRows([
          [1, 2],
          [2, 4],
        ]),
      ),
    ).toBe(0);
    expect(
      matrix.det(
        fromRows([
          [2, 0, 0],
          [0, 3, 0],
          [0, 0, 4],
        ]),
      ),
    ).toBe(24);
    expect(() =>
      matrix.det(
        fromRows([
          [1, 2, 3],
          [4, 5, 6],
        ]),
      ),
    ).toThrow(/non-square/);
  });

  it("inverts matrices and rejects singular input", () => {
    const inv = matrix.inv(
      fromRows([
        [1, 2],
        [3, 4],
      ]),
    );
    expect(matrix.get(inv, 0, 0)).toBeCloseTo(-2, 12);
    expect(matrix.get(inv, 0, 1)).toBeCloseTo(1, 12);
    expect(matrix.get(inv, 1, 0)).toBeCloseTo(1.5, 12);
    expect(matrix.get(inv, 1, 1)).toBeCloseTo(-0.5, 12);
    expect(() =>
      matrix.inv(
        fromRows([
          [1, 2],
          [2, 4],
        ]),
      ),
    ).toThrow(/singular/);
  });

  it("pinv matches inv for non-singular input and handles any shape", () => {
    const a = fromRows([
      [1, 2],
      [3, 4],
    ]);
    const inv = matrix.inv(a).toArray2D();
    const pseudo = matrix.pinv(a).toArray2D();
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        expect(Math.abs((inv[r]![c] as number) - (pseudo[r]![c] as number))).toBeLessThan(1e-9);
      }
    }
    const singular = fromRows([
      [1, 2],
      [2, 4],
    ]);
    const singularPinv = matrix.pinv(singular);
    expect(matrix.get(singularPinv, 0, 0)).toBeCloseTo(0.04, 12);
    expect(matrix.get(singularPinv, 0, 1)).toBeCloseTo(0.08, 12);
    expect(matrix.get(singularPinv, 1, 1)).toBeCloseTo(0.16, 12);
    const wide = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    // A A+ is the projection onto the column space of A (the 2x2 identity
    // here, since the wide matrix has full row rank).
    const projection = matrix.mult(wide, matrix.pinv(wide)) as matrix.PineMatrix<number>;
    expect(matrix.get(projection, 0, 0)).toBeCloseTo(1, 9);
    expect(matrix.get(projection, 0, 1)).toBeCloseTo(0, 9);
    expect(matrix.get(projection, 1, 0)).toBeCloseTo(0, 9);
    expect(matrix.get(projection, 1, 1)).toBeCloseTo(1, 9);
  });

  it("computes rank, kron, and pow", () => {
    expect(
      matrix.rank(
        fromRows([
          [1, 2],
          [2, 4],
        ]),
      ),
    ).toBe(1);
    expect(
      matrix.rank(
        fromRows([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toBe(2);
    const a = fromRows([
      [1, 2],
      [3, 4],
    ]);
    expect(elements(matrix.kron(a, a))).toEqual([
      [1, 2, 2, 4],
      [3, 4, 6, 8],
      [3, 6, 4, 8],
      [9, 12, 12, 16],
    ]);
    expect(elements(matrix.pow(a, 3))).toEqual([
      [37, 54],
      [81, 118],
    ]);
    expect(elements(matrix.pow(a, 0))).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(() => matrix.pow(a, -1)).toThrow(/non-negative integer/);
  });

  it("eigenvalues and eigenvectors (Implicit QL) match known results", () => {
    const m = fromRows([
      [2, 1],
      [1, 3],
    ]);
    const values = matrix.eigenvalues(m).toArray();
    expect(values[0]).toBeCloseTo((5 - Math.sqrt(5)) / 2, 12);
    expect(values[1]).toBeCloseTo((5 + Math.sqrt(5)) / 2, 12);
    const vecs = matrix.eigenvectors(m);
    // Every column v satisfies A v = lambda v.
    for (let c = 0; c < 2; c += 1) {
      for (let r = 0; r < 2; r += 1) {
        const av =
          (matrix.get(m, r, 0) ?? 0) * (matrix.get(vecs, 0, c) ?? 0) +
          (matrix.get(m, r, 1) ?? 0) * (matrix.get(vecs, 1, c) ?? 0);
        expect(Math.abs(av - values[c]! * (matrix.get(vecs, r, c) ?? 0))).toBeLessThan(1e-12);
      }
    }
    expect(() =>
      matrix.eigenvalues(
        fromRows([
          [1, 2, 3],
          [4, 5, 6],
        ]),
      ),
    ).toThrow(/non-square/);
  });

  it("eigenvector columns are orthonormal for a symmetric input", () => {
    const m = fromRows([
      [4, 1, 0],
      [1, 5, 2],
      [0, 2, 6],
    ]);
    const vecs = matrix.eigenvectors(m);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let dot = 0;
        for (let r = 0; r < 3; r += 1) {
          dot += (matrix.get(vecs, r, i) ?? 0) * (matrix.get(vecs, r, j) ?? 0);
        }
        expect(Math.abs(dot - (i === j ? 1 : 0))).toBeLessThan(1e-12);
      }
    }
  });
});

describe("Phase 5 — matrix predicates", () => {
  it("classifies square, identity, diagonal, and antidiagonal matrices", () => {
    expect(
      matrix.is_square(
        fromRows([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_square(
        fromRows([
          [1, 2, 3],
          [4, 5, 6],
        ]),
      ),
    ).toBe(false);
    expect(
      matrix.is_identity(
        fromRows([
          [1, 0],
          [0, 1],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_identity(
        fromRows([
          [1, 0],
          [0, 2],
        ]),
      ),
    ).toBe(false);
    expect(
      matrix.is_diagonal(
        fromRows([
          [1, 0],
          [0, 2],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_antidiagonal(
        fromRows([
          [0, 1],
          [2, 0],
        ]),
      ),
    ).toBe(true);
    // Non-square predicates return false per the reference remarks.
    expect(matrix.is_identity(fromRows([[1, 0]]))).toBe(false);
    expect(matrix.is_diagonal(fromRows([[1, 0]]))).toBe(false);
  });

  it("classifies symmetric, antisymmetric, triangular, zero, binary, stochastic", () => {
    expect(
      matrix.is_symmetric(
        fromRows([
          [1, 2],
          [2, 1],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_symmetric(
        fromRows([
          [1, 2],
          [3, 1],
        ]),
      ),
    ).toBe(false);
    expect(
      matrix.is_antisymmetric(
        fromRows([
          [0, 1],
          [-1, 0],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_antisymmetric(
        fromRows([
          [0, 1],
          [1, 0],
        ]),
      ),
    ).toBe(false);
    expect(
      matrix.is_triangular(
        fromRows([
          [1, 2],
          [0, 3],
        ]),
      ),
    ).toBe(true);
    expect(matrix.is_zero(matrix.newInt(2, 2, 0))).toBe(true);
    expect(matrix.is_zero(matrix.newInt(2, 2, 1))).toBe(false);
    expect(
      matrix.is_binary(
        fromRows([
          [0, 1],
          [1, 0],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_binary(
        fromRows([
          [0, 2],
          [1, 0],
        ]),
      ),
    ).toBe(false);
    expect(
      matrix.is_stochastic(
        fromRows([
          [0.25, 0.75],
          [0.5, 0.5],
        ]),
      ),
    ).toBe(true);
    expect(
      matrix.is_stochastic(
        fromRows([
          [0.25, 0.5],
          [0.5, 0.5],
        ]),
      ),
    ).toBe(false);
    // na elements disqualify the numeric predicates.
    const withNa = matrix.newFloat(2, 2);
    matrix.set(withNa, 0, 0, 0);
    expect(matrix.is_zero(withNa)).toBe(false);
    expect(matrix.is_binary(withNa)).toBe(false);
    expect(matrix.is_stochastic(withNa)).toBe(false);
  });
});

describe("Phase 5 — matrix runtime integration (var, varip, rollback)", () => {
  const tickBars = (index: number): Bar[] => [
    { ...makeBars(2)[index]!, isClosed: false },
    { ...makeBars(2)[index]!, high: 99, isClosed: false },
    { ...makeBars(2)[index]!, high: 100, isClosed: true },
  ];

  class StreamProvider implements MarketDataProvider {
    public constructor(
      private readonly history: readonly Bar[],
      private readonly stream: readonly Bar[],
    ) {}
    public getHistoricalBars = async (): Promise<readonly Bar[]> => this.history;
    public streamBars = (): AsyncIterable<Bar> => {
      const stream = this.stream;
      return {
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<Bar> {
          yield* stream;
        },
      };
    };
    public getSymbolInfo = async (): Promise<SymbolInfo> => info;
  }

  it("rolls var matrix mutations back on realtime revisions", async () => {
    const observations: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("m", () => matrix.newFloat(2, 2, 0));
      const m = cell.value;
      matrix.set(m, 0, 0, ctx.close.value);
      matrix.fill(m, 9, 1, 2, 0, 1);
      observations.push(`${matrix.get(m, 0, 0)}:${matrix.get(m, 1, 0)}`);
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    // bar 0 commits [[11, 0], [9, 0]]; each revision replays the set and
    // fill from that committed state, so every observation matches.
    expect(observations).toEqual(["11:9", "12:9", "12:9", "12:9"]);
  });

  it("keeps varip matrix mutations across revisions", async () => {
    const observations: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.varip("m", () => matrix.newFloat(0, 0));
      const m = cell.value;
      matrix.add_row(m, 0, array.from(ctx.close.value));
      observations.push(`${matrix.rows(m)}x${matrix.columns(m)}`);
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    expect(observations).toEqual(["1x1", "2x1", "3x1", "4x1"]);
  });

  it("undoes sort and row swaps on rollback", async () => {
    const observations: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("m", () => matrix.newFloat(2, 2, 1));
      const m = cell.value;
      matrix.set(m, 0, 0, ctx.close.value);
      matrix.sort(m, 0, order.descending);
      matrix.swap_rows(m, 0, 1);
      observations.push(`${matrix.get(m, 0, 0)}:${matrix.get(m, 1, 0)}`);
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    // bar 0: [[11,1],[1,1]] -> sort desc (stable) -> swap -> [[1,1],[11,1]].
    // Each revision: set [0,0]=12, sort desc, swap -> [[11,1],[12,1]].
    expect(observations).toEqual(["1:11", "11:12", "11:12", "11:12"]);
  });

  it("undoes shape-changing edits (remove_col, add_row) on rollback", async () => {
    const observations: string[] = [];
    const script: PineScript = (ctx) => {
      const cell = ctx.state.var("m", () => matrix.newFloat(2, 2, 0));
      const m = cell.value;
      if (ctx.barstate.isFirst) {
        matrix.set(m, 0, 0, 5);
        matrix.remove_col(m, 1);
        matrix.add_row(m, 0, array.from(7));
      }
      matrix.set(m, 2, 0, ctx.close.value);
      observations.push(
        `${matrix.rows(m)}x${matrix.columns(m)}:${matrix.get(m, 0, 0)}:${matrix.get(m, 2, 0)}`,
      );
    };
    const runtime = new PineRuntime({
      provider: new StreamProvider(makeBars(1), tickBars(1)),
      symbol: "TEST",
      timeframe: "1m",
    });
    await runtime.run(script, makeBars(1));
    await runtime.runRealtime(script);
    // bar 0 commits the 3x1 [[7],[5],[0]]; revisions only rewrite the last
    // row and must still see the restored shape.
    expect(observations).toEqual(["3x1:7:11", "3x1:7:12", "3x1:7:12", "3x1:7:12"]);
  });
});
