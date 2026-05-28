// Native TS port of the vendor's URL parsing — W2.1.
//
// Faithful translation of two vendor files, kept byte-compatible with the
// Python sidecar's `parse_url` so the two backends agree under the
// DOUYIN_HOZON_PARSER flag:
//   - douyin-downloader/core/url_parser.py   (URLParser.parse + _extract_*)
//   - douyin-downloader/utils/validators.py  (is_short_url, parse_url_type)
//
// Vendor-drift note: these surfaces are tracked in vendor-api/tally.json
// (utils/validators.py::parse_url_type, sanitize_filename; core/url_parser.py
// ::URLParser.parse). `pnpm vendor:check` flags upstream signature drift.
//
// Two semantic subtleties preserved verbatim from Python:
//  1. TYPE detection runs on the URL *path only* (Python urlparse().path), but
//     ID extraction runs `re.search` over the *full* URL string. So a decoy in
//     the query/fragment (?ref=/video/9) never changes the type, yet the id
//     regex still scans the whole string (and takes the first match).
//  2. urllib.parse.urlparse never throws and tolerates scheme-less input;
//     JS `new URL()` throws without a scheme. We replicate urlparse's
//     netloc/path split by hand instead of using URL.

import type { ParsedUrl } from "../types.js";

const SHORT_URL_HOSTS = ["v.douyin.com", "v.iesdouyin.com", "iesdouyin.com"] as const;

// Mirror Python urllib.parse.urlparse for the only two fields we read:
// netloc (host[:port], pre-lowercase) and path (no query, no fragment).
// Scheme-less input → empty netloc and the whole remainder as path, exactly
// as urlparse('v.douyin.com/x') yields netloc='' path='v.douyin.com/x'.
function urlSplit(url: string): { netloc: string; path: string } {
  let s = url;
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q);

  // A scheme is `letter [letter|digit|+|-|.]* :` — but only counts when what
  // follows is "//..." or otherwise not a bare port. For real douyin inputs
  // (https URLs or scheme-less hosts) this simple rule matches urlparse.
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.exec(s);
  if (schemeMatch) {
    const afterScheme = s.slice(schemeMatch[0].length);
    const slash = afterScheme.indexOf("/");
    if (slash === -1) return { netloc: afterScheme, path: "" };
    return { netloc: afterScheme.slice(0, slash), path: afterScheme.slice(slash) };
  }
  // No `scheme://` → urlparse puts everything in path, netloc empty.
  return { netloc: "", path: s };
}

// Faithful port of validators.is_short_url: strip a leading http(s):// then
// test the host prefix. Returns true for a bare host or host-prefixed path.
export function isShortUrl(url: string): boolean {
  if (!url) return false;
  let lowered = url.trim().toLowerCase();
  for (const scheme of ["https://", "http://"]) {
    if (lowered.startsWith(scheme)) {
      lowered = lowered.slice(scheme.length);
      break;
    }
  }
  return SHORT_URL_HOSTS.some((host) => lowered === host || lowered.startsWith(`${host}/`));
}

// Faithful port of validators.parse_url_type. Returns the kind or null.
export function parseUrlType(url: string): ParsedUrl["type"] | null {
  if (isShortUrl(url)) return "short";

  const { netloc, path } = urlSplit(url);
  const host = netloc.toLowerCase();

  if (host.startsWith("live.douyin.com")) return "live";
  if (path.includes("/video/")) return "video";
  if (path.includes("/user/")) return "user";
  if (path.includes("/note/") || path.includes("/gallery/") || path.includes("/slides/")) {
    return "gallery";
  }
  if (path.includes("/collection/") || path.includes("/mix/")) return "collection";
  if (path.includes("/music/")) return "music";
  if (path.includes("/live/") || path.includes("/follow/live/")) return "live";
  return null;
}

// re.search over the FULL url string (mirrors the Python id extractors).
function search1(url: string, re: RegExp): string | null {
  const m = re.exec(url);
  return m ? m[1]! : null;
}

function extractVideoId(url: string): string | null {
  return search1(url, /\/video\/(\d+)/) ?? search1(url, /modal_id=(\d+)/);
}

function extractUserId(url: string): string | null {
  return search1(url, /\/user\/([A-Za-z0-9_-]+)/);
}

function extractMixId(url: string): string | null {
  return search1(url, /\/collection\/(\d+)/) ?? search1(url, /\/mix\/(\d+)/);
}

function extractNoteId(url: string): string | null {
  return search1(url, /\/(?:note|gallery|slides)\/(\d+)/);
}

function extractMusicId(url: string): string | null {
  return search1(url, /\/music\/(\d+)/);
}

function extractRoomId(url: string): string | null {
  return search1(url, /\/live\/(\d+)/) ?? search1(url, /live\.douyin\.com\/(\d+)/);
}

// Faithful port of URLParser.parse. Returns null for an unsupported URL;
// otherwise { original_url, type, ...id } where the id field is only present
// when extraction succeeded (matching Python's `if aweme_id:` guards).
export function parseUrl(url: string): ParsedUrl | null {
  const type = parseUrlType(url);
  if (!type) return null;

  const result: ParsedUrl = { original_url: url, type };

  switch (type) {
    case "video": {
      const id = extractVideoId(url);
      if (id) result.aweme_id = id;
      break;
    }
    case "user": {
      const id = extractUserId(url);
      if (id) result.sec_uid = id;
      break;
    }
    case "collection": {
      const id = extractMixId(url);
      if (id) result.mix_id = id;
      break;
    }
    case "gallery": {
      const id = extractNoteId(url);
      if (id) {
        result.note_id = id;
        result.aweme_id = id;
      }
      break;
    }
    case "music": {
      const id = extractMusicId(url);
      if (id) result.music_id = id;
      break;
    }
    case "live": {
      const id = extractRoomId(url);
      if (id) result.room_id = id;
      break;
    }
    case "short":
      // Upstream returns {original_url, type:'short'} with no id field.
      break;
  }

  return result;
}
