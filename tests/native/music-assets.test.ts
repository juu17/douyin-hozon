import { describe, it, expect } from "vitest";
import { extractMusicAssets } from "../../src/engine/native/music-assets.js";
import type { NativeParserContext } from "../../src/engine/native/assets-common.js";

const ctx: NativeParserContext = { baseUrl: "https://www.douyin.com", userAgent: "UA-TEST" };
const H = {
  Referer: "https://www.douyin.com/",
  Origin: "https://www.douyin.com",
  Accept: "*/*",
  "User-Agent": "UA-TEST",
};

describe("extractMusicAssets (vendor parity)", () => {
  it("full happy path: trims title/author, picks url_list[0]", () => {
    const detail = {
      id: "7123",
      title: "  Summer  ",
      author: "  DJ  ",
      play_url: { url_list: ["https://a/x.mp3"] },
      cover_large: { url_list: ["https://a/c.jpg"] },
    };
    expect(extractMusicAssets(detail, ctx)).toEqual({
      music_id: "7123",
      title: "Summer",
      author: "DJ",
      file_stem: "DJ_Summer_7123",
      audio: { url: "https://a/x.mp3", headers: H },
      cover: { url: "https://a/c.jpg", headers: H },
      raw: detail,
    });
  });

  it("id falls back to id_str; cover_large null -> cover_medium", () => {
    const detail = {
      id: null,
      id_str: "987",
      title: "Night",
      author: "N",
      play_url: ["https://a/y.mp3"],
      cover_large: null,
      cover_medium: { url_list: ["https://a/m.jpg"] },
    };
    const out = extractMusicAssets(detail, ctx);
    expect(out.music_id).toBe("987");
    expect(out.audio).toEqual({ url: "https://a/y.mp3", headers: H });
    expect(out.cover).toEqual({ url: "https://a/m.jpg", headers: H });
  });

  it("TRAP-4a: cover_large={url_list:[]} is truthy -> selected -> yields null (no fall-through)", () => {
    const detail = {
      id: null,
      id_str: null,
      title: "U",
      author: "A",
      play_url: { url_list: ["https://a/u.mp3"] },
      cover_large: { url_list: [] },
      cover_medium: { url_list: ["https://a/should-not-be-used.jpg"] },
    };
    const out = extractMusicAssets(detail, ctx);
    expect(out.music_id).toBe("");
    expect(out.file_stem).toBe("A_U");
    expect(out.cover).toBeNull();
  });

  it("TRAP-4b: cover_large={} is empty/falsy -> falls through to cover_medium", () => {
    const detail = {
      id: "5",
      title: "C",
      author: "T",
      play_url: { url_list: ["https://a/5.mp3"] },
      cover_large: {},
      cover_medium: { url_list: ["https://a/m.jpg"] },
      cover_thumb: null,
    };
    expect(extractMusicAssets(detail, ctx).cover).toEqual({ url: "https://a/m.jpg", headers: H });
  });

  it("null title/author -> defaults; numeric id stringified; bare-string play_url", () => {
    const detail = {
      id: 111,
      title: null,
      author: null,
      play_url: "https://a/d.mp3",
      cover_thumb: { url_list: ["https://a/t.jpg"] },
    };
    expect(extractMusicAssets(detail, ctx)).toMatchObject({
      music_id: "111",
      title: "no_title",
      author: "unknown",
      file_stem: "unknown_no_title_111",
      audio: { url: "https://a/d.mp3", headers: H },
      cover: { url: "https://a/t.jpg", headers: H },
    });
  });

  it("whitespace-only title/author collapse to defaults", () => {
    const detail = {
      id: "222",
      title: "   ",
      author: "\t\n",
      play_url: { url_list: ["https://a/2.mp3"] },
    };
    const out = extractMusicAssets(detail, ctx);
    expect(out.title).toBe("no_title");
    expect(out.author).toBe("unknown");
    expect(out.cover).toBeNull();
  });

  it("play_url url_list[0] not a string -> audio null", () => {
    const detail = { id: "333", title: "B", author: "T", play_url: { url_list: [123, "https://a/b.mp3"] } };
    expect(extractMusicAssets(detail, ctx).audio).toBeNull();
  });

  it("play_url empty list -> audio null", () => {
    const detail = { id: "444", title: "S", author: "Q", play_url: [] };
    expect(extractMusicAssets(detail, ctx).audio).toBeNull();
  });
});
