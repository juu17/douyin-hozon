// Shared low-level helpers for the native asset extractors.

import type { AssetSpec } from "../types.js";

// baseUrl + userAgent used when building download headers. The HTTP layer
// owns UA selection and can override via the context.
export interface NativeParserContext {
  baseUrl: string;
  userAgent: string;
}

// One of the vendor's _USER_AGENT_POOL entries, fixed so native output is
// deterministic when no explicit UA is supplied.
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DEFAULT_BASE_URL = "https://www.douyin.com";

export function defaultContext(): NativeParserContext {
  return { baseUrl: DEFAULT_BASE_URL, userAgent: DEFAULT_USER_AGENT };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Python `x or {}` / dict-coerce: a non-dict (incl. null/list) becomes {}.
export function asDict(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

// Faithful port of _download_headers(api_client, user_agent=None).
// Python: "User-Agent": user_agent or api_client.headers.get("User-Agent", "")
export function downloadHeaders(
  ctx: NativeParserContext,
  userAgent?: string,
): Record<string, string> {
  return {
    Referer: `${ctx.baseUrl}/`,
    Origin: ctx.baseUrl,
    Accept: "*/*",
    "User-Agent": userAgent && userAgent.length > 0 ? userAgent : ctx.userAgent,
  };
}

export function asset(url: string, headers: Record<string, string>): AssetSpec {
  return { url, headers };
}

// Faithful port of _extract_first_url(source). Returns the first non-empty
// string URL from: a dict's "url_list", a bare list, or a bare string.
// Every guard mirrors Python's `isinstance(...) and <non-empty>` checks with
// explicit length/key tests (so [] and {} are treated as empty, like Python).
export function extractFirstUrl(source: unknown): string | null {
  if (isPlainObject(source)) {
    const urlList = source["url_list"];
    if (Array.isArray(urlList) && urlList.length > 0) {
      const first = urlList[0];
      if (typeof first === "string" && first.length > 0) return first;
    }
  } else if (Array.isArray(source)) {
    if (source.length > 0) {
      const first = source[0];
      if (typeof first === "string" && first.length > 0) return first;
    }
  } else if (typeof source === "string") {
    if (source.length > 0) return source;
  }
  return null;
}
