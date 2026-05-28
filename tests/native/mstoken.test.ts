import { describe, it, expect } from "vitest";
import {
  isValidMsToken,
  genFalseMsToken,
  extractMsTokenFromSetCookie,
  MsTokenManager,
} from "../../src/engine/native/signing/mstoken.js";

describe("isValidMsToken (len 164 or 184 after strip)", () => {
  it("164 -> true", () => expect(isValidMsToken("x".repeat(164))).toBe(true));
  it("184 -> true", () => expect(isValidMsToken("x".repeat(184))).toBe(true));
  it("183 -> false", () => expect(isValidMsToken("x".repeat(183))).toBe(false));
  it("trims before measuring", () => expect(isValidMsToken(`  ${"x".repeat(164)}  `)).toBe(true));
  it("empty / null -> false", () => {
    expect(isValidMsToken("")).toBe(false);
    expect(isValidMsToken(null)).toBe(false);
    expect(isValidMsToken(undefined)).toBe(false);
  });
});

describe("genFalseMsToken (182 alnum + '==')", () => {
  it("shape: length 184, '==' suffix, alnum body, valid", () => {
    const t = genFalseMsToken();
    expect(t).toHaveLength(184);
    expect(t.endsWith("==")).toBe(true);
    expect(t.slice(0, 182)).toMatch(/^[A-Za-z0-9]{182}$/);
    expect(isValidMsToken(t)).toBe(true);
  });
  it("deterministic given an rng", () => {
    expect(genFalseMsToken(() => 0)).toBe(`${"a".repeat(182)}==`);
  });
});

describe("extractMsTokenFromSetCookie", () => {
  it("first msToken value across Set-Cookie lines", () => {
    expect(extractMsTokenFromSetCookie(["msToken=ABC123; Path=/; Secure", "other=1"])).toBe("ABC123");
  });
  it("finds msToken not at the head of the header", () => {
    expect(extractMsTokenFromSetCookie(["foo=1; msToken=XYZ; Path=/"])).toBe("XYZ");
  });
  it("no msToken -> null", () => {
    expect(extractMsTokenFromSetCookie(["a=1", "b=2"])).toBeNull();
    expect(extractMsTokenFromSetCookie([])).toBeNull();
  });
});

describe("ensureMsToken (cookie -> real -> false)", () => {
  const mgr = new MsTokenManager("UA-TEST");
  it("returns the existing cookie msToken, trimmed (no validity gate)", async () => {
    expect(await mgr.ensureMsToken({ msToken: "  tok  " }, async () => "UNUSED")).toBe("tok");
  });
  it("returns the real token when available", async () => {
    expect(await mgr.ensureMsToken({}, async () => "REALTOKEN")).toBe("REALTOKEN");
  });
  it("falls back to a random token when no cookie and no real", async () => {
    const t = await mgr.ensureMsToken({}, async () => null);
    expect(t).toHaveLength(184);
    expect(isValidMsToken(t)).toBe(true);
  });
});
