import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildABogus, generateRandomBytes } from "../../src/engine/native/signing/abogus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Golden vectors from the real vendor ABogus under .venv-dev (gmssl), with
// time.time + random.random frozen (signing_oracle.py abogus).
const golden = JSON.parse(
  readFileSync(path.join(here, "fixtures/abogus-golden.json"), "utf8"),
) as {
  label: string;
  params: string;
  body: string;
  user_agent: string;
  fp: string;
  options: number[];
  now_ms: number;
  random_bytes: number[];
  a_bogus: string;
  signed_params: string;
}[];

describe("buildABogus — golden parity vs vendor ABogus", () => {
  for (const v of golden) {
    it(`${v.label} (opts=[${v.options}])`, () => {
      const out = buildABogus(v.params, v.body, {
        userAgent: v.user_agent,
        fp: v.fp,
        options: v.options,
        now: v.now_ms,
        randomBytes: v.random_bytes,
      });
      expect(out.aBogus).toBe(v.a_bogus);
      expect(out.signedParams).toBe(v.signed_params);
    });
  }
});

describe("generateRandomBytes (matches Python with random.random=0)", () => {
  it("rng=()=>0 yields [1,2,5,40] x 3", () => {
    expect(generateRandomBytes(3, () => 0)).toEqual([1, 2, 5, 40, 1, 2, 5, 40, 1, 2, 5, 40]);
  });
});
