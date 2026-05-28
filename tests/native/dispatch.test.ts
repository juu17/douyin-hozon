import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ParserClient } from "../../src/engine/parser-client.js";
import type { NativeDouyinApiClient } from "../../src/engine/native/api-client.js";
import {
  dispatchExtractAwemeAssets,
  dispatchExtractMusicAssets,
  dispatchGetVideoDetail,
  dispatchParseUrl,
  dispatchResolveShortUrl,
  parserMode,
  type DispatchCtx,
} from "../../src/engine/native/dispatch.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(path.join(here, "fixtures/aweme-cases.json"), "utf8"),
) as { name: string; aweme_data: Record<string, unknown> }[];
const byName = (n: string): Record<string, unknown> => cases.find((c) => c.name === n)!.aweme_data;

function fakeSidecar() {
  return {
    parseUrl: vi.fn(async (url: string) => ({ original_url: url, type: "video", aweme_id: "SIDECAR" })),
    call: vi.fn(async (method: string) => ({ from: "sidecar", method }) as never),
  };
}
// Mock native client: implements the Signer surface (signUrl/buildSignedPath)
// + the network methods the dispatch routes to.
function fakeNative() {
  return {
    signUrl: vi.fn((url: string) => ({ url: `${url}&X-Bogus=MOCK`, userAgent: "UA-NATIVE" })),
    buildSignedPath: vi.fn((p: string, params: Record<string, unknown>) => ({
      url: `https://www.douyin.com${p}?signed`,
      userAgent: "UA-NATIVE",
    })),
    getVideoDetail: vi.fn(async (id: string) => ({ aweme_id: id, from: "native" })),
    resolveShortUrl: vi.fn(async (_u: string) => "https://www.douyin.com/video/777"),
  };
}
const asClient = (f: ReturnType<typeof fakeSidecar>) => f as unknown as ParserClient;
const asNative = (f: ReturnType<typeof fakeNative>) => f as unknown as NativeDouyinApiClient;

const ORIG = process.env.DOUYIN_HOZON_PARSER;
const setMode = (v: string | undefined) =>
  v === undefined ? delete process.env.DOUYIN_HOZON_PARSER : (process.env.DOUYIN_HOZON_PARSER = v);
afterEach(() => setMode(ORIG));

describe("parserMode (native is the default; F1 lossless-id fix in place)", () => {
  it("unset -> native, 'sidecar' -> sidecar, garbage -> native", () => {
    setMode(undefined);
    expect(parserMode()).toBe("native");
    setMode("sidecar");
    expect(parserMode()).toBe("sidecar");
    setMode("Sidecar");
    expect(parserMode()).toBe("native");
  });
});

describe("sidecar mode (explicit opt-in) routes everything to the ParserClient", () => {
  it("parse + network go to client", async () => {
    setMode("sidecar");
    const c = fakeSidecar();
    const ctx: DispatchCtx = { client: asClient(c), native: asNative(fakeNative()) };
    await dispatchParseUrl(ctx, "https://www.douyin.com/video/1");
    await dispatchGetVideoDetail(ctx, "9");
    await dispatchResolveShortUrl(ctx, "https://v.douyin.com/x/");
    expect(c.parseUrl).toHaveBeenCalledOnce();
    expect(c.call).toHaveBeenCalledWith("get_video_detail", { aweme_id: "9", suppress_error: false });
    expect(c.call).toHaveBeenCalledWith("resolve_short_url", { short_url: "https://v.douyin.com/x/" });
  });
});

describe("native mode routes to the native client (sidecar untouched)", () => {
  it("parseUrl is native (neither backend called)", async () => {
    setMode("native");
    const c = fakeSidecar();
    const n = fakeNative();
    const out = await dispatchParseUrl({ client: asClient(c), native: asNative(n) }, "https://www.douyin.com/video/7123456789");
    expect(c.parseUrl).not.toHaveBeenCalled();
    expect(out).toMatchObject({ type: "video", aweme_id: "7123456789" });
  });

  it("get_video_detail + resolve_short_url go to the native client", async () => {
    setMode("native");
    const c = fakeSidecar();
    const n = fakeNative();
    const ctx: DispatchCtx = { client: asClient(c), native: asNative(n) };
    expect(await dispatchGetVideoDetail(ctx, "9")).toEqual({ aweme_id: "9", from: "native" });
    expect(await dispatchResolveShortUrl(ctx, "https://v.douyin.com/x/")).toBe("https://www.douyin.com/video/777");
    expect(n.getVideoDetail).toHaveBeenCalledWith("9", {});
    expect(c.call).not.toHaveBeenCalled();
  });

  it("extract_aweme_assets signs natively (no SigningRequiredError, no fallback)", async () => {
    setMode("native");
    const c = fakeSidecar();
    const n = fakeNative();
    const onFallback = vi.fn();
    // This fixture needs signing (douyin candidate lacking X-Bogus).
    const bundle = await dispatchExtractAwemeAssets({ client: asClient(c), native: asNative(n) }, byName("video_douyin_needs_sign"), onFallback);
    expect(n.signUrl).toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(c.call).not.toHaveBeenCalled();
    expect(bundle.video?.url).toContain("X-Bogus=MOCK");
  });

  it("extract_music_assets is native", async () => {
    setMode("native");
    const c = fakeSidecar();
    const bundle = await dispatchExtractMusicAssets(
      { client: asClient(c), native: asNative(fakeNative()) },
      { id: "9", title: "T", author: "A", play_url: { url_list: ["https://a/x.mp3"] } },
    );
    expect(c.call).not.toHaveBeenCalled();
    expect(bundle.music_id).toBe("9");
  });

  it("falls back to the sidecar when native mode has no native client", async () => {
    setMode("native");
    const c = fakeSidecar();
    const ctx: DispatchCtx = { client: asClient(c), native: null };
    await dispatchGetVideoDetail(ctx, "9"); // no native -> sidecar
    expect(c.call).toHaveBeenCalledWith("get_video_detail", { aweme_id: "9", suppress_error: false });
    // extract: no signer -> SigningRequiredError -> sidecar fallback
    const onFallback = vi.fn();
    await dispatchExtractAwemeAssets(ctx, byName("video_douyin_needs_sign"), onFallback);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(c.call).toHaveBeenCalledWith("extract_aweme_assets", { aweme_data: byName("video_douyin_needs_sign") });
  });
});
