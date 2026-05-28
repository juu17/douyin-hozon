import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";

// Legacy layout (when all four Path Preference toggles are on):
//   <base>/<author>/<mode>/<date>_<title>_<aweme_id>/
// Untoggling pathAuthor / pathMode drops the matching directory segment;
// untoggling pathDate / pathTitle reshapes the itemFolder name (composed by
// the caller from bundle parts). All-untoggled collapses to:
//   <base>/<aweme_id>/<aweme_id>.mp4 ...
// Caller passes already-sanitized author name + already-composed itemFolder.

// Platform-aware default download root. Discovers the OS-conventional user
// Downloads dir, then appends a `douyin-hozon/` subfolder so we don't pollute
// the root. Resolved once per process — used as the placeholder in the TUI's
// Save Path field and as the engine's fallback when savePath is empty.
//
//   macOS / Windows: ~/Downloads is the universal default (Finder + Explorer
//     treat it as the system-managed download target).
//   Linux: respects xdg-user-dirs ($XDG_DOWNLOAD_DIR env or the on-disk
//     ~/.config/user-dirs.dirs file), since distros + DEs vary on whether
//     ~/Downloads even exists.
let cachedSavePath: string | null = null;

export function defaultSavePath(): string {
  if (cachedSavePath === null) {
    cachedSavePath = path.join(discoverDownloadsRoot(), "douyin-hozon") + path.sep;
  }
  return cachedSavePath;
}

// For tests + first-run probes: bust the cache so a follow-up call re-resolves
// against the current env/filesystem.
export function _resetDefaultSavePathCacheForTests(): void {
  cachedSavePath = null;
}

function discoverDownloadsRoot(): string {
  const home = os.homedir();

  if (process.platform === "linux") {
    // 1. Honor an explicit env override (set by some session managers).
    const envDir = process.env["XDG_DOWNLOAD_DIR"];
    if (envDir && isDirectory(envDir)) return envDir;

    // 2. Parse ~/.config/user-dirs.dirs — the xdg-user-dirs canonical file.
    //    Format: XDG_DOWNLOAD_DIR="$HOME/Downloads"
    const xdgConfig = path.join(home, ".config", "user-dirs.dirs");
    const fromXdgFile = parseXdgUserDirsFile(xdgConfig, home);
    if (fromXdgFile && isDirectory(fromXdgFile)) return fromXdgFile;

    // 3. Conventional default if it exists.
    const conventional = path.join(home, "Downloads");
    if (isDirectory(conventional)) return conventional;

    // 4. Last resort: ~ itself (subfolder will be mkdir'd under it on demand).
    return home;
  }

  // macOS + Windows: ~/Downloads is the universal user expectation; both OSes
  // ship it as a system folder by default.
  return path.join(home, "Downloads");
}

function parseXdgUserDirsFile(filePath: string, home: string): string | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const m = text.match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"([^"]+)"/m);
  if (!m) return null;
  // Only $HOME shows up in practice; expand it. Other vars stay literal so a
  // misconfigured file surfaces as a bad path rather than a silent surprise.
  return m[1]!.replace(/^\$HOME\b/, home);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
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
  // Optional: when undefined the segment is skipped (pathAuthor / pathMode off).
  author?: string;
  mode?: string;
  itemFolder: string;
}): Promise<ResolvedPaths> {
  const baseDir = expandHome(opts.baseDir);
  const parts = [baseDir];
  if (opts.author) parts.push(opts.author);
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
