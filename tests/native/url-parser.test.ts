import { describe, it, expect } from "vitest";
import { parseUrl, parseUrlType, isShortUrl } from "../../src/engine/native/url-parser.js";
import type { ParsedUrl } from "../../src/engine/types.js";

// Each vector's expected output was derived against the vendor's actual
// control flow (url_parser.py + validators.py), preserving its two warts:
//   - type detection on path only; id extraction over the full URL string
//   - id regexes are case-sensitive (uppercase hosts miss the live id)

type Case = { url: string; expected: ParsedUrl | null; note?: string };

const cases: Case[] = [
  {
    url: "https://www.douyin.com/video/7123456789",
    expected: { original_url: "https://www.douyin.com/video/7123456789", type: "video", aweme_id: "7123456789" },
  },
  {
    url: "https://www.douyin.com/video/7123456789?modal_id=9999",
    expected: { original_url: "https://www.douyin.com/video/7123456789?modal_id=9999", type: "video", aweme_id: "7123456789" },
    note: "first /video/ match wins over the modal_id decoy",
  },
  {
    url: "https://www.douyin.com/video/?modal_id=7555",
    expected: { original_url: "https://www.douyin.com/video/?modal_id=7555", type: "video", aweme_id: "7555" },
    note: "path is /video/ so type=video; /video/(\\d+) fails, modal_id fallback fires",
  },
  {
    url: "https://www.douyin.com/?modal_id=7555",
    expected: null,
    note: "ASYMMETRY: modal_id in query, but no /video/ in path -> no type -> null",
  },
  {
    url: "https://www.douyin.com/user/MS4wLjABAAAA_abc-123",
    expected: { original_url: "https://www.douyin.com/user/MS4wLjABAAAA_abc-123", type: "user", sec_uid: "MS4wLjABAAAA_abc-123" },
    note: "sec_uid charset includes _ and -",
  },
  {
    url: "https://www.douyin.com/user/name?foo=bar",
    expected: { original_url: "https://www.douyin.com/user/name?foo=bar", type: "user", sec_uid: "name" },
  },
  {
    url: "https://www.douyin.com/collection/7321654987",
    expected: { original_url: "https://www.douyin.com/collection/7321654987", type: "collection", mix_id: "7321654987" },
  },
  {
    url: "https://www.douyin.com/mix/7321654987",
    expected: { original_url: "https://www.douyin.com/mix/7321654987", type: "collection", mix_id: "7321654987" },
  },
  {
    url: "https://www.douyin.com/note/7777777777",
    expected: { original_url: "https://www.douyin.com/note/7777777777", type: "gallery", note_id: "7777777777", aweme_id: "7777777777" },
    note: "gallery sets BOTH note_id and aweme_id",
  },
  {
    url: "https://www.douyin.com/gallery/7777777777",
    expected: { original_url: "https://www.douyin.com/gallery/7777777777", type: "gallery", note_id: "7777777777", aweme_id: "7777777777" },
  },
  {
    url: "https://www.douyin.com/slides/7777777777",
    expected: { original_url: "https://www.douyin.com/slides/7777777777", type: "gallery", note_id: "7777777777", aweme_id: "7777777777" },
  },
  {
    url: "https://www.douyin.com/music/123456789",
    expected: { original_url: "https://www.douyin.com/music/123456789", type: "music", music_id: "123456789" },
  },
  {
    url: "https://www.douyin.com/follow/live/88888888",
    expected: { original_url: "https://www.douyin.com/follow/live/88888888", type: "live", room_id: "88888888" },
    note: "/follow/live/ path contains /live/ -> live; /live/(\\d+) extracts id",
  },
  {
    url: "https://live.douyin.com/88888888",
    expected: { original_url: "https://live.douyin.com/88888888", type: "live", room_id: "88888888" },
    note: "live subdomain -> live; /live/(\\d+) misses, live.douyin.com/(\\d+) fallback fires",
  },
  {
    url: "HTTPS://LIVE.DOUYIN.COM/88888888",
    expected: { original_url: "HTTPS://LIVE.DOUYIN.COM/88888888", type: "live" },
    note: "PARITY WART: host-match is case-insensitive (type=live) but the id regex is case-sensitive -> no room_id",
  },
  {
    url: "https://www.douyin.com/video/123?ref=/video/999",
    expected: { original_url: "https://www.douyin.com/video/123?ref=/video/999", type: "video", aweme_id: "123" },
    note: "first /video/ match (path) wins over the query decoy",
  },
  {
    url: "https://www.douyin.com/video/123#/music/456",
    expected: { original_url: "https://www.douyin.com/video/123#/music/456", type: "video", aweme_id: "123" },
    note: "fragment stripped from path; type stays video",
  },
  {
    url: "www.douyin.com/video/123",
    expected: { original_url: "www.douyin.com/video/123", type: "video", aweme_id: "123" },
    note: "scheme-less long URL: urlparse puts it all in path",
  },
  { url: "v.douyin.com/abc123", expected: { original_url: "v.douyin.com/abc123", type: "short" } },
  { url: "https://v.douyin.com/dBxXxxx/", expected: { original_url: "https://v.douyin.com/dBxXxxx/", type: "short" } },
  { url: "v.iesdouyin.com/dBxXxxx/", expected: { original_url: "v.iesdouyin.com/dBxXxxx/", type: "short" } },
  { url: "https://www.douyin.com/discover", expected: null, note: "unsupported path -> null" },
  { url: "", expected: null, note: "empty input -> null" },
];

describe("native parseUrl (vendor parity)", () => {
  for (const { url, expected, note } of cases) {
    const label = `${JSON.stringify(url)}${note ? ` — ${note}` : ""}`;
    it(label, () => {
      expect(parseUrl(url)).toEqual(expected);
    });
  }
});

describe("isShortUrl", () => {
  it("bare host", () => expect(isShortUrl("v.douyin.com")).toBe(true));
  it("bare host with path", () => expect(isShortUrl("v.douyin.com/abc")).toBe(true));
  it("scheme-prefixed", () => expect(isShortUrl("https://v.iesdouyin.com/x/")).toBe(true));
  it("iesdouyin.com root", () => expect(isShortUrl("iesdouyin.com/share")).toBe(true));
  it("long url is not short", () => expect(isShortUrl("https://www.douyin.com/video/1")).toBe(false));
  it("live subdomain is not short", () => expect(isShortUrl("https://live.douyin.com/1")).toBe(false));
  it("empty is not short", () => expect(isShortUrl("")).toBe(false));
});

describe("parseUrlType", () => {
  it("short before everything", () => expect(parseUrlType("v.douyin.com/x")).toBe("short"));
  it("live subdomain", () => expect(parseUrlType("https://live.douyin.com/1")).toBe("live"));
  it("unsupported -> null", () => expect(parseUrlType("https://www.douyin.com/foo")).toBe(null));
});
