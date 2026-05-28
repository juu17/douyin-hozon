import { describe, it, expect } from "vitest";
import { losslessJsonParse, requoteBigIntegers } from "../../src/engine/native/lossless-json.js";

const BIG = "7345678901234567890"; // 19 digits, > 2^53

describe("losslessJsonParse — preserves oversized integer ids as exact strings", () => {
  it("bare 19-digit id -> exact string (plain JSON.parse would truncate)", () => {
    expect((losslessJsonParse(`{"id":${BIG}}`) as { id: unknown }).id).toBe(BIG);
    // prove the bug we're fixing: naive parse corrupts it
    expect(String((JSON.parse(`{"id":${BIG}}`) as { id: number }).id)).not.toBe(BIG);
  });
  it("negative oversized integer -> exact string", () => {
    expect((losslessJsonParse(`{"n":-${BIG}}`) as { n: unknown }).n).toBe(`-${BIG}`);
  });
  it("16-digit value just OVER MAX_SAFE -> string", () => {
    expect((losslessJsonParse('{"x":9007199254740993}') as { x: unknown }).x).toBe("9007199254740993");
  });
  it("MAX_SAFE_INTEGER itself stays a number (not over)", () => {
    expect((losslessJsonParse('{"x":9007199254740991}') as { x: unknown }).x).toBe(9007199254740991);
  });
  it("small ints stay numbers (timestamps, counts)", () => {
    const r = losslessJsonParse('{"create_time":1700000000,"digg_count":12345}') as Record<string, unknown>;
    expect(r["create_time"]).toBe(1700000000);
    expect(r["digg_count"]).toBe(12345);
  });
  it("floats and exponents are untouched", () => {
    expect((losslessJsonParse('{"f":1.5}') as { f: unknown }).f).toBe(1.5);
    expect((losslessJsonParse('{"e":1e21}') as { e: unknown }).e).toBe(1e21);
    expect((losslessJsonParse(`{"big_float":${BIG}.5}`) as { big_float: unknown }).big_float).toBe(Number(`${BIG}.5`));
  });
  it("digits INSIDE string values are never quoted/altered", () => {
    expect((losslessJsonParse(`{"s":"${BIG}"}`) as { s: unknown }).s).toBe(BIG);
    expect((losslessJsonParse('{"s":"a\\"' + BIG + '"}') as { s: unknown }).s).toBe(`a"${BIG}`);
  });
  it("works inside arrays and nesting", () => {
    const r = losslessJsonParse(`{"a":[${BIG},12345],"o":{"id":${BIG}}}`) as { a: unknown[]; o: { id: unknown } };
    expect(r.a[0]).toBe(BIG);
    expect(r.a[1]).toBe(12345);
    expect(r.o.id).toBe(BIG);
  });
  it("is identical to JSON.parse when there are no oversized ints", () => {
    const s = '{"a":1,"b":"two","c":[true,null,3.14],"d":{"e":-5}}';
    expect(losslessJsonParse(s)).toEqual(JSON.parse(s));
    expect(requoteBigIntegers(s)).toBe(s); // no rewrite when nothing exceeds
  });
});
