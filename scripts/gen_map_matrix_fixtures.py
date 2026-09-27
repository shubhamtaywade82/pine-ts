#!/usr/bin/env python3
"""Double-entry fixture generator for the map.* and matrix.* namespaces.

Independent Python mirrors (plain dicts in insertion order, plain
list-of-lists matrix logic, and numpy/LAPACK for the linear algebra)
compute the expected values; scripts/verify-fixtures.ts replays the same
operations against the pine-ts implementation and compares.

Outputs into fixtures/v6/map/ and fixtures/v6/matrix/.
"""

from __future__ import annotations

import json
import math
import os

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..", "fixtures", "v6")
MAP_DIR = os.path.join(ROOT, "map")
MATRIX_DIR = os.path.join(ROOT, "matrix")

NA = None  # JSON null encodes Pine na inside element lists


def dump(name: str, directory: str, payload: dict) -> None:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{name}.basic.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
        handle.write("\n")
    print(f"wrote {path}")


# ---------------------------------------------------------------------------
# map fixtures
# ---------------------------------------------------------------------------


def mirror_map_ops(ops: list) -> list:
    """Mirror of the map op protocol over a plain (insertion-ordered) dict."""
    state: dict[str, float] = {}
    observations = []
    for op in ops:
        result = NA
        kind = op[0]
        if kind == "put":
            key, value = op[1], op[2]
            result = state.get(key, NA)
            state[key] = value
        elif kind == "remove":
            result = state.pop(op[1], NA)
        elif kind == "get":
            result = state.get(op[1], NA)
        elif kind == "contains":
            result = op[1] in state
        elif kind == "size":
            result = len(state)
        elif kind == "clear":
            state.clear()
        elif kind == "keys":
            result = list(state.keys())
        elif kind == "values":
            result = list(state.values())
        elif kind == "put_all":
            for key, value in op[1]:
                state[key] = value
        elif kind == "copy_put":
            # Simulates: b = copy(m); put into b; observe the original.
            copy = dict(state)
            copy[op[1]] = op[2]
            result = len(copy)
        observations.append([normalize(result), [[k, v] for k, v in state.items()]])
    return observations


def normalize(value):
    if isinstance(value, float) and math.isnan(value):
        return NA
    return value


def build_map_ops_fixture() -> dict:
    cases = [
        {
            "ops": [
                ["put", "a", 1],
                ["put", "b", 2],
                ["put", "a", 10],
                ["get", "a"],
                ["get", "zz"],
                ["contains", "b"],
                ["contains", "zz"],
                ["size"],
                ["keys"],
                ["values"],
                ["remove", "b"],
                ["remove", "zz"],
                ["size"],
            ]
        },
        {
            "ops": [
                ["put", "first", 10],
                ["put", "second", 15],
                ["put_all", [["second", 99], ["third", 20]]],
                ["keys"],
                ["values"],
                ["clear"],
                ["size"],
                ["contains", "first"],
            ]
        },
        {
            "ops": [
                ["put", "example", 1],
                ["copy_put", "extra", 3],
                ["size"],
                ["put", "example", 2],
                ["get", "example"],
            ]
        },
        {
            "ops": [
                ["put", "x", 1],
                ["remove", "x"],
                ["put", "x", 5],
                ["keys"],
                ["put", "y", 6],
                ["remove", "x"],
                ["keys"],
            ]
        },
    ]
    expected = [mirror_map_ops(case["ops"]) for case in cases]
    return {
        "name": "map.ops",
        "pineVersion": 6,
        "input": {"cases": cases},
        "expected": {"ops": expected},
    }


def build_map_limits_fixture() -> dict:
    cap = 50_000
    return {
        "name": "map.limits",
        "pineVersion": 6,
        "input": {"cases": [{"pairs": cap}]},
        "expected": {"limits": [[cap, "error"]]},
    }


# ---------------------------------------------------------------------------
# matrix fixtures
# ---------------------------------------------------------------------------


