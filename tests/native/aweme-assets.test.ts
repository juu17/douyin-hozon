// The golden bundles were generated under TZ=UTC (publish_date depends on the
// local timezone, matching Python's datetime.fromtimestamp). Pin it here so the
// committed golden is reproducible on any machine. Must run before any Date use.
process.env.TZ = "UTC";

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  extractAwemeAssets,
  SigningRequiredError,
  type AwemeExtractContext,
  type Signer,
} from "../../src/engine/native/aweme-assets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(path.join(here, "fixtures/aweme-cases.json"), "utf8"),
) as { name: string; aweme_data: Record<string, unknown> }[];
const golden = JSON.parse(
  readFileSync(path.join(here, "fixtures/aweme-golden.json"), "utf8"),
) as Record<string, unknown>;

const byName = (n: string): Record<string, unknown> =>
  cases.find((c) => c.name === n)!.aweme_data;

// Mock signer — MUST match tools/vendor-interpreter/aweme_oracle.py's _StubApiClient
// so native output equals the Python golden byte-for-byte.
const signer: Signer = {
  signUrl: (url) => ({ url: `${url}&X-Bogus=MOCK`, userAgent: "UA-SIGNED" }),
  buildSignedPath: (p, params) => ({
    url: `https://www.douyin.com${p}?${Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&")}&X-Bogus=MOCK`,
    userAgent: "UA-SIGNED",
  }),
};
const ctx: AwemeExtractContext = {
  baseUrl: "https://www.douyin.com",
  userAgent: "UA-TEST",
  signer,
};

describe("extractAwemeAssets — golden parity vs real Python (aweme_oracle.py)", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(extractAwemeAssets(c.aweme_data, ctx)).toEqual(golden[c.name]);
    });
  }
});

describe("signer boundary (Wave 2)", () => {
  const noSigner: AwemeExtractContext = { baseUrl: "https://www.douyin.com", userAgent: "UA-TEST" };

  it("CDN candidate resolves without a signer (the common case)", () => {
    expect(extractAwemeAssets(byName("video_cdn_fallback"), noSigner).video?.url).toBe(
      "https://v.cdn.example.com/x.mp4?watermark=1",
    );
  });
  it("pre-signed douyin url resolves without a signer", () => {
    expect(extractAwemeAssets(byName("video_douyin_presigned"), noSigner).video?.url).toBe(
      "https://www.douyin.com/play/?X-Bogus=ABC",
    );
  });
  it("douyin candidate lacking X-Bogus throws SigningRequiredError without a signer", () => {
    expect(() => extractAwemeAssets(byName("video_douyin_needs_sign"), noSigner)).toThrow(
      SigningRequiredError,
    );
  });
  it("uri-only play path throws SigningRequiredError without a signer", () => {
    expect(() => extractAwemeAssets(byName("video_uri_fallback"), noSigner)).toThrow(
      SigningRequiredError,
    );
  });
});
