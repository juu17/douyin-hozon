import fs from "node:fs/promises";
import path from "node:path";
import { ParserClient, SidecarError } from "./parser-client.js";
import {
  fileNamesForStem,
  inferImageExtension,
  inferLiveExtension,
  resolveItemDir,
} from "./file-layout.js";
import { fetchAndWrite } from "./fetcher.js";
import { runBounded } from "./concurrency.js";
import { transcribeVideo } from "./transcribe.js";
import type { DedupeDb } from "./db.js";
import type { ProgressBus } from "./progress.js";
import type {
  AssetSpec,
  AwemeAssetBundle,
  MusicAssetBundle,
  PagedResponse,
  ParsedUrl,
} from "./types.js";

export interface DownloadFlags {
  cover: boolean;
  music: boolean;
  avatar: boolean;
  json: boolean;
  transcript?: boolean;
}

export interface TranscriptConfig {
  apiKey: string;
  model?: string;
  apiUrl?: string;
}

export interface DateFilter {
  startTs?: number;        // unix seconds (inclusive)
  endTs?: number;          // unix seconds (inclusive)
}

export interface ItemOutcome {
  aweme_id: string;
  ok: boolean;
  paths: string[];
  error?: string;
  skipped?: boolean;
}

export interface DownloaderOptions {
  client: ParserClient;
  baseDir: string;            // e.g. "./Downloaded"
  modeFolder: string;         // "post" | "like" | "mix" | "music" | "collect"
  flags: DownloadFlags;
  parallelism?: number;       // default 5
  bus?: ProgressBus;
  db?: DedupeDb;              // optional dedup; pass to enable Incremental
  dateFilter?: DateFilter;
  itemLimit?: number;         // 0 = no limit
  transcript?: TranscriptConfig;
  signal?: AbortSignal;       // engine-wide cancel for in-flight HTTP fetches
}

const DEFAULT_PARALLELISM = 5;

// Fetches a single asset, optionally renaming based on Content-Type (images).
async function pullAsset(
  asset: AssetSpec | null,
  destPath: string,
  options: DownloaderOptions,
  preferContentTypeSuffix = false,
): Promise<string | null> {
  if (!asset) return null;
  const result = await fetchAndWrite({
    url: asset.url,
    headers: asset.headers,
    destPath,
    preferContentTypeSuffix,
    signal: options.signal,
  });
  return result.finalPath;
}

async function pullOptional(
  asset: AssetSpec | null,
  destPath: string,
  options: DownloaderOptions,
  preferContentTypeSuffix = false,
): Promise<string | null> {
  try {
    return await pullAsset(asset, destPath, options, preferContentTypeSuffix);
  } catch {
    return null;
  }
}

async function writeJsonMetadata(destPath: string, raw: unknown): Promise<string> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, JSON.stringify(raw, null, 2), "utf8");
  return destPath;
}

