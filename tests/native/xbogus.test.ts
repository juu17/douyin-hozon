import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildXBogus } from "../../src/engine/native/signing/xbogus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Golden vectors from the real vendor XBogus with frozen time.time
// (tools/vendor-interpreter/signing_oracle.py xbogus).
const golden = JSON.parse(
  readFileSync(path.join(here, "fixtures/xbogus-golden.json"), "utf8"),
) as { label: string; url: string; user_agent: string; timer: number; x_bogus: string; signed_url: string }[];

describe("buildXBogus — golden parity vs vendor XBogus", () => {
  for (const v of golden) {
    it(`${v.label} (timer=${v.timer})`, () => {
      const out = buildXBogus(v.url, { userAgent: v.user_agent, now: v.timer });
      expect(out.xBogus).toBe(v.x_bogus);
      expect(out.signedUrl).toBe(v.signed_url);
      expect(out.userAgent).toBe(v.user_agent);
    });
  }
});

describe("buildXBogus — wall-clock default", () => {
  it("uses Date.now() when no `now` is given and appends &X-Bogus=", () => {
    const out = buildXBogus("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7&aid=6383");
    expect(out.signedUrl).toBe(`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7&aid=6383&X-Bogus=${out.xBogus}`);
    expect(out.xBogus).toHaveLength(28);
  });
});
