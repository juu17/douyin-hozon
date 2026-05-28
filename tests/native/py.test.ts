import { describe, it, expect } from "vitest";
import { pythonTruthy, pyOr } from "../../src/engine/native/py.js";

describe("pythonTruthy (matches Python bool() for JSON values)", () => {
  it("null/undefined -> false", () => {
    expect(pythonTruthy(null)).toBe(false);
    expect(pythonTruthy(undefined)).toBe(false);
  });
  it("booleans", () => {
    expect(pythonTruthy(false)).toBe(false);
    expect(pythonTruthy(true)).toBe(true);
  });
  it("numbers: 0 falsy, others truthy", () => {
    expect(pythonTruthy(0)).toBe(false);
    expect(pythonTruthy(1)).toBe(true);
    expect(pythonTruthy(-1)).toBe(true);
  });
  it("strings: '' falsy", () => {
    expect(pythonTruthy("")).toBe(false);
    expect(pythonTruthy("x")).toBe(true);
  });
  it("arrays: [] falsy (DIVERGES from JS ||)", () => {
    expect(pythonTruthy([])).toBe(false);
    expect(pythonTruthy([1])).toBe(true);
  });
  it("objects: {} falsy (DIVERGES from JS ||)", () => {
    expect(pythonTruthy({})).toBe(false);
    expect(pythonTruthy({ a: 1 })).toBe(true);
    expect(pythonTruthy({ url_list: [] })).toBe(true); // non-empty dict, even if its list is empty
  });
});

describe("pyOr (Python `a or b or c`)", () => {
  it("returns first truthy", () => {
    expect(pyOr(0, 0, "x")).toBe("x");
    expect(pyOr({ a: 1 }, "y")).toEqual({ a: 1 });
  });
  it("skips empty list/dict, picks next truthy", () => {
    expect(pyOr([], { a: 1 })).toEqual({ a: 1 });
    expect(pyOr({}, "fallback")).toBe("fallback");
  });
  it("returns LAST operand when all falsy (x or '' -> '')", () => {
    expect(pyOr(null, undefined, "")).toBe("");
    expect(pyOr(null, [], {})).toEqual({});
  });
  it("non-empty dict is selected even if it later yields nothing", () => {
    // The Trap-4 case: {url_list:[]} is truthy, so it's chosen over the next source.
    expect(pyOr({ url_list: [] }, { url_list: ["u"] })).toEqual({ url_list: [] });
  });
});