def mirror_matrix_ops(ops: list) -> list:
    """Mirror of the matrix op protocol over plain lists of lists."""
    rows: list[list] = []
    observations = []
    for op in ops:
        kind = op[0]
        result = NA
        if kind == "new":
            height, width, initial = op[1], op[2], op[3]
            fill = float("nan") if initial is NA else initial
            rows = [[fill] * width for _ in range(height)]
        elif kind == "set":
            rows[op[1]][op[2]] = float("nan") if op[3] is NA else op[3]
        elif kind == "add_row":
            index, values = op[1], op[2]
            if values is NA:
                width = len(rows[0]) if rows else 0
                values = [float("nan")] * width
            else:
                values = dena(values)
            if not rows:
                rows.append(list(values))
            else:
                rows.insert(len(rows) if index is NA else index, list(values))
        elif kind == "add_col":
            index, values = op[1], op[2]
            if values is NA:
                values = [float("nan")] * len(rows)
            else:
                values = dena(values)
            if not rows:
                rows = [[value] for value in values]
            else:
                at = len(rows[0]) if index is NA else index
                for row, value in zip(rows, values):
                    row.insert(at, value)
        elif kind == "remove_row":
            index = op[1]
            at = len(rows) - 1 if index is NA else index
            result = rows.pop(at)
        elif kind == "remove_col":
            index = op[1]
            at = len(rows[0]) - 1 if index is NA else index
            result = [row.pop(at) for row in rows]
        elif kind == "swap_rows":
            rows[op[1]], rows[op[2]] = rows[op[2]], rows[op[1]]
        elif kind == "swap_columns":
            for row in rows:
                row[op[1]], row[op[2]] = row[op[2]], row[op[1]]
        elif kind == "fill":
            value, r0, r1, c0, c1 = op[1], op[2], op[3], op[4], op[5]
            r_end = len(rows) if r1 is NA else r1
            c_end = len(rows[0]) if c1 is NA else c1
            for row in rows[r0:r_end]:
                row[c0:c_end] = [value] * (c_end - c0)
        elif kind == "reverse":
            rows = [list(reversed(row)) for row in reversed(rows)]
        elif kind == "reshape":
            height, width = op[1], op[2]
            flat = [value for row in rows for value in row]
            rows = [flat[r * width : (r + 1) * width] for r in range(height)]
        elif kind == "sort":
            column, direction = op[1], op[2]
            na_rows = [row for row in rows if is_na(row[column])]
            ordered = [row for row in rows if not is_na(row[column])]
            ordered.sort(
                key=lambda row: row[column] if direction == "ascending" else -row[column]
            )
            rows = ordered + na_rows
        elif kind == "concat":
            for extra in op[1]:
                rows.append(list(dena(extra)))
        elif kind == "row":
            result = list(rows[op[1]])
        elif kind == "col":
            result = [row[op[1]] for row in rows]
        elif kind == "copy_set":
            # Simulates: b = copy(m); set on b; observe the original.
            copy = [list(row) for row in rows]
            copy[op[1]][op[2]] = op[3]
            result = rows[op[4]][op[5]]
        elif kind == "submatrix":
            r0, r1, c0, c1 = op[1], op[2], op[3], op[4]
            r_end = len(rows) if r1 is NA else r1
            c_end = len(rows[0]) if c1 is NA else c1
            result = [row[c0:c_end] for row in rows[r0:r_end]]
        observations.append([dump_value(result), dump_rows(rows)])
    return observations


def dena(values):
    return [float("nan") if value is NA else value for value in values]


