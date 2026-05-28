// Turns an aweme_detail dict into an AwemeAssetBundle of ready-to-fetch
// (url, headers) pairs. Pure except for the signing tendril in
// selectVideoAsset (douyin.com candidates lacking X-Bogus, or a uri-only
// play path), which is injected via an optional `signer`. The common case
// (CDN candidates / pre-signed urls) needs no signer.

import type { AssetSpec, AwemeAssetBundle } from "../types.js";
import { pyInt, pyOr, pythonTruthy } from "./py.js";
import {
  asDict,
  asset,
  downloadHeaders,
  extractFirstUrl,
  isPlainObject,
  type NativeParserContext,
} from "./assets-common.js";
import { sanitizeFilename } from "./sanitize.js";

// X-Bogus / a_bogus signer; sync because the signing is pure computation (no IO).
export interface Signer {
  signUrl(url: string): { url: string; userAgent: string };
  buildSignedPath(path: string, params: Record<string, string>): { url: string; userAgent: string };
}

export interface AwemeExtractContext extends NativeParserContext {
  signer?: Signer;
}

// Thrown when a candidate genuinely needs signing but no signer is wired.
// Surfacing it lets the flag dispatch fall back to the sidecar rather than
// silently dropping the asset.
export class SigningRequiredError extends Error {
  constructor(public readonly reason: string) {
    super(`native parser needs a signer: ${reason}`);
    this.name = "SigningRequiredError";
  }
}

const GALLERY_AWEME_TYPES = new Set([2, 68, 150]);

const pad2 = (n: number): string => String(n).padStart(2, "0");

// datetime.fromtimestamp(ts).strftime("%Y-%m-%d") — LOCAL timezone, to match
// the Python sidecar running on the same machine.
function formatLocalDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// _resolve_publish
function resolvePublish(createTime: unknown): { ts: number | null; date: string } {
  if (createTime === null || createTime === undefined || createTime === "") {
    return { ts: null, date: "" };
  }
  const ts = pyInt(createTime); // try: int(create_time) except: -> None
  if (ts === null || ts <= 0) return { ts: null, date: "" };
  return { ts, date: formatLocalDate(ts) };
}

// _pick_highest_quality_play_addr — best play_addr by bit_rate*10000 + width.
function pickHighestQualityPlayAddr(video: unknown): Record<string, unknown> | null {
  const bitRates = isPlainObject(video) ? video["bit_rate"] : null;
  if (!Array.isArray(bitRates) || bitRates.length === 0) return null;
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const entry of bitRates) {
    if (!isPlainObject(entry)) continue;
    const playAddr = entry["play_addr"];
    if (!isPlainObject(playAddr)) continue;
    const br = pyInt(pyOr(entry["bit_rate"], 0)) ?? 0; // try/except -> 0
    // Python int(width) is NOT wrapped; a non-numeric width would raise. width
    // is always numeric in real data, so we fall back to 0 for robustness.
    const width = pyInt(pyOr(playAddr["width"], entry["width"], 0)) ?? 0;
    const score = br * 10_000 + width;
    if (score > bestScore) {
      bestScore = score;
      best = playAddr;
    }
  }
  return best;
}

// _pick_first_media_url
function pickFirstMediaUrl(...sources: unknown[]): string | null {
  for (const s of sources) {
    const u = extractFirstUrl(s);
    if (u) return u;
  }
  return null;
}

// _iter_gallery_items
function iterGalleryItems(awemeData: Record<string, unknown>): unknown[] {
  const imagePost = awemeData["image_post_info"];
  if (isPlainObject(imagePost)) {
    for (const key of ["images", "image_list"]) {
      const cand = imagePost[key];
      if (Array.isArray(cand) && cand.length > 0) return cand;
    }
  }
  const images = pyOr(awemeData["images"], awemeData["image_list"], []);
  return Array.isArray(images) ? images : [];
}

// _detect_media_type
function detectMediaType(awemeData: Record<string, unknown>): "video" | "gallery" {
  if (
    pythonTruthy(awemeData["image_post_info"]) ||
    pythonTruthy(awemeData["images"]) ||
    pythonTruthy(awemeData["image_list"])
  ) {
    return "gallery";
  }
  const at = awemeData["aweme_type"];
  if (typeof at === "number" && Number.isInteger(at) && GALLERY_AWEME_TYPES.has(at)) {
    return "gallery";
  }
  return "video";
}

function hostEndsWith(url: string, suffix: string): boolean {
  try {
    return new URL(url).hostname.endsWith(suffix);
  } catch {
    return false;
  }
}

