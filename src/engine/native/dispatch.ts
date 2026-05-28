// Parser/network backend dispatch behind the DOUYIN_HOZON_PARSER flag.
// Native is the default; DOUYIN_HOZON_PARSER=sidecar opts into the Python
// break-glass (ctx.client is null in native mode — sidecar isn't started).

import type { ParserClient } from "../parser-client.js";
import type {
  AwemeAssetBundle,
  MusicAssetBundle,
  PagedResponse,
  ParsedUrl,
} from "../types.js";
import type { PaginatedListAweme } from "../downloader.js";
import { defaultContext } from "./assets-common.js";
import { extractAwemeAssets, SigningRequiredError } from "./aweme-assets.js";
import { extractMusicAssets } from "./music-assets.js";
import { parseUrl } from "./url-parser.js";
import type { NativeDouyinApiClient } from "./api-client.js";

export type ParserMode = "native" | "sidecar";

export function parserMode(): ParserMode {
  return process.env["DOUYIN_HOZON_PARSER"] === "sidecar" ? "sidecar" : "native";
}

// The two backends the dispatch chooses between. `client` is null in native
// mode (the sidecar isn't started), so sidecar-branch callers go through
// sidecar() which asserts it.
export interface DispatchCtx {
  client: ParserClient | null;
  native?: NativeDouyinApiClient | null;
}

const useNative = (ctx: DispatchCtx): NativeDouyinApiClient | null =>
  parserMode() === "native" ? ctx.native ?? null : null;

function sidecar(ctx: DispatchCtx): ParserClient {
  if (!ctx.client) {
    throw new Error("parser backend unavailable: native client missing and sidecar not started");
  }
  return ctx.client;
}

// ---- parse ----

export async function dispatchParseUrl(ctx: DispatchCtx, url: string): Promise<ParsedUrl | null> {
  if (parserMode() === "native") return parseUrl(url);
  return sidecar(ctx).parseUrl(url);
}

export async function dispatchExtractAwemeAssets(
  ctx: DispatchCtx,
  awemeData: Record<string, unknown>,
  onFallback?: (reason: string) => void,
): Promise<AwemeAssetBundle> {
  if (parserMode() === "native") {
    try {
      // The native client is the Signer (signUrl + buildSignedPath).
      return extractAwemeAssets(awemeData, { ...defaultContext(), signer: ctx.native ?? undefined });
    } catch (err) {
      if (!(err instanceof SigningRequiredError)) throw err;
      onFallback?.(err.reason);
    }
  }
  return sidecar(ctx).call<AwemeAssetBundle>("extract_aweme_assets", { aweme_data: awemeData });
}

export async function dispatchExtractMusicAssets(
  ctx: DispatchCtx,
  musicDetail: Record<string, unknown>,
): Promise<MusicAssetBundle> {
  if (parserMode() === "native") return extractMusicAssets(musicDetail, defaultContext());
  return sidecar(ctx).call<MusicAssetBundle>("extract_music_assets", { music_detail: musicDetail });
}

// ---- network ----

export async function dispatchResolveShortUrl(ctx: DispatchCtx, shortUrl: string): Promise<string | null> {
  const native = useNative(ctx);
  if (native) return native.resolveShortUrl(shortUrl);
  return sidecar(ctx).call<string | null>("resolve_short_url", { short_url: shortUrl });
}

export async function dispatchGetVideoDetail(
  ctx: DispatchCtx,
  awemeId: string,
  opts: { suppressError?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const native = useNative(ctx);
  if (native) return native.getVideoDetail(awemeId, opts);
  return sidecar(ctx).call<Record<string, unknown> | null>("get_video_detail", {
    aweme_id: awemeId,
    suppress_error: opts.suppressError ?? false,
  });
}

export async function dispatchGetMusicDetail(
  ctx: DispatchCtx,
  musicId: string,
): Promise<Record<string, unknown> | null> {
  const native = useNative(ctx);
  if (native) return native.getMusicDetail(musicId);
  return sidecar(ctx).call<Record<string, unknown> | null>("get_music_detail", { music_id: musicId });
}

export async function dispatchGetMixAweme(
  ctx: DispatchCtx,
  mixId: string,
  cursor: number,
  count: number,
): Promise<PagedResponse<PaginatedListAweme>> {
  const native = useNative(ctx);
  if (native) return (await native.getMixAweme(mixId, cursor, count)) as unknown as PagedResponse<PaginatedListAweme>;
  return sidecar(ctx).call<PagedResponse<PaginatedListAweme>>("get_mix_aweme", { mix_id: mixId, cursor, count });
}

export async function dispatchGetUserLike(
  ctx: DispatchCtx,
  secUid: string,
  maxCursor: number,
  count: number,
): Promise<PagedResponse<PaginatedListAweme>> {
  const native = useNative(ctx);
  if (native) return (await native.getUserLike(secUid, maxCursor, count)) as unknown as PagedResponse<PaginatedListAweme>;
  return sidecar(ctx).call<PagedResponse<PaginatedListAweme>>("get_user_like", {
    sec_uid: secUid,
    max_cursor: maxCursor,
    count,
  });
}

export async function dispatchGetUserCollects(
  ctx: DispatchCtx,
  secUid: string,
  maxCursor: number,
  count: number,
): Promise<PagedResponse<{ collects_id?: string; collects_name?: string }>> {
  const native = useNative(ctx);
  if (native) {
    return (await native.getUserCollects(secUid, maxCursor, count)) as unknown as PagedResponse<{
      collects_id?: string;
      collects_name?: string;
    }>;
  }
  return sidecar(ctx).call<PagedResponse<{ collects_id?: string; collects_name?: string }>>("get_user_collects", {
    sec_uid: secUid,
    max_cursor: maxCursor,
    count,
  });
}

export async function dispatchGetCollectAweme(
  ctx: DispatchCtx,
  collectsId: string,
  maxCursor: number,
  count: number,
): Promise<PagedResponse<PaginatedListAweme>> {
  const native = useNative(ctx);
  if (native) {
    return (await native.getCollectAweme(collectsId, maxCursor, count)) as unknown as PagedResponse<PaginatedListAweme>;
  }
  return sidecar(ctx).call<PagedResponse<PaginatedListAweme>>("get_collect_aweme", {
    collects_id: collectsId,
    max_cursor: maxCursor,
    count,
  });
}
