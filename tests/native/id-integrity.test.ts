// V1/V4 (retro-audit F1/F4) — proves a bare 19-digit numeric id on the wire
// reaches the extracted bundle (and the on-disk filename stem) as the exact
// digits, not a JSON.parse-truncated number. The earlier DB-poisoning half of
// V4 was removed alongside the SQLite dedup feature in W7.2 — the file_stem
// proof on the extractor's output is what guards persistent corruption now.
import { describe, it, expect } from "vitest";
import { losslessJsonParse } from "../../src/engine/native/lossless-json.js";
import { extractAwemeAssets } from "../../src/engine/native/aweme-assets.js";
import { defaultContext } from "../../src/engine/native/assets-common.js";

const AWEME_ID = "7345678901234567890"; // 19 digits, > 2^53
const UID = "6512345678901234567"; // 19-digit author uid
const TRUNCATED = String(Number(AWEME_ID)); // what naive JSON.parse would have produced

describe("V1/V4: 19-digit ids survive wire -> extract (F1/F4)", () => {
  it("extractAwemeAssets keeps aweme_id and author.id exact end-to-end", () => {
    const raw = `{"aweme_id":${AWEME_ID},"desc":"clip","create_time":1700000000,` +
      `"author":{"uid":${UID},"nickname":"A"},` +
      `"video":{"play_addr":{"url_list":["https://cdn.example.com/x.mp4"]}}}`;
    const awemeData = losslessJsonParse(raw) as Record<string, unknown>;
    const bundle = extractAwemeAssets(awemeData, defaultContext()); // CDN url -> no signer needed
    expect(bundle.aweme_id).toBe(AWEME_ID);
    expect(bundle.file_stem).toContain(AWEME_ID);
    expect(bundle.file_stem).not.toContain(TRUNCATED);
    expect(bundle.author.id).toBe(UID);
  });
});