def is_na(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def dump_value(value):
    if isinstance(value, list):
        return [normalize(entry) if not isinstance(entry, list) else dump_value(entry) for entry in value]
    return normalize(value)


def dump_rows(rows):
    return [[normalize(value) for value in row] for row in rows]


def build_matrix_structural_fixture() -> dict:
    cases = [
        {
            # The concept page's bootstrap sequence.
            "ops": [
                ["new", 0, 0, NA],
                ["add_row", 0, [5, 6, 7]],
                ["add_row", 1, [9, 10, 11]],
                ["add_row", 0, [1, 2, 3]],
                ["add_col", 3, [4, 8, 12]],
                ["add_row", 3, [13, 14, 15, 16]],
            ]
        },
        {
            "ops": [
                ["new", 0, 0, NA],
                ["add_col", 0, [1, 3]],
                ["add_col", NA, [4, 5]],
                ["row", 0],
                ["col", 0],
                ["add_row", NA, [5, 6]],
                ["remove_col", 1],
                ["remove_row", 0],
            ]
        },
        {
            "ops": [
                ["new", 3, 3, 0],
                ["set", 1, 1, 7],
                ["fill", 9, 0, 2, 1, 3],
                ["swap_rows", 0, 2],
                ["swap_columns", 0, 2],
                ["reverse"],
                ["reshape", 1, 9],
            ]
        },
        {
            "ops": [
                ["new", 4, 2, 0],
                ["set", 0, 0, 3],
                ["set", 1, 0, 1],
                ["set", 2, 0, NA],
                ["set", 3, 0, 2],
                ["sort", 0, "ascending"],
                ["sort", 0, "descending"],
            ]
        },
        {
            "ops": [
                ["new", 2, 2, 1],
                ["copy_set", 0, 0, 99, 0, 0],
                ["submatrix", 0, 2, 0, 1],
                ["concat", [[7, 7]]],
                ["remove_row", NA],
            ]
        },
        {
            "ops": [
                ["new", 2, 3, NA],
                ["set", 0, 0, 1],
                ["add_row", NA, NA],
                ["add_col", NA, NA],
                ["row", 2],
                ["col", 3],
            ]
        },
    ]
    expected = [mirror_matrix_ops(case["ops"]) for case in cases]
    return {
        "name": "matrix.structural",
        "pineVersion": 6,
        "input": {"cases": cases},
        "expected": {"ops": expected},
    }


def build_matrix_stats_fixture() -> dict:
    matrices = [
        [[1, NA], [3, 1]],
        [[1, 2, 3], [4, 5, 6]],
        [[NA, NA], [NA, NA]],
        [[7]],
        [[0, 0], [1, 1], [2, 2]],
        [[-5, 5], [NA, 10]],
    ]
    expected = []
    for values in matrices:
        flat = [v for row in values for v in row if not is_na(v)]
        if flat:
            avg = sum(flat) / len(flat)
            minimum = min(flat)
            maximum = max(flat)
            ordered = sorted(flat)
            middle = len(ordered) // 2
            med = (
                ordered[middle]
                if len(ordered) % 2 == 1
                else (ordered[middle - 1] + ordered[middle]) / 2
            )
            counts: dict[float, int] = {}
            for value in flat:
                counts[value] = counts.get(value, 0) + 1
            best = max(counts.values())
            mode = min(v for v, c in counts.items() if c == best)
            trace = sum(
                values[i][i]
                for i in range(min(len(values), len(values[0])))
                if not is_na(values[i][i])
            ) if any(
                not is_na(values[i][i])
                for i in range(min(len(values), len(values[0])))
            ) else NA
        else:
            avg = minimum = maximum = med = mode = NA
            trace = NA
        # sum/diff against a scalar (na propagation)
        summed = [
            [NA if is_na(v) else v + 2 for v in row] for row in values
        ]
        diffed = [
            [NA if is_na(v) else v - 1 for v in row] for row in values
        ]
        expected.append(
            {
                "avg": normalize(avg),
                "min": normalize(minimum),
                "max": normalize(maximum),
                "median": normalize(med),
                "mode": normalize(mode),
                "trace": normalize(trace),
                "sum_scalar": dump_rows(summed),
                "diff_scalar": dump_rows(diffed),
            }
        )
    return {
        "name": "matrix.stats",
        "pineVersion": 6,
        "input": {"cases": [{"values": values} for values in matrices]},
        "expected": {"stats": expected},
    }


def build_matrix_linalg_fixture() -> dict:
    a = np.array([[1.0, 2.0], [3.0, 4.0]])
    b = np.array([[2.0, 0.0], [1.0, 2.0]])
    wide = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    tall = wide.T
    singular = np.array([[1.0, 2.0], [2.0, 4.0]])
    diagonal = np.array([[2.0, 0.0, 0.0], [0.0, 3.0, 0.0], [0.0, 0.0, 4.0]])

    def clean(matrix) -> list:
        array = np.asarray(matrix)
        if array.ndim == 1:
            return [float(v) for v in array]
        return [[float(v) for v in row] for row in array]

    expected = {
        "det": [float(np.linalg.det(a)), float(np.linalg.det(singular)), float(np.linalg.det(diagonal))],
        "inv": clean(np.linalg.inv(a)),
        "inv_b": clean(np.linalg.inv(b)),
        "pinv": clean(np.linalg.pinv(a)),
        "pinv_wide": clean(np.linalg.pinv(wide)),
        "pinv_tall": clean(np.linalg.pinv(tall)),
        "pinv_singular": clean(np.linalg.pinv(singular)),
        "rank": [
            int(np.linalg.matrix_rank(a)),
            int(np.linalg.matrix_rank(singular)),
            int(np.linalg.matrix_rank(wide)),
        ],
        "mult_mm": clean(a @ b),
        "mult_ba": clean(b @ a),
        "mult_scalar": clean(a * 2.5),
        "mult_vector": clean(a @ np.array([1.0, 0.5])),
        "kron": clean(np.kron(a, b)),
        "pow": clean(np.linalg.matrix_power(a, 3)),
        "pow_zero": clean(np.linalg.matrix_power(a, 0)),
        "transpose": clean(wide.T),
        "sum_mm": clean(a + b),
        "diff_mm": clean(a - b),
        "mult_wide_tall": clean(wide @ tall),
    }
    return {
        "name": "matrix.linalg",
        "pineVersion": 6,
        "input": {
            "a": clean(a),
            "b": clean(b),
            "wide": clean(wide),
            "tall": clean(tall),
            "singular": clean(singular),
            "diagonal": clean(diagonal),
            "scalar": 2.5,
            "vector": [1.0, 0.5],
        },
        "expected": expected,
    }


def build_matrix_eigen_fixture() -> dict:
    matrices = [
        [[2.0, 1.0], [1.0, 3.0]],
        [[4.0, 1.0, 0.0], [1.0, 5.0, 2.0], [0.0, 2.0, 6.0]],
        [[10.0, -3.0, 1.0, 7.0], [-3.0, 12.0, 5.0, 0.0], [1.0, 5.0, 9.0, 2.0], [7.0, 0.0, 2.0, 11.0]],
        [[5.0]],
    ]
    expected = []
    for values in matrices:
        array = np.array(values)
        values_expected = [float(v) for v in np.linalg.eigvalsh(array)]
        expected.append(values_expected)
    return {
        "name": "matrix.eigen",
        "pineVersion": 6,
        "meta": {
            "note": "eigenvalues from numpy.linalg.eigvalsh (ascending); eigenvectors are verified through the A v = lambda v identity in verify-fixtures.ts because column signs are implementation-defined",
        },
        "input": {"cases": [{"values": values} for values in matrices]},
        "expected": {"eigenvalues": expected},
    }


def build_matrix_predicates_fixture() -> dict:
    cases = [
        [[1, 2], [3, 4]],
        [[1, 0], [0, 1]],
        [[1, 0, 0], [0, 2, 0], [0, 0, 3]],
        [[0, 1], [2, 0]],
        [[1, 2], [2, 1]],
        [[0, 1], [-1, 0]],
        [[1, 2, 0], [0, 3, 4]],
        [[0, 0], [0, 0]],
        [[0, 1], [1, 0]],
        [[0.25, 0.75], [0.5, 0.5]],
        [[1, 2, 3], [4, 5, 6]],
        [[1, 0], [0, 2]],
    ]

    def predicates(values):
        height = len(values)
        width = len(values[0]) if values else 0
        square = height == width
        zero = all(v == 0 for row in values for v in row)
        binary = all(v in (0, 1) for row in values for v in row)
        identity = square and all(
            values[i][j] == (1 if i == j else 0) for i in range(height) for j in range(width)
        )
        diagonal = square and all(
            values[i][j] == 0 for i in range(height) for j in range(width) if i != j
        )
        antidiagonal = square and all(
            values[i][j] == 0 for i in range(height) for j in range(width) if i + j != width - 1
        )
        symmetric = square and all(
            values[i][j] == values[j][i] for i in range(height) for j in range(width) if i < j
        )
        antisymmetric = square and all(
            values[i][j] == -values[j][i] for i in range(height) for j in range(width) if i <= j
        )
        upper = square and all(
            values[i][j] == 0 for i in range(height) for j in range(width) if i > j
        )
        lower = square and all(
            values[i][j] == 0 for i in range(height) for j in range(width) if i < j
        )
        stochastic = all(v >= 0 for row in values for v in row) and all(
            abs(sum(row) - 1) <= 1e-9 for row in values
        )
        return {
            "is_square": square,
            "is_zero": zero,
            "is_binary": binary,
            "is_identity": identity,
            "is_diagonal": diagonal,
            "is_antidiagonal": antidiagonal,
            "is_symmetric": symmetric,
            "is_antisymmetric": antisymmetric,
            "is_triangular": upper or lower,
            "is_stochastic": stochastic,
        }

    return {
        "name": "matrix.predicates",
        "pineVersion": 6,
        "input": {"cases": [{"values": values} for values in cases]},
        "expected": {"predicates": [predicates(values) for values in cases]},
    }


def main() -> None:
    dump("ops", MAP_DIR, build_map_ops_fixture())
    dump("limits", MAP_DIR, build_map_limits_fixture())
    dump("structural", MATRIX_DIR, build_matrix_structural_fixture())
    dump("stats", MATRIX_DIR, build_matrix_stats_fixture())
    dump("linalg", MATRIX_DIR, build_matrix_linalg_fixture())
    dump("eigen", MATRIX_DIR, build_matrix_eigen_fixture())
    dump("predicates", MATRIX_DIR, build_matrix_predicates_fixture())


if __name__ == "__main__":
    main()
