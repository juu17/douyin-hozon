// Pasting text from douyin's "share" UI gives a noisy blob like:
//   "5.12 Z@m.Du Mwf:/ 04/04 ... # 了不起的精讲团 ...  https://v.douyin.com/jA3Z_lr7tyQ/ 复制此链接，打开Dou音…"
// The user expects: extract the URL, then follow the short-link redirect to
// the canonical long URL. Both are pure HTTP — no upstream sidecar needed.

const DOUYIN_HOST_RE =
  /https?:\/\/(?:[\w-]+\.)?(?:iesdouyin|douyin)\.com\/[^\s一-鿿，。！？、；：""''（）【】《》]+/i;

const SHORT_HOSTS = new Set([
  "v.douyin.com",
  "v.iesdouyin.com",
  "iesdouyin.com",
]);

const RESOLVE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const RESOLVE_TIMEOUT_MS = 10_000;

/**
 * Extract the first douyin URL from arbitrary text. Strips trailing
 * punctuation (commas, periods, slashes that came from the share-text
 * suffix). Returns null if no douyin URL is present.
 */
export function extractDouyinUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(DOUYIN_HOST_RE);
  if (!match) return null;
  // Trim trailing punctuation that the regex's `[^\s…]+` might have included
  // by accident if there's no separator after the URL. Note that we KEEP the
  // path's trailing slash because that's part of the canonical URL.
  return match[0].replace(/[.,;:!?，。！？]+$/, "");
}

/**
 * If `text` already looks like a clean URL (no surrounding noise), pass it
 * through. Otherwise extract the douyin URL. Empty / non-string / no-match
 * returns the original text so the user isn't surprised by their input
 * disappearing.
 */
export function normalizeDouyinUrl(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  // If it's already a bare URL, no extraction needed.
  if (/^https?:\/\/\S+$/.test(trimmed)) return trimmed;
  const extracted = extractDouyinUrl(trimmed);
  return extracted ?? trimmed;
}

export function isShortDouyinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return SHORT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Follow douyin's short-link 302 chain. Returns the canonical long URL.
 * Throws on network error, non-2xx response, or timeout.
 */
export async function resolveShortUrl(
  url: string,
  options: ResolveOptions = {},
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? RESOLVE_TIMEOUT_MS);
  const onExternalAbort = () => ctrl.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": RESOLVE_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} resolving ${url}`);
    }
    return response.url;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Normalize + (if needed) resolve in one call. Returns the final URL the
 * caller should use. `cleaned` is the post-extraction URL (always available),
 * `resolved` is set only if a short URL was followed.
 */
export interface NormalizeResult {
  original: string;
  cleaned: string;
  resolved?: string;
  resolveError?: string;
}

export async function normalizeAndResolve(
  text: string,
  options: ResolveOptions = {},
): Promise<NormalizeResult> {
  const cleaned = normalizeDouyinUrl(text);
  if (!isShortDouyinUrl(cleaned)) {
    return { original: text, cleaned };
  }
  try {
    const resolved = await resolveShortUrl(cleaned, options);
    return { original: text, cleaned, resolved };
  } catch (err) {
    return {
      original: text,
      cleaned,
      resolveError: err instanceof Error ? err.message : String(err),
    };
  }
}
