// Python-semantics helpers for the native parser port — W2.2.
//
// The vendor extraction code leans on Python's truthiness in `or` chains
// (`video.get("play_addr", {}) or {}`, `url_list or []`, `cover_large or
// cover_medium or cover_thumb`). JS `||`/`??` disagree with Python on the two
// cases that actually occur in douyin JSON: an empty list `[]` and an empty
// dict `{}` are FALSY in Python but TRUTHY in JS. Porting those `or` chains
// with `||` silently changes which branch is taken. These helpers reproduce
// Python truthiness exactly so the ports stay byte-faithful.

// True iff `v` is truthy under Python's `bool(v)` for JSON-shaped values:
//   None/False -> false; 0 -> false; "" -> false; [] -> false; {} -> false;
//   anything non-empty -> true. (NaN can't arrive from JSON; Python bool(nan)
//   is True, and `v !== 0` already yields true for it, so it's consistent.)
export function pythonTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

// Faithful port of Python's `a or b or c ...`: returns the first Python-truthy
// operand, or the LAST operand if all are falsy (`x or ""` yields "" ).
export function pyOr<T>(...values: T[]): T {
  for (const v of values) {
    if (pythonTruthy(v)) return v;
  }
  return values[values.length - 1] as T;
}

// Faithful port of Python int(x) for JSON-shaped values: floats truncate
// toward zero; integer strings (optional sign + surrounding whitespace) parse
// base-10; bool -> 0/1. Returns null where Python int() would RAISE
// (non-integer string, non-finite) so callers can mirror the except branch
// (e.g. `pyInt(x) ?? 0`). Only used for small ints (bit_rate/width/create_time)
// so Number precision is not a concern here.
export function pyInt(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^[+-]?\d+$/.test(t)) return null;
    return Math.trunc(Number(t));
  }
  return null;
}
