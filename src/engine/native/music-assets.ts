// Native port of parser_sidecar.py::extract_music_assets — W2.2.
// Pure: no signing, no network. Turns a /aweme/v1/web/music/detail/ response
// into a MusicAssetBundle of ready-to-fetch (url, headers) pairs.

import type { MusicAssetBundle } from "../types.js";
import { pyOr } from "./py.js";
import {
  asset,
  downloadHeaders,
  extractFirstUrl,
  type NativeParserContext,
} from "./assets-common.js";
import { sanitizeFilename } from "./sanitize.js";

// PRECISION CAVEAT: douyin ids are 19-digit. Python str(id) keeps full
// precision; if `id` arrives as a JS number (via JSON.parse upstream) it is
// already truncated before we see it. The faithful fix is lossless id parsing
// at the data boundary (Wave 3 native HTTP layer / a bigint-aware reviver);
// passing id_str avoids it. We port the `id or id_str` order faithfully here.
export function extractMusicAssets(
  musicDetail: Record<string, unknown>,
  ctx: NativeParserContext,
): MusicAssetBundle {
  // str(music_detail.get("id") or music_detail.get("id_str") or "")
  const musicId = String(pyOr(musicDetail["id"], musicDetail["id_str"], ""));
  // (get("title") or "no_title").strip() or "no_title"
  const title = String(pyOr(musicDetail["title"], "no_title")).trim() || "no_title";
  const author = String(pyOr(musicDetail["author"], "unknown")).trim() || "unknown";
  const fileStem = sanitizeFilename(`${author}_${title}_${musicId}`);

  const headers = downloadHeaders(ctx);
  const audioUrl = extractFirstUrl(musicDetail["play_url"]);
  // _extract_first_url(cover_large or cover_medium or cover_thumb) — pyOr picks
  // the first Python-truthy source, then we extract from that one only.
  const coverUrl = extractFirstUrl(
    pyOr(musicDetail["cover_large"], musicDetail["cover_medium"], musicDetail["cover_thumb"]),
  );

  return {
    music_id: musicId,
    title,
    author,
    file_stem: fileStem,
    audio: audioUrl ? asset(audioUrl, headers) : null,
    cover: coverUrl ? asset(coverUrl, headers) : null,
    raw: musicDetail,
  };
}