// Single aweme (video or gallery) end-to-end.
export async function downloadAweme(
  bundle: AwemeAssetBundle,
  options: DownloaderOptions,
): Promise<ItemOutcome> {
  const { itemDir } = await resolveItemDir({
    baseDir: options.baseDir,
    author: bundle.author.name || "unknown_author",
    mode: options.modeFolder,
    itemFolder: bundle.file_stem,
  });
  const names = fileNamesForStem(bundle.file_stem);
  const written: string[] = [];

  options.bus?.emitProgress({
    kind: "item-start",
    title: bundle.title,
    index: 0,
  });

  try {
    if (bundle.media_type === "video") {
      if (!bundle.video) {
        throw new Error(`No playable video URL for ${bundle.aweme_id}`);
      }
      const videoPath = path.join(itemDir, names.video);
      await pullAsset(bundle.video, videoPath, options);
      written.push(videoPath);

      if (options.flags.cover) {
        const out = await pullOptional(bundle.cover, path.join(itemDir, names.cover), options);
        if (out) written.push(out);
      }
      if (options.flags.music) {
        const out = await pullOptional(bundle.music, path.join(itemDir, names.music), options);
        if (out) written.push(out);
      }
    } else {
      // gallery
      if (bundle.images.length === 0 && bundle.image_live.length === 0) {
        throw new Error(`No gallery assets for ${bundle.aweme_id}`);
      }
      for (let i = 0; i < bundle.images.length; i++) {
        const asset = bundle.images[i]!;
        const suffix = inferImageExtension(asset.url);
        const dest = path.join(itemDir, names.image(i + 1, suffix));
        const out = await pullAsset(asset, dest, options, true);
        if (out) written.push(out);
      }
      for (let i = 0; i < bundle.image_live.length; i++) {
        const asset = bundle.image_live[i]!;
        const suffix = inferLiveExtension(asset.url);
        const dest = path.join(itemDir, names.imageLive(i + 1, suffix));
        const out = await pullAsset(asset, dest, options);
        if (out) written.push(out);
      }
    }

    if (options.flags.avatar && bundle.author.avatar) {
      const out = await pullOptional(bundle.author.avatar, path.join(itemDir, names.avatar), options);
      if (out) written.push(out);
    }

    if (options.flags.json) {
      const out = await writeJsonMetadata(path.join(itemDir, names.json), bundle.raw);
      written.push(out);
    }

    if (
      options.flags.transcript &&
      options.transcript?.apiKey &&
      bundle.media_type === "video"
    ) {
      const videoPath = written.find((p) => p.endsWith(".mp4"));
      if (videoPath) {
        const result = await transcribeVideo(videoPath, itemDir, options.transcript);
        if (result.textPath) written.push(result.textPath);
        if (result.jsonPath) written.push(result.jsonPath);
      }
    }

    options.bus?.emitProgress({ kind: "item-done", success: true, pathHint: itemDir });
    return { aweme_id: bundle.aweme_id, ok: true, paths: written };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.bus?.emitProgress({ kind: "item-done", success: false, error: message });
    return { aweme_id: bundle.aweme_id, ok: false, paths: written, error: message };
  }
}

export async function downloadMusicTrack(
  bundle: MusicAssetBundle,
  options: DownloaderOptions,
): Promise<ItemOutcome> {
  if (!bundle.audio) {
    return {
      aweme_id: bundle.music_id,
      ok: false,
      paths: [],
      error: "No audio URL for music track",
    };
  }

  const { itemDir } = await resolveItemDir({
    baseDir: options.baseDir,
    author: bundle.author || "unknown_author",
    mode: options.modeFolder,
    itemFolder: bundle.file_stem,
  });

  const written: string[] = [];
  options.bus?.emitProgress({ kind: "item-start", title: bundle.title, index: 0 });
  try {
    const audioPath = path.join(itemDir, `${bundle.file_stem}.mp3`);
    await pullAsset(bundle.audio, audioPath, options);
    written.push(audioPath);

    if (options.flags.cover) {
      const out = await pullOptional(
        bundle.cover,
        path.join(itemDir, `${bundle.file_stem}_cover.jpg`),
        options,
      );
      if (out) written.push(out);
    }
    if (options.flags.json) {
      const out = await writeJsonMetadata(
        path.join(itemDir, `${bundle.file_stem}_data.json`),
        bundle.raw,
      );
      written.push(out);
    }

    options.bus?.emitProgress({ kind: "item-done", success: true, pathHint: itemDir });
    return { aweme_id: bundle.music_id, ok: true, paths: written };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.bus?.emitProgress({ kind: "item-done", success: false, error: message });
    return { aweme_id: bundle.music_id, ok: false, paths: written, error: message };
  }
}

// Resolve a possibly-short URL into a parsed kind+id payload.
export async function parseInputUrl(
  client: ParserClient,
  rawUrl: string,
): Promise<ParsedUrl> {
  const trimmed = rawUrl.trim();
  let resolved = trimmed;

  // Mirror upstream's is_short_url heuristic — host check is enough.
  if (looksLikeShortUrl(trimmed)) {
    const longUrl = await client.call<string | null>("resolve_short_url", {
      short_url: trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    });
    if (!longUrl) {
      throw new Error(`Short URL did not resolve: ${trimmed}`);
    }
    resolved = longUrl;
  }

  const parsed = await client.parseUrl(resolved);
  if (!parsed) {
    throw new Error(`Unsupported douyin URL: ${resolved}`);
  }
  return parsed;
}

const SHORT_URL_HOSTS = ["v.douyin.com", "v.iesdouyin.com", "iesdouyin.com"];

function looksLikeShortUrl(url: string): boolean {
  let s = url.toLowerCase();
  for (const scheme of ["https://", "http://"]) {
    if (s.startsWith(scheme)) {
      s = s.slice(scheme.length);
      break;
    }
  }
  return SHORT_URL_HOSTS.some((host) => s === host || s.startsWith(`${host}/`));
}