// _select_video_asset — the only function with a signing dependency.
function selectVideoAsset(
  ctx: AwemeExtractContext,
  awemeData: Record<string, unknown>,
): AssetSpec | null {
  const video = asDict(pyOr(awemeData["video"], {}));
  // play_addr = pick(video) or video.get("play_addr", {}) or {}
  let playAddr: unknown = pickHighestQualityPlayAddr(video);
  if (!pythonTruthy(playAddr)) playAddr = video["play_addr"];
  if (!pythonTruthy(playAddr)) playAddr = {};
  const playAddrDict = asDict(playAddr);

  const urlList = pyOr(playAddrDict["url_list"], []);
  const rawCandidates = Array.isArray(urlList) ? urlList : [];
  const candidates = rawCandidates.filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );
  // .sort(key=lambda u: 0 if "watermark=0" in u else 1) — stable: watermark=0
  // first, original order preserved within each group.
  const sorted = [
    ...candidates.filter((c) => c.includes("watermark=0")),
    ...candidates.filter((c) => !c.includes("watermark=0")),
  ];

  const headers = downloadHeaders(ctx);
  let fallback: AssetSpec | null = null;
  for (const c of sorted) {
    if (hostEndsWith(c, "douyin.com")) {
      if (!c.includes("X-Bogus=")) {
        if (!ctx.signer) throw new SigningRequiredError(`sign_url for douyin candidate ${c}`);
        const signed = ctx.signer.signUrl(c);
        return asset(signed.url, downloadHeaders(ctx, signed.userAgent));
      }
      return asset(c, headers);
    }
    fallback = asset(c, headers);
  }
  if (fallback) return fallback;

  // uri = play_addr.get("uri") or video.get("vid") or download_addr.get("uri")
  const downloadAddr = asDict(pyOr(video["download_addr"], {}));
  const uri = pyOr(playAddrDict["uri"], video["vid"], downloadAddr["uri"]);
  if (pythonTruthy(uri)) {
    if (!ctx.signer) throw new SigningRequiredError(`build_signed_path for uri ${String(uri)}`);
    const params = {
      video_id: String(uri),
      ratio: "1080p",
      line: "0",
      is_play_url: "1",
      watermark: "0",
      source: "PackSourceEnum_PUBLISH",
    };
    const signed = ctx.signer.buildSignedPath("/aweme/v1/play/", params);
    return asset(signed.url, downloadHeaders(ctx, signed.userAgent));
  }
  return null;
}

// _select_image_assets
function selectImageAssets(
  ctx: AwemeExtractContext,
  awemeData: Record<string, unknown>,
): AssetSpec[] {
  const headers = downloadHeaders(ctx);
  const out: AssetSpec[] = [];
  const seen = new Set<string>();
  for (const item of iterGalleryItems(awemeData)) {
    if (!isPlainObject(item)) continue;
    const url = pickFirstMediaUrl(
      item["download_url"],
      item["download_addr"],
      item["download_url_list"],
      item,
      item["display_image"],
      item["owner_watermark_image"],
    );
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(asset(url, headers));
    }
  }
  return out;
}

// _select_image_live_assets
function selectImageLiveAssets(
  ctx: AwemeExtractContext,
  awemeData: Record<string, unknown>,
): AssetSpec[] {
  const headers = downloadHeaders(ctx);
  const out: AssetSpec[] = [];
  const seen = new Set<string>();
  for (const item of iterGalleryItems(awemeData)) {
    if (!isPlainObject(item)) continue;
    const vid = isPlainObject(item["video"]) ? item["video"] : {};
    const hasVid = pythonTruthy(vid);
    const preferred = hasVid ? pickHighestQualityPlayAddr(vid) : null;
    const url = pickFirstMediaUrl(
      preferred,
      hasVid ? vid["play_addr"] : null,
      hasVid ? vid["download_addr"] : null,
      item["video_play_addr"],
      item["video_download_addr"],
    );
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(asset(url, headers));
    }
  }
  return out;
}

// PRECISION CAVEAT (same as music-assets): a 19-digit numeric aweme_id loses
// precision if it round-trips through JSON.parse upstream. losslessJsonParse
// in api-client.ts pre-quotes oversized integers at the wire boundary; we
// port `id or ""` here.
export function extractAwemeAssets(
  awemeData: Record<string, unknown>,
  ctx: AwemeExtractContext,
): AwemeAssetBundle {
  const awemeId = String(pyOr(awemeData["aweme_id"], ""));
  const title = String(pyOr(awemeData["desc"], "no_title")).trim() || "no_title";
  const { ts: publishTs, date } = resolvePublish(awemeData["create_time"]);
  const publishDate = date || formatLocalDate(Date.now() / 1000); // today fallback
  const fileStem = sanitizeFilename(`${publishDate}_${title}_${awemeId}`);
  const mediaType = detectMediaType(awemeData);
  const headers = downloadHeaders(ctx);

  const author = asDict(pyOr(awemeData["author"], {}));
  const avatarUrl = extractFirstUrl(author["avatar_larger"]);
  const uidRaw = author["uid"];
  const authorId = uidRaw == null ? null : typeof uidRaw === "string" ? uidRaw : String(uidRaw);
  const authorPayload = {
    id: authorId,
    name: String(pyOr(author["nickname"], "unknown_author")),
    avatar: avatarUrl ? asset(avatarUrl, headers) : null,
  };

  let videoAsset: AssetSpec | null = null;
  let coverAsset: AssetSpec | null = null;
  let musicAsset: AssetSpec | null = null;
  let images: AssetSpec[] = [];
  let imageLive: AssetSpec[] = [];

  if (mediaType === "video") {
    videoAsset = selectVideoAsset(ctx, awemeData);
    const coverUrl = extractFirstUrl(asDict(pyOr(awemeData["video"], {}))["cover"]);
    if (coverUrl) coverAsset = asset(coverUrl, headers);
    const musicUrl = extractFirstUrl(asDict(pyOr(awemeData["music"], {}))["play_url"]);
    if (musicUrl) musicAsset = asset(musicUrl, headers);
  } else {
    images = selectImageAssets(ctx, awemeData);
    imageLive = selectImageLiveAssets(ctx, awemeData);
  }

  return {
    media_type: mediaType,
    aweme_id: awemeId,
    title,
    publish_ts: publishTs,
    publish_date: publishDate,
    file_stem: fileStem,
    author: authorPayload,
    video: videoAsset,
    cover: coverAsset,
    music: musicAsset,
    images,
    image_live: imageLive,
    raw: awemeData,
  };
}
