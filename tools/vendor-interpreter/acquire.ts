// Vendor Interpreter — stage 1: acquisition.
//
// DEV-ONLY. Never invoked by `pnpm install`, `pnpm dev`, or any lifecycle
// hook — it only runs when a maintainer calls `pnpm vendor:acquire` or when
// W1.2/W1.4 import `resolveVendorPath()`. End users never touch this.
//
// Resolution order (cheapest first):
//   1. $DOUYIN_HOZON_DOWNLOADER_PATH (same env the runtime + prerequisite.sh use)
//   2. ./douyin-downloader  (the clone prerequisite.sh maintains at PINNED_COMMIT)
//   3. tarball fetch of PINNED_COMMIT → gitignored .vendor-cache/<sha>/  (fallback)
//
// The commit SHA is the integrity pin: codeload serves an immutable tree for a
// given SHA, so fetching by SHA is itself the guarantee.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VENDOR_REPO = "jiji262/douyin-downloader";
// Keep in lock-step with prerequisite.sh's PINNED_COMMIT.
export const PINNED_COMMIT = "c3ff1df2c52cd1122eefffd6e5ebad61e957b045";

// A directory "looks like" the vendor if its parse surface is present.
const SENTINEL = path.join("core", "api_client.py");

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

async function looksLikeVendor(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, SENTINEL));
    return true;
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  /** Force the tarball fetch even if a local clone exists. */
  force?: boolean;
}

/**
 * Return an absolute path to a usable douyin-downloader checkout, fetching it
 * if necessary. Idempotent — a cached tarball extraction is reused.
 */
export async function resolveVendorPath(opts: ResolveOptions = {}): Promise<string> {
  if (!opts.force) {
    const envPath = process.env["DOUYIN_HOZON_DOWNLOADER_PATH"];
    if (envPath) {
      const abs = path.resolve(envPath);
      if (await looksLikeVendor(abs)) return abs;
    }
    const localClone = path.join(REPO_ROOT, "douyin-downloader");
    if (await looksLikeVendor(localClone)) return localClone;
  }
  return fetchTarball(PINNED_COMMIT);
}

async function fetchTarball(sha: string): Promise<string> {
  const cacheDir = path.join(REPO_ROOT, ".vendor-cache", sha);
  const marker = path.join(cacheDir, ".extracted");
  try {
    await fs.access(marker);
    if (await looksLikeVendor(cacheDir)) return cacheDir;
  } catch {
    // not yet extracted
  }

  const url = `https://codeload.github.com/${VENDOR_REPO}/tar.gz/${sha}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Vendor tarball fetch failed: HTTP ${response.status} for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  // Extract in a temp dir, then move atomically — a symlink/path-escape in the
  // archive can't land inside the repo, and a mid-extract crash can't leave a
  // half-populated cacheDir that the marker would falsely bless.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hozon-vendor-"));
  try {
    const tarPath = path.join(tmpRoot, "vendor.tar.gz");
    await fs.writeFile(tarPath, bytes);
    await fs.mkdir(path.join(tmpRoot, "out"), { recursive: true });
    // GitHub tarballs nest everything under `<repo>-<sha>/`; strip that level.
    await execFileAsync("tar", [
      "xzf", tarPath,
      "-C", path.join(tmpRoot, "out"),
      "--strip-components", "1",
    ]);

    if (!(await looksLikeVendor(path.join(tmpRoot, "out")))) {
      throw new Error(`Extracted tarball is missing ${SENTINEL}; wrong repo/sha?`);
    }

    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(cacheDir), { recursive: true });
    await fs.rename(path.join(tmpRoot, "out"), cacheDir);
    await fs.writeFile(marker, `${sha}\n${new Date().toISOString()}\n`, "utf8");
    return cacheDir;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

// CLI entry: `pnpm vendor:acquire` prints the resolved path.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const force = process.argv.includes("--force");
  resolveVendorPath({ force })
    .then((p) => {
      process.stdout.write(`${p}\n`);
    })
    .catch((err: unknown) => {
      process.stderr.write(`vendor:acquire failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
