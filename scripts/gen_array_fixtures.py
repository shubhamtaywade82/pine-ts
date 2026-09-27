#!/usr/bin/env python3
"""Double-entry fixture generator for the array namespace.

Computes expected values with independent Python mirrors of the Pine v6
array semantics (skip-na statistics, negative index resolution, slice
windows, TV's Pivot Points Standard formulas), then writes JSON fixtures
that scripts/verify-fixtures.ts replays through the real pine-ts runtime.

Case protocol (mirrored by the TypeScript verifier):
  input.cases: [{ "start": [...], "ops": [[op, ...args]], "observe": ... }]
    - "start" seeds a fresh array (null encodes na)
    - "ops" run in order against it
    - "observe": "array" reports final contents, "value" the last op's
      return value, "both" reports [lastValue, finalContents]
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARRAY_DIR = ROOT / "fixtures" / "v6" / "array"
ARRAY_DIR.mkdir(parents=True, exist_ok=True)

NA = None  # JSON null encodes na


def dump(name: str, key: str, cases: list, expected: list) -> None:
    path = ARRAY_DIR / f"{name}.basic.json"
    path.write_text(
        json.dumps(
            {
                "name": f"array.{name}" if not name.startswith("pivot") else name,
                "pineVersion": 6,
                "input": {"cases": cases},
                "expected": {key: expected},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# Python mirror of the Pine array semantics (independent of src/array/*)
# ---------------------------------------------------------------------------

def is_na(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def resolve_index(index: int, size: int) -> int:
    resolved = index if index >= 0 else size + index
    if resolved < 0 or resolved >= size:
        raise IndexError(f"Index {index} is out of bounds. Array size is {size}")
    return resolved


class Mirror:
    """A fresh mirror array; ops raise on contract violations."""

    def __init__(self, start: list):
        self.data = [NA if v is None else v for v in start]

    # -- ops ---------------------------------------------------------------
    def op(self, op: str, args: list):
        if op == "push":
            self.data.append(args[0])
            return NA
        if op == "unshift":
            self.data.insert(0, args[0])
            return NA
        if op == "pop":
            if not self.data:
                raise IndexError("Cannot use pop() if array is empty.")
            return self.data.pop()
        if op == "shift":
            if not self.data:
                raise IndexError("Cannot use shift() if array is empty.")
            return self.data.pop(0)
        if op == "get":
            return self.data[resolve_index(args[0], len(self.data))]
        if op == "set":
            self.data[resolve_index(args[0], len(self.data))] = args[1]
            return NA
        if op == "insert":
            index = resolve_index(args[0], len(self.data))
            self.data.insert(index, args[1])
            return NA
        if op == "remove":
            index = resolve_index(args[0], len(self.data))
            return self.data.pop(index)
        if op == "clear":
            self.data.clear()
            return NA
        if op == "fill":
            value = args[0]
            start = args[1] if len(args) > 1 else 0
            end = args[2] if len(args) > 2 else None
            end = len(self.data) if end is None else end
            if start < 0 or start > len(self.data) or end < start or end > len(self.data):
                raise IndexError("fill bounds")
            for i in range(start, end):
                self.data[i] = value
            return NA
        if op == "reverse":
            self.data.reverse()
            return NA
        if op == "sort":
            # na elements sink to the end regardless of the requested order
            order = args[0]
            values = [v for v in self.data if not is_na(v)]
            nas = [v for v in self.data if is_na(v)]
            values.sort(reverse=order == "descending")
            self.data = values + nas
            return NA
        if op == "push_slice":
            # args: [slice_from, slice_to, value] — push through a view
            view_from, view_to, value = args
            self.data.insert(view_to, value)
            return NA
        if op == "set_slice":
            # args: [slice_from, slice_to, index, value] — set through a view
            view_from, view_to, index, value = args
            size = view_to - view_from
            self.data[view_from + resolve_index(index, size)] = value
            return NA
        if op == "concat":
            self.data.extend(args[0])
            return NA
        if op == "first":
            if not self.data:
                raise IndexError("Cannot use first() if array is empty.")
            return self.data[0]
        if op == "last":
            if not self.data:
                raise IndexError("Cannot use last() if array is empty.")
            return self.data[-1]
        if op == "size":
            return len(self.data)
        if op == "copy_independent_size":
            # copy, then push onto the original: the copy must not grow
            duplicate = list(self.data)
            self.data.append(args[0])
            return len(duplicate)
        raise ValueError(f"unknown op {op}")


def mirror_run(case: dict):
    mirror = Mirror(case["start"])
    result = NA
    for entry in case["ops"]:
        result = mirror.op(entry[0], entry[1:])
    observe = case.get("observe", "array")
    if observe == "value":
        return na_encode(result)
    if observe == "both":
        return [na_encode(result), na_encode_all(mirror.data)]
    return na_encode_all(mirror.data)


def na_encode(value):
    if value is None:
        return NA
    if isinstance(value, float) and math.isnan(value):
        return NA
    return value


def na_encode_all(values):
    return [na_encode(v) for v in values]


def run_cases(cases: list) -> list:
    return [mirror_run(case) for case in cases]


# ---------------------------------------------------------------------------
# Statistics mirror (skip-na rule)
# ---------------------------------------------------------------------------

def non_na(values):
    return [float(v) for v in values if not is_na(v)]


def mirror_avg(values):
    xs = non_na(values)
    return sum(xs) / len(xs) if xs else NA


def mirror_sum(values):
    xs = non_na(values)
    return sum(xs) if xs else NA


def mirror_max(values, nth=0):
    xs = sorted(non_na(values), reverse=True)
    return xs[nth] if 0 <= nth < len(xs) else NA


def mirror_min(values, nth=0):
    xs = sorted(non_na(values))
    return xs[nth] if 0 <= nth < len(xs) else NA


def mirror_median(values):
    xs = sorted(non_na(values))
    if not xs:
        return NA
    mid = len(xs) // 2
    return xs[mid] if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2


def mirror_mode(values):
    xs = non_na(values)
    if not xs:
        return NA
    counts: dict[float, int] = {}
    for v in xs:
        counts[v] = counts.get(v, 0) + 1
    best, best_count = NA, 0
    for v, count in counts.items():
        if count > best_count or (count == best_count and (best is NA or v < best)):
            best, best_count = v, count
    return best


def mirror_range(values):
    xs = non_na(values)
    return (max(xs) - min(xs)) if xs else NA


def mirror_variance(values, biased=True):
    xs = non_na(values)
    if not xs:
        return NA
    mean = sum(xs) / len(xs)
    denom = len(xs) if biased else len(xs) - 1
    if denom <= 0:
        return NA
    return sum((v - mean) ** 2 for v in xs) / denom


def mirror_stdev(values, biased=True):
    variance = mirror_variance(values, biased)
    return NA if variance is NA else math.sqrt(variance)


def mirror_covariance(left, right, biased=True):
    pairs = [(float(a), float(b)) for a, b in zip(left, right) if not is_na(a) and not is_na(b)]
    if not pairs:
        return NA
    mean_l = sum(p[0] for p in pairs) / len(pairs)
    mean_r = sum(p[1] for p in pairs) / len(pairs)
    denom = len(pairs) if biased else len(pairs) - 1
    if denom <= 0:
        return NA
    return sum((p[0] - mean_l) * (p[1] - mean_r) for p in pairs) / denom


def mirror_standardize(values):
    xs = non_na(values)
    if not xs:
        return []
    mean = sum(xs) / len(xs)
    stdev = math.sqrt(sum((v - mean) ** 2 for v in xs) / len(xs))
    if stdev == 0:
        return [NA] * len(values)
    return [NA if is_na(v) else (v - mean) / stdev for v in values]


def mirror_percentrank(values, index):
    size = len(values)
    resolved = index if index >= 0 else size + index
    reference = values[resolved]
    if is_na(reference):
        return NA
    xs = non_na(values)
    below = sum(1 for v in xs if v <= reference)
    return below / len(xs) * 100


def mirror_percentile_nearest_rank(values, percentage):
    xs = sorted(non_na(values))
    if not xs:
        return NA
    rank = math.ceil(percentage / 100 * len(xs))
    return xs[min(max(rank - 1, 0), len(xs) - 1)]


def mirror_percentile_linear(values, percentage):
    xs = sorted(non_na(values))
    if not xs:
        return NA
    position = percentage / 100 * (len(xs) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return xs[lower]
    weight = position - lower
    return xs[lower] * (1 - weight) + xs[upper] * weight


# ---------------------------------------------------------------------------
# Binary search mirror
# ---------------------------------------------------------------------------

def mirror_binary_search(values, target):
    low, high = 0, len(values) - 1
    while low <= high:
        mid = (low + high) // 2
        if values[mid] == target:
            return mid
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1


def mirror_bs_leftmost(values, target):
    low, high = 0, len(values)
    while low < high:
        mid = (low + high) // 2
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid
    if low < len(values) and values[low] == target:
        return low
    return low - 1 if low > 0 else 0


def mirror_bs_rightmost(values, target):
    low, high = 0, len(values)
    while low < high:
        mid = (low + high) // 2
        if values[mid] <= target:
            low = mid + 1
        else:
            high = mid
    if low > 0 and values[low - 1] == target:
        return low - 1
    return low


# ---------------------------------------------------------------------------
# Pivot mirror (TV Pivot Points Standard formulas)
# ---------------------------------------------------------------------------

def mirror_pivot_levels(kind, high, low, close, prev_open, curr_open):
    na = NA

    def trad():
        p = (high + low + close) / 3
        return [
            p,
            p * 2 - low,
            p * 2 - high,
            p + (high - low),
            p - (high - low),
            p * 2 + (high - 2 * low),
            p * 2 - (2 * high - low),
            p * 3 + (high - 3 * low),
            p * 3 - (3 * high - low),
            p * 4 + (high - 4 * low),
            p * 4 - (4 * high - low),
        ]

    def fib():
        p = (high + low + close) / 3
        return [
            p,
            p + 0.382 * (high - low),
            p - 0.382 * (high - low),
            p + 0.618 * (high - low),
            p - 0.618 * (high - low),
            p + (high - low),
            p - (high - low),
            na,
            na,
            na,
            na,
        ]

    def woodie():
        p = (high + low + 2 * curr_open) / 4
        r3 = high + 2 * (p - low)
        s3 = low - 2 * (high - p)
        return [p, 2 * p - low, 2 * p - high, p + (high - low), p - (high - low), r3, s3, r3 + (high - low), s3 - (high - low), na, na]

    def classic():
        p = (high + low + close) / 3
        return [
            p,
            2 * p - low,
            2 * p - high,
            p + (high - low),
            p - (high - low),
            p + 2 * (high - low),
            p - 2 * (high - low),
            p + 3 * (high - low),
            p - 3 * (high - low),
            na,
            na,
        ]

    def dm():
        if prev_open == close:
            x = high + low + 2 * close
        elif close > prev_open:
            x = 2 * high + low + close
        else:
            x = 2 * low + high + close
        return [x / 4, x / 2 - low, x / 2 - high, na, na, na, na, na, na, na, na]

    def camarilla():
        p = (high + low + close) / 3
        rng = 1.1 * (high - low)
        r5 = (high / low) * close
        return [
            p,
            close + rng / 12,
            close - rng / 12,
            close + rng / 6,
            close - rng / 6,
            close + rng / 4,
            close - rng / 4,
            close + rng / 2,
            close - rng / 2,
            r5,
            close - (r5 - close),
        ]

    return {"Traditional": trad, "Fibonacci": fib, "Woodie": woodie, "Classic": classic, "DM": dm, "Camarilla": camarilla}[kind]()


def mirror_pivot_run(bars, kind, developing=False):
    """Anchor at time % 5 == 0; returns the per-bar pivot (level 0)."""
    state = {"high": NA, "low": NA, "close": NA, "open": NA, "has": False}
    last_levels = None
    out = []
    for bar in bars:
        high, low, close, open_ = bar["high"], bar["low"], bar["close"], bar["open"]
        anchored = bar["time"] % 5 == 0
        if developing:
            if anchored or not state["has"]:
                levels = mirror_pivot_levels(kind, high, low, close, open_, open_)
            else:
                levels = mirror_pivot_levels(
                    kind,
                    max(state["high"], high),
                    min(state["low"], low),
                    close,
                    state["open"],
                    open_,
                )
        elif anchored:
            levels = mirror_pivot_levels(kind, state["high"], state["low"], state["close"], state["open"], open_) if state["has"] else [NA] * 11
        else:
            levels = last_levels if last_levels is not None else [NA] * 11
        out.append(levels[0])
        # commit
        if anchored:
            last_levels = mirror_pivot_levels(kind, state["high"], state["low"], state["close"], state["open"], open_) if state["has"] else None
            state = {"high": high, "low": low, "close": close, "open": open_, "has": True}
        elif not state["has"]:
            state = {"high": high, "low": low, "close": close, "open": open_, "has": True}
        else:
            state["high"] = max(state["high"], high)
            state["low"] = min(state["low"], low)
            state["close"] = close
    return out


# ---------------------------------------------------------------------------
# Fixture definitions
# ---------------------------------------------------------------------------

BARS = [
    {"time": i + 1, "open": 10 + i, "high": 12 + i, "low": 8 + i, "close": 11 + i, "volume": 100}
    for i in range(12)
]

# --- element access / mutation (op protocol) ---
dump(
    "get",
    "get",
    [
        {"start": [10, 20, 30], "ops": [["get", 0]], "observe": "value"},
        {"start": [10, 20, 30], "ops": [["get", -1]], "observe": "value"},
        {"start": [10, 20, 30], "ops": [["get", -3]], "observe": "value"},
        {"start": [1, None, 3], "ops": [["get", 1]], "observe": "value"},
    ],
    run_cases(
        [
            {"start": [10, 20, 30], "ops": [["get", 0]], "observe": "value"},
            {"start": [10, 20, 30], "ops": [["get", -1]], "observe": "value"},
            {"start": [10, 20, 30], "ops": [["get", -3]], "observe": "value"},
            {"start": [1, None, 3], "ops": [["get", 1]], "observe": "value"},
        ]
    ),
)

dump(
    "push_pop",
    "push_pop",
    [
        {"start": [1, 2], "ops": [["push", 3]], "observe": "array"},
        {"start": [1, 2, 3], "ops": [["pop"]], "observe": "both"},
        {"start": [], "ops": [["push", 5], ["pop"]], "observe": "both"},
    ],
    run_cases(
        [
            {"start": [1, 2], "ops": [["push", 3]], "observe": "array"},
            {"start": [1, 2, 3], "ops": [["pop"]], "observe": "both"},
            {"start": [], "ops": [["push", 5], ["pop"]], "observe": "both"},
        ]
    ),
)

dump(
    "shift_unshift",
    "shift_unshift",
    [
        {"start": [1, 2], "ops": [["unshift", 0]], "observe": "array"},
        {"start": [1, 2, 3], "ops": [["shift"]], "observe": "both"},
    ],
    run_cases(
        [
            {"start": [1, 2], "ops": [["unshift", 0]], "observe": "array"},
            {"start": [1, 2, 3], "ops": [["shift"]], "observe": "both"},
        ]
    ),
)

dump(
    "insert_remove",
    "insert_remove",
    [
        {"start": [1, 3], "ops": [["insert", 1, 2]], "observe": "array"},
        {"start": [1, 2, 3], "ops": [["insert", -1, 9]], "observe": "array"},
        {"start": [1, 2, 3], "ops": [["remove", 0]], "observe": "both"},
        {"start": [1, 2, 3], "ops": [["remove", -1]], "observe": "both"},
    ],
    run_cases(
        [
            {"start": [1, 3], "ops": [["insert", 1, 2]], "observe": "array"},
            {"start": [1, 2, 3], "ops": [["insert", -1, 9]], "observe": "array"},
            {"start": [1, 2, 3], "ops": [["remove", 0]], "observe": "both"},
            {"start": [1, 2, 3], "ops": [["remove", -1]], "observe": "both"},
        ]
    ),
)

dump(
    "fill",
    "fill",
    [
        {"start": [0, 0, 0, 0, 0], "ops": [["fill", 9, 1, 3]], "observe": "array"},
        {"start": [0, 0, 0], "ops": [["fill", 4]], "observe": "array"},
        {"start": [0, 0, 0, 0], "ops": [["fill", 2, 2]], "observe": "array"},
    ],
    run_cases(
        [
            {"start": [0, 0, 0, 0, 0], "ops": [["fill", 9, 1, 3]], "observe": "array"},
            {"start": [0, 0, 0], "ops": [["fill", 4]], "observe": "array"},
            {"start": [0, 0, 0, 0], "ops": [["fill", 2, 2]], "observe": "array"},
        ]
    ),
)

dump(
    "reverse_clear_concat",
    "reverse_clear_concat",
    [
        {"start": [1, 2, 3], "ops": [["reverse"]], "observe": "array"},
        {"start": [1, 2, 3], "ops": [["clear"]], "observe": "array"},
        {"start": [1, 2], "ops": [["concat", [3, 4]]], "observe": "array"},
    ],
    run_cases(
        [
            {"start": [1, 2, 3], "ops": [["reverse"]], "observe": "array"},
            {"start": [1, 2, 3], "ops": [["clear"]], "observe": "array"},
            {"start": [1, 2], "ops": [["concat", [3, 4]]], "observe": "array"},
        ]
    ),
)

dump(
    "slice",
    "slice",
    [
        {"start": [1, 2, 3, 4, 5], "ops": [["set_slice", 1, 4, 0, 99]], "observe": "array"},
        {"start": [1, 2, 3, 4, 5], "ops": [["push_slice", 1, 4, 77]], "observe": "array"},
    ],
    run_cases(
        [
            {"start": [1, 2, 3, 4, 5], "ops": [["set_slice", 1, 4, 0, 99]], "observe": "array"},
            {"start": [1, 2, 3, 4, 5], "ops": [["push_slice", 1, 4, 77]], "observe": "array"},
        ]
    ),
)

dump(
    "sort",
    "sort",
    [
        {"start": [3, None, 1, 2], "ops": [["sort", "ascending"]], "observe": "array"},
        {"start": [3, None, 1, 2], "ops": [["sort", "descending"]], "observe": "array"},
        {"start": [5, -2, 0, 9, 1], "ops": [["sort", "ascending"]], "observe": "array"},
    ],
    run_cases(
        [
            {"start": [3, None, 1, 2], "ops": [["sort", "ascending"]], "observe": "array"},
            {"start": [3, None, 1, 2], "ops": [["sort", "descending"]], "observe": "array"},
            {"start": [5, -2, 0, 9, 1], "ops": [["sort", "ascending"]], "observe": "array"},
        ]
    ),
)


def stat_cases(values_list, fn, *args):
    return [fn(values, *args) for values in values_list]


STAT_SETS = [
    [4, None, 1, 3, None, 2],
    [1, 2, 3, 4, 5],
    [None, None],
    [],
    [7],
    [2.5, -1.5, 2.5, 0],
]

dump("avg", "avg", [{"values": v} for v in STAT_SETS], [mirror_avg(v) for v in STAT_SETS])
dump("sum", "sum", [{"values": v} for v in STAT_SETS], [mirror_sum(v) for v in STAT_SETS])
dump("median", "median", [{"values": v} for v in STAT_SETS], [mirror_median(v) for v in STAT_SETS])
dump("mode", "mode", [{"values": v} for v in STAT_SETS], [mirror_mode(v) for v in STAT_SETS])
dump("range", "range", [{"values": v} for v in STAT_SETS], [mirror_range(v) for v in STAT_SETS])

NTH_CASES = [([5, 3, 9, 1], 0), ([5, 3, 9, 1], 1), ([5, 3, 9, 1], 3), ([5, 3, 9, 1], 4), ([None, 2], 0)]
dump(
    "max",
    "max",
    [{"values": v, "nth": n} for v, n in NTH_CASES],
    [mirror_max(v, n) for v, n in NTH_CASES],
)
dump(
    "min",
    "min",
    [{"values": v, "nth": n} for v, n in NTH_CASES],
    [mirror_min(v, n) for v, n in NTH_CASES],
)

BIAS_SETS = [[2, 4, 4, 4, 5, 5, 7, 9], [5], [None, 3, 3], []]
dump(
    "stdev_variance",
    "stdev_variance",
    [{"values": v, "biased": b} for v in BIAS_SETS for b in (True, False)],
    [
        [mirror_variance(v, b), mirror_stdev(v, b)]
        for v in BIAS_SETS
        for b in (True, False)
    ],
)

COV_CASES = [
    ([1, 2, 3, 4], [2, 4, 6, 8], True),
    ([1, 2, 3, 4], [2, 4, 6, 8], False),
    ([1, None, 3, 4], [2, 4, 6, 8], True),
    ([], [], True),
]
dump(
    "covariance",
    "covariance",
    [{"left": l, "right": r, "biased": b} for l, r, b in COV_CASES],
    [mirror_covariance(l, r, b) for l, r, b in COV_CASES],
)

dump(
    "standardize",
    "standardize",
    [{"values": v} for v in STAT_SETS],
    [na_encode_all(mirror_standardize(v)) for v in STAT_SETS],
)

PR_CASES = [([1, 2, 3, 4], 0), ([1, 2, 3, 4], 3), ([1, 2, 3, 4], -1), ([1, 2, 3, 4], 1), ([None, 2], 0)]
dump(
    "percentrank",
    "percentrank",
    [{"values": v, "index": i} for v, i in PR_CASES],
    [mirror_percentrank(v, i) for v, i in PR_CASES],
)

dump(
    "percentiles",
    "percentiles",
    [
        {"values": [1, 2, 3, 4], "percentage": 50},
        {"values": [1, 2, 3, 4], "percentage": 25},
        {"values": [1, 2, 3, 4], "percentage": 100},
        {"values": [1, 2, 3, 4], "percentage": 0},
        {"values": [None, 5, 1], "percentage": 50},
    ],
    [
        [
            mirror_percentile_nearest_rank([1, 2, 3, 4], 50),
            mirror_percentile_linear([1, 2, 3, 4], 50),
        ],
        [
            mirror_percentile_nearest_rank([1, 2, 3, 4], 25),
            mirror_percentile_linear([1, 2, 3, 4], 25),
        ],
        [
            mirror_percentile_nearest_rank([1, 2, 3, 4], 100),
            mirror_percentile_linear([1, 2, 3, 4], 100),
        ],
        [
            mirror_percentile_nearest_rank([1, 2, 3, 4], 0),
            mirror_percentile_linear([1, 2, 3, 4], 0),
        ],
        [
            mirror_percentile_nearest_rank([None, 5, 1], 50),
            mirror_percentile_linear([None, 5, 1], 50),
        ],
    ],
)

BS_VALUES = [1, 3, 3, 5, 7, 9]
BS_CASES = [(5,), (4,), (1,), (9,), (0,), (10,)]
dump(
    "binary_search",
    "binary_search",
    [{"values": BS_VALUES, "target": t[0]} for t in BS_CASES],
    [
        [
            mirror_binary_search(BS_VALUES, t[0]),
            mirror_bs_leftmost(BS_VALUES, t[0]),
            mirror_bs_rightmost(BS_VALUES, t[0]),
        ]
        for t in BS_CASES
    ],
)

dump(
    "abs",
    "abs",
    [
        {"values": [-1, 2, None]},
        {"values": [None, None]},
        {"values": []},
        {"values": [-2.5]},
    ],
    [
        [1, 2, None],
        NA,  # all-na input returns na (undefined array id)
        NA,
        [2.5],
    ],
)

dump(
    "every_some_join",
    "every_some_join",
    [
        {"values": [1, 2, 3]},
        {"values": [1, 0, 3]},
        {"values": [1, None]},
        {"values": [0, 0]},
        {"values": [1.5, None, 3]},
    ],
    [
        [True, True, "1,2,3"],
        [False, True, "1,0,3"],
        [False, True, "1,NaN"],
        [False, False, "0,0"],
        [False, True, "1.5,NaN,3"],
    ],
)

CONSTRUCTOR_CASES = [
    {"start": [1, 2, 3], "ops": [["first"]], "observe": "value"},
    {"start": [1, 2, 3], "ops": [["last"]], "observe": "value"},
    {"start": [1, 2, 3], "ops": [["size"]], "observe": "value"},
    {"start": [], "ops": [["size"]], "observe": "value"},
    {"start": [1, 2, 3], "ops": [["copy_independent_size", 99]], "observe": "value"},
]
dump(
    "constructors",
    "constructors",
    CONSTRUCTOR_CASES,
    run_cases(CONSTRUCTOR_CASES),
)

# --- pivot fixtures: run the mirror against the shared bar set ---
for kind in ("Traditional", "Classic", "Woodie", "DM", "Camarilla"):
    dump(
        f"pivot_{kind.lower()}",
        f"pivot_{kind.lower()}",
        [{"bars": BARS}],
        [mirror_pivot_run(BARS, kind)],
    )
dump(
    "pivot_camarilla_developing",
    "pivot_camarilla_developing",
    [{"bars": BARS}],
    [mirror_pivot_run(BARS, "Camarilla", developing=True)],
)

# --- str.split fixtures ---
SPLIT_CASES = [
    ("a,b,c", ","),
    ("a,b,c,", ","),
    ("abc", ""),
    ("", ","),
    ("no-separator", "-"),
]
dump(
    "str_split",
    "str_split",
    [{"source": s, "separator": sep} for s, sep in SPLIT_CASES],
    [
        s.split(sep) if sep else [s]
        for s, sep in SPLIT_CASES
    ],
)

print("\narray fixture generation complete")