// Convenience: orchestrate a single-video / image-note URL end-to-end.
// Returns the outcome; caller decides how to surface it.
export async function runSingleAweme(
  rawUrl: string,
  options: DownloaderOptions,
): Promise<ItemOutcome> {
  options.bus?.emitProgress({ kind: "stage", stage: "parsing" });
  const parsed = await parseInputUrl(options.client, rawUrl);
  if (parsed.type !== "video" && parsed.type !== "gallery") {
    throw new Error(`Expected single-aweme URL, got type=${parsed.type}`);
  }
  const awemeId = parsed.aweme_id;
  if (!awemeId) throw new Error(`Could not extract aweme_id from ${rawUrl}`);

  options.bus?.emitProgress({ kind: "stage", stage: "fetching", detail: awemeId });
  const detail = await options.client.call<Record<string, unknown> | null>(
    "get_video_detail",
    { aweme_id: awemeId },
  );
  if (!detail) throw new Error(`Aweme ${awemeId} returned no detail (filtered or removed?)`);

  const bundle = await options.client.call<AwemeAssetBundle>("extract_aweme_assets", {
    aweme_data: detail,
  });

  options.bus?.emitProgress({ kind: "stage", stage: "writing" });
  const outcome = await downloadAweme(bundle, options);
  options.bus?.emitProgress({
    kind: "summary",
    total: 1,
    success: outcome.ok ? 1 : 0,
    failed: outcome.ok ? 0 : 1,
    skipped: 0,
  });
  options.bus?.emitProgress({ kind: "stage", stage: outcome.ok ? "done" : "error" });
  return outcome;
}

export async function runMusicTrack(
  rawUrl: string,
  options: DownloaderOptions,
): Promise<ItemOutcome> {
  options.bus?.emitProgress({ kind: "stage", stage: "parsing" });
  const parsed = await parseInputUrl(options.client, rawUrl);
  if (parsed.type !== "music") {
    throw new Error(`Expected music URL, got type=${parsed.type}`);
  }
  const musicId = parsed.music_id;
  if (!musicId) throw new Error(`Could not extract music_id from ${rawUrl}`);

  options.bus?.emitProgress({ kind: "stage", stage: "fetching", detail: musicId });
  const detail = await options.client.call<Record<string, unknown> | null>(
    "get_music_detail",
    { music_id: musicId },
  );
  if (!detail) throw new Error(`Music ${musicId} returned no detail`);

  const bundle = await options.client.call<MusicAssetBundle>("extract_music_assets", {
    music_detail: detail,
  });

  options.bus?.emitProgress({ kind: "stage", stage: "writing" });
  const outcome = await downloadMusicTrack(bundle, options);
  options.bus?.emitProgress({
    kind: "summary",
    total: 1,
    success: outcome.ok ? 1 : 0,
    failed: outcome.ok ? 0 : 1,
    skipped: 0,
  });
  options.bus?.emitProgress({ kind: "stage", stage: outcome.ok ? "done" : "error" });
  return outcome;
}

// ---------------------------------------------------------------------------
// Paginated mode runners
// ---------------------------------------------------------------------------

interface PaginatedListAweme {
  aweme_id?: string;
  create_time?: number;
  [k: string]: unknown;
}

type FetchPage = (cursor: number) => Promise<PagedResponse<PaginatedListAweme>>;

interface PaginatedRunOptions extends DownloaderOptions {
  fetchPage: FetchPage;
  pageSize?: number;
}

async function collectAwemeList(
  options: PaginatedRunOptions,
): Promise<PaginatedListAweme[]> {
  const limit = options.itemLimit ?? 0;
  const pageSize = options.pageSize ?? 20;
  const startTs = options.dateFilter?.startTs;
  const endTs = options.dateFilter?.endTs;

  const collected: PaginatedListAweme[] = [];
  let cursor = 0;
  let page = 0;
  let stopByDate = false;
  while (true) {
    page += 1;
    const response = await options.fetchPage(cursor);
    const batch = (response.items ?? []).filter((it) => it && it.aweme_id);

    for (const item of batch) {
      const ts = typeof item.create_time === "number" ? item.create_time : undefined;
      if (startTs !== undefined && ts !== undefined && ts < startTs) {
        stopByDate = true;
        continue;
      }
      if (endTs !== undefined && ts !== undefined && ts > endTs) continue;
      collected.push(item);
      if (limit > 0 && collected.length >= limit) break;
    }

    options.bus?.emitProgress({
      kind: "page",
      page,
      totalSoFar: collected.length,
    });

    if (limit > 0 && collected.length >= limit) break;
    if (stopByDate) break;
    if (!response.has_more) break;
    if (typeof response.max_cursor === "number" && response.max_cursor === cursor) break;
    cursor = typeof response.max_cursor === "number" ? response.max_cursor : cursor + pageSize;
    if (page > 500) break;  // safety
  }
  return collected;
}

