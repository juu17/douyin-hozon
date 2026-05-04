import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Mirrors upstream's storage/file_manager.py:FileManager.get_save_path:
//   <base>/<author>/<mode>/<date>_<title>_<aweme_id>/
// `sanitize_filename` is delegated to the sidecar (single source of truth).
// Caller passes the already-sanitized author name + file stem.

// Platform-aware default download root. macOS and Windows both have a
// well-known per-user Downloads dir; Linux follows the same convention.
// We append a `douyin-hozon` subfolder so we don't pollute the root.
export function defaultSavePath(): string {
  return path.join(os.homedir(), "Downloads", "douyin-hozon") + path.sep;
}

// Resolve `~` / `~/...` to the user's home dir before passing to fs APIs.
// node:path.resolve does NOT expand `~` (it'd create a literal `~` folder),
// so any user-entered TUI value flows through here first.
export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export interface ResolvedPaths {
  baseDir: string;       // e.g. /…/Downloaded
  itemDir: string;       // e.g. /…/Downloaded/Alice/post/2023-11-14_hello_123
}

export async function resolveItemDir(opts: {
  baseDir: string;
  author: string;
  mode?: string;
  itemFolder: string;
}): Promise<ResolvedPaths> {
  const baseDir = expandHome(opts.baseDir);
  const parts = [baseDir, opts.author];
  if (opts.mode) parts.push(opts.mode);
  parts.push(opts.itemFolder);
  const itemDir = path.resolve(...parts);
  await fs.mkdir(itemDir, { recursive: true });
  return { baseDir, itemDir };
}

export interface ItemFileNames {
  video: string;
  cover: string;
  music: string;
  avatar: string;
  json: string;
  image: (index: number, suffix: string) => string;
  imageLive: (index: number, suffix: string) => string;
}

export function fileNamesForStem(fileStem: string): ItemFileNames {
  return {
    video: `${fileStem}.mp4`,
    cover: `${fileStem}_cover.jpg`,
    music: `${fileStem}_music.mp3`,
    avatar: `${fileStem}_avatar.jpg`,
    json: `${fileStem}_data.json`,
    image: (i, suffix) => `${fileStem}_${i}${suffix}`,
    imageLive: (i, suffix) => `${fileStem}_live_${i}${suffix}`,
  };
}

const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function inferImageExtension(url: string): string {
  if (!url) return ".jpg";
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase();
  }
  const dotIdx = pathname.lastIndexOf(".");
  if (dotIdx >= 0) {
    const suffix = pathname.slice(dotIdx);
    if (ALLOWED_IMAGE_EXTS.has(suffix)) return suffix;
  }
  const matches = pathname.match(/\.(?:jpe?g|png|webp|gif)(?=[^a-z0-9]|$)/g);
  if (matches && matches.length > 0) return matches[matches.length - 1]!.toLowerCase();
  return ".jpg";
}

export function inferLiveExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const suffix = path.extname(pathname);
    return suffix || ".mp4";
  } catch {
    return ".mp4";
  }
}

const IMAGE_CONTENT_TYPE_SUFFIXES: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function suffixFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const normalized = contentType.split(";")[0]!.trim().toLowerCase();
  return IMAGE_CONTENT_TYPE_SUFFIXES[normalized] ?? null;
}
