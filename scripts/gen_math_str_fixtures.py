#!/usr/bin/env python3
"""Double-entry fixture generator for the math and str namespaces.

Computes expected values with independent Python mirrors of the Pine v6
semantics (IEEE-754 math, Java-style DecimalFormat/MessageFormat/
SimpleDateFormat subsets, and the mulberry32 PRNG), then writes JSON
fixtures that scripts/verify-math-str-fixtures.ts replays through the real
pine-ts runtime.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
MATH_DIR = ROOT / "fixtures" / "v6" / "math"
STR_DIR = ROOT / "fixtures" / "v6" / "str"
MATH_DIR.mkdir(parents=True, exist_ok=True)
STR_DIR.mkdir(parents=True, exist_ok=True)

NA = None  # JSON null encodes na


def dump(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


# --------------------------------------------------------------------------
# math mirrors
# --------------------------------------------------------------------------

def round_ties_up(value: float) -> float:
    """JS Math.round: floor(x + 0.5) with -0 normalized."""
    result = math.floor(value + 0.5)
    return 0.0 if result == 0 else float(result)


def round_to_digits(value: float, digits: int) -> float:
    factor = 10.0 ** digits
    return round_ties_up(value * factor) / factor


def round_to_tick(value: float, mintick: float) -> float:
    return round_ties_up(value / mintick) * mintick


def mulberry32_u01(seed: int):
    """Mirror of the TypeScript mulberry32 (+0.5 open-interval nudge)."""
    state = seed & 0xFFFFFFFF
    while True:
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = _i32(_i32(t ^ (t >> 15)) * _i32(t | 1))
        # JS `t >>> 7` is a logical shift; Python must mask first because t
        # can be negative here (int32).
        t = _i32(t ^ _i32(t + _i32(_i32(t ^ ((t & 0xFFFFFFFF) >> 7)) * _i32(t | 61))))
        yield (((t & 0xFFFFFFFF) ^ ((t & 0xFFFFFFFF) >> 14)) + 0.5) / 4294967296.0


def _i32(x: int) -> int:
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def gen_math() -> None:
    # -- pointwise series fixtures ------------------------------------------
    pointwise = {
        "abs": ([-4, 9, -16.5, 0], lambda x: abs(x)),
        "acos": ([0.5, -0.9, 1, 0], math.acos),
        "asin": ([0.5, -1, 0.25], math.asin),
        "atan": ([1, -0.5, 2], math.atan),
        "ceil": ([2.1, -2.1, 0.01], lambda x: float(math.ceil(x))),
        "cos": ([0.5, 1, 1.5], math.cos),
        "exp": ([1, 0.5, -1], math.exp),
        "floor": ([2.9, -2.9, 0.99], lambda x: float(math.floor(x))),
        "log": ([1, 2.718281828459045, 0.5], math.log),
        "log10": ([1, 10, 100, 0.5], math.log10),
        "sign": ([-3, 0, 4.2], lambda x: float((x > 0) - (x < 0))),
        "sin": ([0.5, 1, 1.5], math.sin),
        "sqrt": ([4, 2, 0.25], math.sqrt),
        "tan": ([0.5, 1, 1.5], math.tan),
        "todegrees": ([0.5, 1, 1.5], math.degrees),
        "toradians": ([45, 90, 180, 30], math.radians),
    }
    for name, (source, fn) in pointwise.items():
        dump(
            MATH_DIR / f"{name}.basic.json",
            {
                "name": f"math.{name}",
                "pineVersion": 6,
                "input": {"source": source},
                "expected": {name: [fn(x) for x in source]},
            },
        )

    # -- pow(close, 2) -------------------------------------------------------
    pow_source = [2, 3, 1.5]
    dump(
        MATH_DIR / "pow.basic.json",
        {
            "name": "math.pow",
            "pineVersion": 6,
            "input": {"source": pow_source, "exponent": 2},
            "expected": {"pow": [x ** 2 for x in pow_source]},
        },
    )

    # -- round(close, 2) -----------------------------------------------------
    round_source = [1.234, 2.345, 3.456, 0.005]
    dump(
        MATH_DIR / "round.basic.json",
        {
            "name": "math.round",
            "pineVersion": 6,
            "input": {"source": round_source, "precision": 2},
            "expected": {"round": [round_to_digits(x, 2) for x in round_source]},
        },
    )

    # -- round_to_mintick(close) with mintick 0.25 ---------------------------
    mintick_source = [1.13, 1.11, -1.13, 2.0]
    dump(
        MATH_DIR / "round_to_mintick.basic.json",
        {
            "name": "math.round_to_mintick",
            "pineVersion": 6,
            "input": {"source": mintick_source, "mintick": 0.25},
            "expected": {
                "round_to_mintick": [round_to_tick(x, 0.25) for x in mintick_source]
            },
        },
    )

    # -- variadic max/min over two sources -----------------------------------
    s1 = [3, 1, 4]
    s2 = [2, 5, 0]
    dump(
        MATH_DIR / "max.basic.json",
        {
            "name": "math.max",
            "pineVersion": 6,
            "input": {"source1": s1, "source2": s2},
            "expected": {"max": [max(a, b) for a, b in zip(s1, s2)]},
        },
    )
    dump(
        MATH_DIR / "min.basic.json",
        {
            "name": "math.min",
            "pineVersion": 6,
            "input": {"source1": s1, "source2": s2},
            "expected": {"min": [min(a, b) for a, b in zip(s1, s2)]},
        },
    )

    # -- avg(close, volume, 0) — series, series, scalar ----------------------
    a1 = [1, 2, 3]
    a2 = [5, 1, 4]
    dump(
        MATH_DIR / "avg.basic.json",
        {
            "name": "math.avg",
            "pineVersion": 6,
            "input": {"source1": a1, "source2": a2, "scalar": 0},
            "expected": {"avg": [(x + y + 0) / 3 for x, y in zip(a1, a2)]},
        },
    )

    # -- sum windows ----------------------------------------------------------
    sum_source = [1, 2, 3, 4, 5]
    expected_sum = [NA, NA, 6, 9, 12]
    dump(
        MATH_DIR / "sum.basic.json",
        {
            "name": "math.sum",
            "pineVersion": 6,
            "input": {"source": sum_source, "length": 3},
            "expected": {"sum": expected_sum},
        },
    )

    skip_source = [1, 2, 3, 4]
    skip_expected = [NA, NA, 4, 7]  # bar 1 is na: windows collect non-na values
    dump(
        MATH_DIR / "sum.skipna.json",
        {
            "name": "math.sum",
            "pineVersion": 6,
            "input": {"source": skip_source, "length": 2, "naAt": [1]},
            "expected": {"sum": skip_expected},
        },
    )

    # -- seeded random --------------------------------------------------------
    seed, calls = 42, 6
    rng = mulberry32_u01(seed)
    dump(
        MATH_DIR / "random.seeded.json",
        {
            "name": "math.random",
            "pineVersion": 6,
            "input": {"seed": seed, "min": 0, "max": 1, "calls": calls},
            "expected": {"random": [next(rng) for _ in range(calls)]},
        },
    )


# --------------------------------------------------------------------------
# str mirrors
# --------------------------------------------------------------------------

TRIMMABLE = re.compile(r"[\s\p{Cc}]" if False else r"[\s\x00-\x1f\x7f-\x9f]")


def py_trim(source):
    if source is None:
        return ""
    start, end = 0, len(source)
    while start < end and _is_trimmable(source[start]):
        start += 1
    while end > start and _is_trimmable(source[end - 1]):
        end -= 1
    return source[start:end]


def _is_trimmable(ch: str) -> bool:
    return ch.isspace() or unicodedata.category(ch) == "Cc"


def py_replace_nth(source, target, replacement, occurrence):
    if source is None:
        return NA
    if target == "":
        return source
    frm, index = 0, -1
    for _ in range(occurrence + 1):
        index = source.find(target, frm)
        if index == -1:
            return source
        frm = index + len(target)
    return source[:index] + replacement + source[index + len(target):]


def py_tonumber(source):
    if source is None:
        return NA
    if re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?", source, re.IGNORECASE):
        return float(source)
    return NA


def group_digits(digits: str) -> str:
    if len(digits) < 4:
        return digits
    out = []
    for i, ch in enumerate(digits):
        out.append(ch)
        remaining = len(digits) - i
        if remaining > 1 and remaining % 3 == 1:
            out.append(",")
    return "".join(out)


def decimal_spec(pattern: str):
    if not re.fullmatch(r"[#0.,]+", pattern):
        raise ValueError(pattern)
    integer, _, fraction = pattern.partition(".")
    integer_zeros = integer.replace("#", "")
    return {
        "min_int": 0 if integer == "" else max(len(integer_zeros), 1),
        "max_frac": len(fraction),
        "min_frac": len(fraction.replace("#", "")),
        "group": "," in integer,
    }


def apply_spec(value: float, spec) -> str:
    if math.isnan(value):
        return "NaN"
    negative = value < 0 and value != 0
    magnitude = abs(value)
    fixed = f"{magnitude:.{spec['max_frac']}f}"
    integer, _, fraction = fixed.partition(".")
    if len(integer) < spec["min_int"]:
        integer = integer.rjust(spec["min_int"], "0")
    while len(fraction) > spec["min_frac"] and fraction.endswith("0"):
        fraction = fraction[:-1]
    if spec["group"]:
        integer = group_digits(integer)
    sign = "-" if negative else ""
    return f"{sign}{integer}.{fraction}" if fraction else f"{sign}{integer}"


def py_tostring(value, fmt):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "NaN"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if fmt is None:
        text = repr(float(value)) if not float(value).is_integer() else str(int(value))
        return "0" if text == "-0" else text
    if isinstance(fmt, dict):  # {"kind": "mintick", "mintick": t}
        tick = fmt["mintick"]
        snapped = round_to_tick(value, tick)
        text = repr(tick)
        if "e" in text or "E" in text:
            places = int(text.split("-")[-1])
        else:
            places = len(text.partition(".")[2])
        return apply_spec(
            snapped,
            {"min_int": 1, "max_frac": places, "min_frac": places, "group": False},
        )
    return apply_spec(value, decimal_spec(fmt))


def py_format_number(argument, style):
    if argument is None or (isinstance(argument, float) and math.isnan(argument)):
        return "NaN"
    if style is None:
        return py_tostring(argument, None)
    if style == "integer":
        return apply_spec(argument, {"min_int": 1, "max_frac": 0, "min_frac": 0, "group": True})
    if style == "currency":
        body = apply_spec(argument, {"min_int": 1, "max_frac": 2, "min_frac": 2, "group": True})
        return body if body == "NaN" else f"${body}"
    if style == "percent":
        body = apply_spec(argument * 100, {"min_int": 1, "max_frac": 0, "min_frac": 0, "group": True})
        return body if body == "NaN" else f"{body}%"
    return apply_spec(argument, decimal_spec(style))


def consume_quoted(text: str, index: int):
    if index + 1 < len(text) and text[index + 1] == "'":
        return "'", index + 2
    closing = text.find("'", index + 1)
    if closing == -1:
        return text[index + 1:], len(text)
    return text[index + 1:closing], closing + 1


def py_format(format_string, args):
    out, literal, index = [], "", 0

    def flush():
        nonlocal literal
        if literal:
            out.append(("lit", literal))
            literal = ""

    while index < len(format_string):
        ch = format_string[index]
        if ch == "'":
            span, index = consume_quoted(format_string, index)
            literal += span
            continue
        if ch == "{":
            closing = format_string.find("}", index + 1)
            if closing == -1:
                raise ValueError("unmatched brace")
            parts = [p.strip() for p in format_string[index + 1:closing].split(",")]
            position = int(parts[0])
            if len(parts) > 1 and parts[1] not in ("", "number"):
                raise ValueError("unsupported type")
            style = parts[2] if len(parts) > 2 and parts[2] != "" else None
            flush()
            out.append(("ph", position, style))
            index = closing + 1
            continue
        literal += ch
        index += 1
    flush()

    rendered = ""
    for segment in out:
        if segment[0] == "lit":
            rendered += segment[1]
            continue
        _, position, style = segment
        argument = args[position]
        if argument is None:
            rendered += "NaN"
        elif isinstance(argument, bool):
            rendered += "true" if argument else "false"
        elif isinstance(argument, str):
            if style is not None:
                raise ValueError("number style on string")
            rendered += argument
        else:
            rendered += py_format_number(argument, style)
    return rendered


MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
WEEKDAYS_FULL = {
    "Sun": "Sunday", "Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday",
    "Thu": "Thursday", "Fri": "Friday", "Sat": "Saturday",
}


def resolve_zone(spec):
    if spec is None:
        return timezone.utc
    text = spec.strip()
    if text in ("", "UTC", "GMT", "Z"):
        return timezone.utc
    m = re.fullmatch(r"(?:UTC|GMT)\s*([+-])(\d{1,2})(?::?(\d{2}))?", text, re.IGNORECASE)
    if m:
        sign = -1 if m.group(1) == "-" else 1
        hours = int(m.group(2))
        minutes = int(m.group(3) or 0)
        return timezone(sign * timedelta(hours=hours, minutes=minutes))
    return ZoneInfo(spec)


def render_time_token(letter, count, dt, milliseconds, offset_minutes):
    if letter == "y":
        if count == 2:
            return f"{(dt.year % 100 + 100) % 100:02d}"
        return str(dt.year).zfill(count) if count >= 4 else str(dt.year)
    if letter == "M":
        if count == 1:
            return str(dt.month)
        if count == 2:
            return f"{dt.month:02d}"
        if count == 3:
            return MONTHS_SHORT[dt.month - 1]
        return MONTHS_FULL[dt.month - 1]
    if letter == "d":
        return str(dt.day) if count == 1 else f"{dt.day:02d}"
    if letter == "E":
        short = dt.strftime("%a")
        return WEEKDAYS_FULL[short] if count >= 4 else short
    if letter == "H":
        return str(dt.hour) if count == 1 else f"{dt.hour:02d}"
    if letter == "h":
        hour12 = 12 if dt.hour % 12 == 0 else dt.hour % 12
        return str(hour12) if count == 1 else f"{hour12:02d}"
    if letter == "a":
        return "AM" if dt.hour < 12 else "PM"
    if letter == "m":
        return str(dt.minute) if count == 1 else f"{dt.minute:02d}"
    if letter == "s":
        return str(dt.second) if count == 1 else f"{dt.second:02d}"
    if letter == "S":
        return f"{milliseconds:03d}"[:count]
    if letter == "Z":
        sign = "-" if offset_minutes < 0 else "+"
        absolute = abs(offset_minutes)
        return f"{sign}{absolute // 60:02d}{absolute % 60:02d}"
    raise ValueError(f"unsupported token {letter}")


def py_format_time(time_ms, fmt=None, tz_spec=None):
    if time_ms is None or (isinstance(time_ms, float) and math.isnan(time_ms)):
        return NA
    zone = resolve_zone(tz_spec)
    dt = datetime.fromtimestamp(time_ms / 1000, zone)
    milliseconds = datetime.fromtimestamp(time_ms / 1000, timezone.utc).microsecond // 1000
    offset = dt.utcoffset()
    offset_minutes = int(offset.total_seconds() // 60) if offset is not None else 0

    fmt = fmt if fmt is not None else "yyyy-MM-dd'T'HH:mm:ssZ"
    out, index = "", 0
    while index < len(fmt):
        ch = fmt[index]
        if ch == "'":
            span, index = consume_quoted(fmt, index)
            out += span
            continue
        if ch.isalpha():
            count = 1
            while index + count < len(fmt) and fmt[index + count] == ch:
                count += 1
            out += render_time_token(ch, count, dt, milliseconds, offset_minutes)
            index += count
            continue
        out += ch
        index += 1
    return out


def gen_str() -> None:
    cases: dict[str, tuple[list[dict], list]] = {
        "contains": (
            [
                {"source": "NASDAQ:AAPL", "str": ":"},
                {"source": "NASDAQ:AAPL", "str": "NYSE"},
                {"source": "abc", "str": ""},
                {"source": None, "str": "x"},
            ],
            [True, False, True, NA],
        ),
        "endswith": (
            [
                {"source": "FTX:BTCUSD", "str": "USD"},
                {"source": "FTX:BTCUSD", "str": "BTC"},
                {"source": None, "str": "x"},
            ],
            [True, False, NA],
        ),
        "startswith": (
            [
                {"source": "FTX:BTCUSD", "str": "FTX"},
                {"source": "FTX:BTCUSD", "str": "BTC"},
                {"source": None, "str": "x"},
            ],
            [True, False, NA],
        ),
        "length": (
            [
                {"source": "NASDAQ:AAPL"},
                {"source": ""},
                {"source": None},
            ],
            [11, 0, NA],
        ),
        "lower": (
            [{"source": "PiNe-Ts"}, {"source": "ALREADY"}, {"source": None}],
            ["pine-ts", "already", NA],
        ),
        "upper": (
            [{"source": "PiNe-Ts"}, {"source": "already"}, {"source": None}],
            ["PINE-TS", "ALREADY", NA],
        ),
        "trim": (
            [
                {"source": "  abc\t\n"},
                {"source": "\u0007buzz\u001f"},
                {"source": "   "},
                {"source": None},
                {"source": "\u00a0pad\u00a0"},
            ],
            ["abc", "buzz", "", "", "\u00a0pad\u00a0".strip()],
        ),
        "pos": (
            [
                {"source": "NASDAQ:AAPL", "str": ":"},
                {"source": "aaa", "str": "aa"},
                {"source": "abc", "str": "z"},
                {"source": None, "str": "x"},
            ],
            [6, 0, NA, NA],
        ),
        "repeat": (
            [
                {"source": "?", "repeat": 3, "separator": ","},
                {"source": "ab", "repeat": 2, "separator": ""},
                {"source": "ab", "repeat": 0, "separator": "-"},
                {"source": None, "repeat": 3, "separator": ""},
            ],
            ["?,?,?", "abab", "", NA],
        ),
        "replace": (
            [
                {"source": "FTX:BTCUSD / FTX:BTCEUR", "target": "FTX", "replacement": "BINANCE", "occurrence": 0},
                {"source": "FTX:BTCUSD / FTX:BTCEUR", "target": "FTX", "replacement": "BINANCE", "occurrence": 1},
                {"source": "one FTX", "target": "FTX", "replacement": "X", "occurrence": 3},
                {"source": "a-b-c", "target": "-", "replacement": "+"},
                {"source": None, "target": "a", "replacement": "b"},
            ],
            [
                "BINANCE:BTCUSD / FTX:BTCEUR",
                "FTX:BTCUSD / BINANCE:BTCEUR",
                "one FTX",
                "a+b-c",
                NA,
            ],
        ),
        "replace_all": (
            [
                {"source": "a-b-c-d", "target": "-", "replacement": "+"},
                {"source": "mississippi", "target": "ss", "replacement": "s"},
                {"source": None, "target": "a", "replacement": "b"},
            ],
            ["a-b-c-d".replace("-", "+"), "mississippi".replace("ss", "s"), NA],
        ),
        "substring": (
            [
                {"source": "NASDAQ:AAPL", "begin_pos": 7},
                {"source": "NASDAQ:AAPL", "begin_pos": 0, "end_pos": 6},
                {"source": "abc", "begin_pos": 1, "end_pos": 1},
                {"source": "abc", "begin_pos": 3},
                {"source": None, "begin_pos": 0},
            ],
            ["AAPL", "NASDAQ", "", "", NA],
        ),
        "match": (
            [
                {"source": "It's time to sell some NASDAQ:AAPL!", "regex": "[\\w]+:[\\w]+"},
                {"source": "hello world", "regex": "\\d+"},
                {"source": None, "regex": "x"},
            ],
            ["NASDAQ:AAPL", "", NA],
        ),
        "tonumber": (
            [
                {"source": "42"},
                {"source": "-3.5"},
                {"source": "+.5"},
                {"source": "1.5e3"},
                {"source": "-2E-2"},
                {"source": "abc"},
                {"source": ""},
                {"source": "0x10"},
                {"source": "Infinity"},
                {"source": " 1.5"},
                {"source": None},
            ],
            [42.0, -3.5, 0.5, 1500.0, -0.02, NA, NA, NA, NA, NA, NA],
        ),
    }

    for name, (inputs, expected) in cases.items():
        dump(
            STR_DIR / f"{name}.basic.json",
            {
                "name": f"str.{name}",
                "pineVersion": 6,
                "input": {"cases": inputs},
                "expected": {name: expected},
            },
        )

    # -- tostring -------------------------------------------------------------
    tostring_cases = [
        ({"value": 42}, "42"),
        ({"value": 3.5}, "3.5"),
        ({"value": True}, "true"),
        ({"value": False}, "false"),
        ({"value": "as is"}, "as is"),
        ({"value": None}, "NaN"),
        ({"value": 3.99, "format": "#"}, "4"),
        ({"value": 1.34, "format": "#.##"}, "1.34"),
        ({"value": 1.3, "format": "#.##"}, "1.3"),
        ({"value": 1.3, "format": "#.00"}, "1.30"),
        ({"value": 0.5, "format": "#.000"}, "0.500"),
        ({"value": 1234.5, "format": "#,##0.0"}, "1,234.5"),
        ({"value": -1234.5, "format": "#,##0.0"}, "-1,234.5"),
        ({"value": 42, "format": "000"}, "042"),
        ({"value": 1.234, "mintick": 0.01}, "1.23"),
        ({"value": 1.2, "mintick": 0.01}, "1.20"),
        ({"value": 1234.5, "mintick": 0.25}, "1234.50"),
    ]
    dump(
        STR_DIR / "tostring.basic.json",
        {
            "name": "str.tostring",
            "pineVersion": 6,
            "input": {"cases": [c[0] for c in tostring_cases]},
            "expected": {"tostring": [c[1] for c in tostring_cases]},
        },
    )

    # -- format ---------------------------------------------------------------
    format_cases = [
        (["Number {0} is not {1} to {2}", 1, "equal", 4], "Number 1 is not equal to 4"),
        (["{0} != {0}", 1.34], "1.34 != 1.34"),
        (["{0,number,#.#}", 1.34], "1.3"),
        (["{0, number, integer}", 1.34], "1"),
        (["{0,number,currency}", 1.34], "$1.34"),
        (["{0, number, currency}", 1340000], "$1,340,000.00"),
        (["{0,number,percent}", 0.5], "50%"),
        (["Return {0, number, percent} - {1, number, percent}", 0.1, 0.2], "Return 10% - 20%"),
        (["{0} and {1}", True, "false"], "true and false"),
        (["value = {0}", None], "value = NaN"),
        (["'{0}' is literal", 5], "{0} is literal"),
        (["it''s {0}", 1], "it's 1"),
        (["ab }}{0} de", 1], "ab }}1 de"),
        (["ab }{0} de", 1], "ab }1 de"),
    ]
    dump(
        STR_DIR / "format.basic.json",
        {
            "name": "str.format",
            "pineVersion": 6,
            "input": {"cases": [{"args": c[0]} for c in format_cases]},
            "expected": {"format": [c[1] for c in format_cases]},
        },
    )
    # sanity: the Python mirror must agree with the recorded expectations
    for (args, expected) in format_cases:
        actual = py_format(args[0], args[1:])
        assert actual == expected, f"str.format mirror mismatch: {args!r} -> {actual!r}"

    # -- format_time ------------------------------------------------------------
    time = 1705329045123  # 2024-01-15T14:30:45.123Z
    format_time_cases = [
        ({"time": time}, "2024-01-15T14:30:45+0000"),
        ({"time": time, "format": "yyyy-MM-dd HH:mm:ss.SSS"}, "2024-01-15 14:30:45.123"),
        ({"time": time, "format": "yy-M-d h:m:s a"}, "24-1-15 2:30:45 PM"),
        ({"time": time, "format": "EEE yyyy/MM/dd"}, "Mon 2024/01/15"),
        ({"time": time, "format": "EEEE, MMMM d, yyyy"}, "Monday, January 15, 2024"),
        ({"time": time, "format": "S"}, "1"),
        ({"time": time, "format": "yyyy-MM-dd HH:mm:ss Z", "timezone": "America/New_York"},
         "2024-01-15 09:30:45 -0500"),
        ({"time": 1721053845123, "format": "yyyy-MM-dd HH:mm:ss Z", "timezone": "America/New_York"},
         "2024-07-15 10:30:45 -0400"),
        ({"time": time, "format": "yyyy-MM-dd HH:mm:ss", "timezone": "Asia/Kolkata"},
         "2024-01-15 20:00:45"),
        ({"time": time, "format": "HH:mm Z", "timezone": "UTC-5"}, "09:30 -0500"),
        ({"time": time, "format": "HH:mm Z", "timezone": "GMT+0530"}, "20:00 +0530"),
        ({"time": time, "format": "HH:mm Z", "timezone": "GMT"}, "14:30 +0000"),
        ({"time": None}, NA),
    ]
    dump(
        STR_DIR / "format_time.basic.json",
        {
            "name": "str.format_time",
            "pineVersion": 6,
            "input": {"cases": [c[0] for c in format_time_cases]},
            "expected": {"format_time": [c[1] for c in format_time_cases]},
        },
    )
    for (case, expected) in format_time_cases:
        actual = py_format_time(case.get("time"), case.get("format"), case.get("timezone"))
        assert actual == expected, f"str.format_time mirror mismatch: {case!r} -> {actual!r}"


if __name__ == "__main__":
    gen_math()
    gen_str()
    print("math + str fixtures generated.")