async function downloadAwemeIds(
  ids: string[],
  options: DownloaderOptions,
): Promise<ItemOutcome[]> {
  const parallelism = options.parallelism ?? 5;
  let index = 0;
  const total = ids.length;
  return runBounded(ids, parallelism, async (awemeId) => {
    index += 1;
    if (options.db?.isDownloaded(awemeId)) {
      options.bus?.emitProgress({
        kind: "item-skip",
        title: awemeId,
        reason: "already in db",
      });
      return { aweme_id: awemeId, ok: true, paths: [], skipped: true };
    }

    options.bus?.emitProgress({ kind: "item-start", title: awemeId, index, total });

    let detail: Record<string, unknown> | null;
    try {
      detail = await options.client.call<Record<string, unknown> | null>(
        "get_video_detail",
        { aweme_id: awemeId },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options.bus?.emitProgress({ kind: "item-done", success: false, error: message });
      return { aweme_id: awemeId, ok: false, paths: [], error: message };
    }
    if (!detail) {
      const reason = "no detail (filtered or removed)";
      options.bus?.emitProgress({ kind: "item-skip", title: awemeId, reason });
      return { aweme_id: awemeId, ok: false, paths: [], skipped: true, error: reason };
    }

    const bundle = await options.client.call<AwemeAssetBundle>("extract_aweme_assets", {
      aweme_data: detail,
    });
    const outcome = await downloadAweme(bundle, options);

    if (outcome.ok && options.db) {
      options.db.addAweme({
        aweme_id: bundle.aweme_id,
        aweme_type: bundle.media_type,
        title: bundle.title,
        author_id: bundle.author.id,
        author_name: bundle.author.name,
        create_time: bundle.publish_ts,
        file_path: outcome.paths[0] ? path.dirname(outcome.paths[0]) : null,
        metadata: JSON.stringify(bundle.raw),
      });
    }

    return outcome;
  });
}

function summarize(items: ItemOutcome[]): {
  success: number;
  failed: number;
  skipped: number;
} {
  let success = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    if (item.skipped) skipped += 1;
    else if (item.ok) success += 1;
    else failed += 1;
  }
  return { success, failed, skipped };
}

function emitSummary(options: DownloaderOptions, items: ItemOutcome[]): void {
  const { success, failed, skipped } = summarize(items);
  options.bus?.emitProgress({
    kind: "summary",
    total: items.length,
    success,
    failed,
    skipped,
  });
  options.bus?.emitProgress({
    kind: "stage",
    stage: failed === 0 ? "done" : "error",
  });
}

async function resolveSecUid(
  client: ParserClient,
  rawUrl: string,
): Promise<string> {
  const parsed = await parseInputUrl(client, rawUrl);
  if (parsed.type !== "user") {
    throw new Error(`Expected /user/{sec_uid} URL, got type=${parsed.type}`);
  }
  if (!parsed.sec_uid) throw new Error(`Could not extract sec_uid from ${rawUrl}`);
  return parsed.sec_uid;
}

async function resolveMixId(client: ParserClient, rawUrl: string): Promise<string> {
  const parsed = await parseInputUrl(client, rawUrl);
  if (parsed.type !== "collection") {
    throw new Error(`Expected /collection/ or /mix/ URL, got type=${parsed.type}`);
  }
  if (!parsed.mix_id) throw new Error(`Could not extract mix_id from ${rawUrl}`);
  return parsed.mix_id;
}

