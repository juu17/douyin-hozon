import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _resetDefaultSavePathCacheForTests,
  defaultSavePath,
} from "../../src/engine/file-layout.js";

// We mutate process.env.XDG_DOWNLOAD_DIR + process.env.HOME inside these tests.
// Snapshot once and restore in afterEach so we never leak into siblings.
const originalEnv = {
  XDG_DOWNLOAD_DIR: process.env["XDG_DOWNLOAD_DIR"],
  HOME: process.env["HOME"],
};

function restoreEnv(): void {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetDefaultSavePathCacheForTests();
}

async function mkFakeHome(layout: { downloads?: boolean; xdgFile?: string }): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dy-home-"));
  if (layout.downloads) await fs.mkdir(path.join(home, "Downloads"), { recursive: true });
  if (layout.xdgFile !== undefined) {
    await fs.mkdir(path.join(home, ".config"), { recursive: true });
    await fs.writeFile(path.join(home, ".config", "user-dirs.dirs"), layout.xdgFile, "utf8");
  }
  return home;
}

describe("defaultSavePath OS auto-detection", () => {
  afterEach(restoreEnv);

  // The XDG fallback chain only runs on linux. We can't change process.platform
  // at runtime in a typed way, so we exercise the parser logic indirectly via
  // discoverDownloadsRoot's parseXdgUserDirsFile by setting up the env vars
  // and asserting the resulting path — but only when actually on linux. On
  // macOS / Windows we just check the universal-default shape.

  it("returns ~/Downloads/douyin-hozon/ on the current OS by default", async () => {
    const home = await mkFakeHome({ downloads: true });
    process.env["HOME"] = home;
    delete process.env["XDG_DOWNLOAD_DIR"];
    _resetDefaultSavePathCacheForTests();

    const got = defaultSavePath();
    // The trailing path.sep is part of the contract.
    expect(got.endsWith(path.sep)).toBe(true);
    expect(got).toContain("douyin-hozon");
    await fs.rm(home, { recursive: true, force: true });
  });

  it("caches across calls within one process", () => {
    _resetDefaultSavePathCacheForTests();
    const a = defaultSavePath();
    const b = defaultSavePath();
    expect(a).toBe(b);
  });

  if (process.platform === "linux") {
    it("[linux] honors $XDG_DOWNLOAD_DIR when it exists", async () => {
      const home = await mkFakeHome({});
      const xdgDir = path.join(home, "MyDownloads");
      await fs.mkdir(xdgDir, { recursive: true });
      process.env["HOME"] = home;
      process.env["XDG_DOWNLOAD_DIR"] = xdgDir;
      _resetDefaultSavePathCacheForTests();

      const got = defaultSavePath();
      expect(got.startsWith(xdgDir)).toBe(true);
      await fs.rm(home, { recursive: true, force: true });
    });

    it("[linux] parses XDG_DOWNLOAD_DIR from ~/.config/user-dirs.dirs", async () => {
      const home = await mkFakeHome({
        xdgFile: `# xdg-user-dirs config\nXDG_DOWNLOAD_DIR="$HOME/Téléchargements"\n`,
      });
      await fs.mkdir(path.join(home, "Téléchargements"), { recursive: true });
      process.env["HOME"] = home;
      delete process.env["XDG_DOWNLOAD_DIR"];
      _resetDefaultSavePathCacheForTests();

      const got = defaultSavePath();
      expect(got).toContain("Téléchargements");
      await fs.rm(home, { recursive: true, force: true });
    });

    it("[linux] falls back to ~/Downloads when XDG sources are absent", async () => {
      const home = await mkFakeHome({ downloads: true });
      process.env["HOME"] = home;
      delete process.env["XDG_DOWNLOAD_DIR"];
      _resetDefaultSavePathCacheForTests();

      const got = defaultSavePath();
      expect(got).toContain(path.join(home, "Downloads"));
      await fs.rm(home, { recursive: true, force: true });
    });

    it("[linux] falls all the way back to ~ when no Downloads dir exists", async () => {
      const home = await mkFakeHome({});
      process.env["HOME"] = home;
      delete process.env["XDG_DOWNLOAD_DIR"];
      _resetDefaultSavePathCacheForTests();

      const got = defaultSavePath();
      // Last-resort: <home>/douyin-hozon/ (no Downloads segment).
      expect(got).toBe(path.join(home, "douyin-hozon") + path.sep);
      await fs.rm(home, { recursive: true, force: true });
    });
  }
});
