import { describe, it, expect, afterEach, vi } from "vitest";
import { NativeDouyinApiClient } from "../../src/engine/native/api-client.js";

// msToken cookie present -> ensureMsToken short-circuits (no network for the token).
const COOKIES = { msToken: "MSTOKEN_PRESENT", sessionid: "abc123" };

function mockFetch(
  impl: (url: string, init: RequestInit) => { status: number; url?: string; body?: unknown; bodyText?: string },
) {
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const r = impl(u, init);
    // requestJson reads resp.text() and parses losslessly; bodyText lets a test
    // inject RAW wire bytes (e.g. an unquoted 19-digit id) that JSON.stringify
    // could never produce.
    const text = r.bodyText ?? JSON.stringify(r.body ?? {});
    return {
      status: r.status,
      url: r.url ?? u,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("signing integration", () => {
  it("signUrl appends X-Bogus", () => {
    const c = new NativeDouyinApiClient(COOKIES);
    expect(c.signUrl("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7&aid=6383").url).toContain("X-Bogus=");
  });
  it("buildSignedPath appends a_bogus and preserves the query", () => {
    const c = new NativeDouyinApiClient(COOKIES);
    const { url } = c.buildSignedPath("/aweme/v1/web/aweme/detail/", { aweme_id: "7", aid: "6383" });
    expect(url).toContain("/aweme/v1/web/aweme/detail/?");
    expect(url).toContain("aweme_id=7");
    expect(url).toContain("a_bogus=");
  });
});

describe("getVideoDetail", () => {
  it("returns aweme_detail and signs + sends cookies", async () => {
    const fn = mockFetch(() => ({ status: 200, body: { aweme_detail: { aweme_id: "7", desc: "hi" } } }));
    const c = new NativeDouyinApiClient(COOKIES);
    const detail = await c.getVideoDetail("7");
    expect(detail).toEqual({ aweme_id: "7", desc: "hi" });
    const [reqUrl, init] = fn.mock.calls[0]!;
    expect(String(reqUrl)).toContain("a_bogus=");
    expect(String(reqUrl)).toContain("aweme_id=7");
    expect((init as RequestInit).headers).toMatchObject({ Cookie: expect.stringContaining("msToken=MSTOKEN_PRESENT") });
  });

  it("V1 oracle: 19-digit aweme_id arriving as a BARE NUMBER survives as the exact string", async () => {
    // Raw wire bytes with an unquoted 19-digit id. Plain JSON.parse would
    // truncate 7345678901234567890 -> 7345678901234568000.
    mockFetch(() => ({
      status: 200,
      bodyText: '{"aweme_detail":{"aweme_id":7345678901234567890,"desc":"x","create_time":1700000000}}',
    }));
    const c = new NativeDouyinApiClient(COOKIES);
    const detail = await c.getVideoDetail("7345678901234567890");
    expect(detail?.["aweme_id"]).toBe("7345678901234567890"); // exact string, not truncated
    expect(String(JSON.parse('{"x":7345678901234567890}').x)).not.toBe("7345678901234567890"); // proves naive parse WOULD corrupt
  });

  it("falls through both aids then returns null when empty", async () => {
    const fn = mockFetch(() => ({ status: 404 })); // <500, !=429 -> {} immediately, no retry delay
    const c = new NativeDouyinApiClient(COOKIES);
    expect(await c.getVideoDetail("7")).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2); // aid 6383 then 1128
  });
});

describe("paged normalization (getUserLike)", () => {
  it("extracts aweme_list, coerces has_more/max_cursor", async () => {
    mockFetch(() => ({ status: 200, body: { aweme_list: [{ aweme_id: "1" }, { aweme_id: "2" }], has_more: 1, max_cursor: 99 } }));
    const c = new NativeDouyinApiClient(COOKIES);
    const page = await c.getUserLike("MS4wSEC", 0, 20);
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.max_cursor).toBe(99);
    expect(page.source).toBe("api");
  });
});

describe("getMixDetail / getMusicDetail unwrap", () => {
  it("getMixDetail prefers mix_info", async () => {
    mockFetch(() => ({ status: 200, body: { mix_info: { mix_id: "m1" } } }));
    const c = new NativeDouyinApiClient(COOKIES);
    expect(await c.getMixDetail("m1")).toEqual({ mix_id: "m1" });
  });
  it("getMusicDetail prefers music_info", async () => {
    mockFetch(() => ({ status: 200, body: { music_info: { id: "mu1" } } }));
    const c = new NativeDouyinApiClient(COOKIES);
    expect(await c.getMusicDetail("mu1")).toEqual({ id: "mu1" });
  });
});

describe("resolveShortUrl", () => {
  it("returns the final redirected url", async () => {
    mockFetch(() => ({ status: 200, url: "https://www.douyin.com/video/7123" }));
    const c = new NativeDouyinApiClient(COOKIES);
    expect(await c.resolveShortUrl("https://v.douyin.com/abc/")).toBe("https://www.douyin.com/video/7123");
  });
  it("returns null on HTTP >= 400", async () => {
    mockFetch(() => ({ status: 404, url: "https://err" }));
    const c = new NativeDouyinApiClient(COOKIES);
    expect(await c.resolveShortUrl("https://v.douyin.com/bad/")).toBeNull();
  });
});