export async function runCollection(
  rawUrl: string,
  options: DownloaderOptions,
): Promise<ItemOutcome[]> {
  options.bus?.emitProgress({ kind: "stage", stage: "parsing" });
  const mixId = await resolveMixId(options.client, rawUrl);

  options.bus?.emitProgress({ kind: "stage", stage: "fetching", detail: mixId });
  const aweme_list = await collectAwemeList({
    ...options,
    fetchPage: async (cursor) =>
      options.client.call<PagedResponse<PaginatedListAweme>>("get_mix_aweme", {
        mix_id: mixId,
        cursor,
        count: 20,
      }),
  });

  options.bus?.emitProgress({ kind: "stage", stage: "writing" });
  const ids = aweme_list.map((a) => a.aweme_id!).filter(Boolean);
  const outcomes = await downloadAwemeIds(ids, options);
  emitSummary(options, outcomes);
  return outcomes;
}

export async function runCreatorLikedPosts(
  rawUrl: string,
  options: DownloaderOptions,
): Promise<ItemOutcome[]> {
  options.bus?.emitProgress({ kind: "stage", stage: "parsing" });
  const secUid = await resolveSecUid(options.client, rawUrl);

  options.bus?.emitProgress({ kind: "stage", stage: "fetching", detail: secUid });
  const aweme_list = await collectAwemeList({
    ...options,
    fetchPage: async (cursor) =>
      options.client.call<PagedResponse<PaginatedListAweme>>("get_user_like", {
        sec_uid: secUid,
        max_cursor: cursor,
        count: 20,
      }),
  });

  options.bus?.emitProgress({ kind: "stage", stage: "writing" });
  const ids = aweme_list.map((a) => a.aweme_id!).filter(Boolean);
  const outcomes = await downloadAwemeIds(ids, options);
  emitSummary(options, outcomes);
  return outcomes;
}

export async function runMyFavoriteCollection(
  options: DownloaderOptions,
): Promise<ItemOutcome[]> {
  options.bus?.emitProgress({ kind: "stage", stage: "parsing" });
  options.bus?.emitProgress({ kind: "stage", stage: "fetching", detail: "self" });

  // Step 1: enumerate the user's collect folders.
  const folders: Array<{ collects_id: string; name?: string }> = [];
  let cursor = 0;
  let page = 0;
  while (true) {
    page += 1;
    const response = await options.client.call<
      PagedResponse<{ collects_id?: string; collects_name?: string }>
    >("get_user_collects", { sec_uid: "self", max_cursor: cursor, count: 10 });
    for (const item of response.items ?? []) {
      const cid = item?.collects_id;
      if (typeof cid === "string" && cid) {
        folders.push({ collects_id: cid, name: item.collects_name });
      }
    }
    options.bus?.emitProgress({
      kind: "page",
      page,
      totalSoFar: folders.length,
    });
    if (!response.has_more) break;
    if (typeof response.max_cursor === "number" && response.max_cursor === cursor) break;
    cursor = typeof response.max_cursor === "number" ? response.max_cursor : cursor + 10;
    if (page > 100) break;
  }

  // Step 2: for each folder, paginate aweme items.
  const allIds: string[] = [];
  for (const folder of folders) {
    const items = await collectAwemeList({
      ...options,
      itemLimit: 0,            // limit applies overall, not per-folder; cap below
      fetchPage: async (innerCursor) =>
        options.client.call<PagedResponse<PaginatedListAweme>>("get_collect_aweme", {
          collects_id: folder.collects_id,
          max_cursor: innerCursor,
          count: 10,
        }),
    });
    for (const item of items) {
      if (item.aweme_id) allIds.push(item.aweme_id);
    }
  }

  const limit = options.itemLimit ?? 0;
  const ids = limit > 0 ? allIds.slice(0, limit) : allIds;

  options.bus?.emitProgress({ kind: "stage", stage: "writing" });
  const outcomes = await downloadAwemeIds(ids, options);
  emitSummary(options, outcomes);
  return outcomes;
}

// Re-export for callers that want to bound a list of items themselves.
export { runBounded };

export function isSidecarError(err: unknown): err is SidecarError {
  return err instanceof SidecarError;
}

export function parseDateFilter(start: string, end: string): DateFilter | undefined {
  const parse = (s: string): number | undefined => {
    if (!s.trim()) return undefined;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return undefined;
    const [_, y, mo, d] = m;
    const ts = Math.floor(Date.UTC(Number(y), Number(mo) - 1, Number(d)) / 1000);
    return Number.isFinite(ts) ? ts : undefined;
  };
  const startTs = parse(start);
  const endTs = parse(end);
  if (startTs === undefined && endTs === undefined) return undefined;
  return { startTs, endTs };
}
