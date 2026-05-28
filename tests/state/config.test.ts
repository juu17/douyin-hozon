import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { bootstrapProjectConfig } from "../../src/downloader.js";
import {
  flushPendingConfigWrite,
  persistConfigDebounced,
  _resetPersistStateForTests,
} from "../../src/state/config-persist.js";
import { INITIAL_STATE, type AppState } from "../../src/state/store.js";

const EXAMPLE_YAML = `modeId: collection
cookieJar: {}
shared:
  savePath: ""
  thread: "3"
  includeCover: false
modes:
  single-video:
    videoUrl: ""
  collection:
    collectionUrl: ""
    limit: "10"
    startTime: "2024-01-01"
    endTime: "2024-12-31"
`;

async function mkTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dy-cfg-"));
}

describe("bootstrapProjectConfig (config.yml ← config.example.yml)", () => {
  let projectRoot: string;
  beforeEach(async () => { projectRoot = await mkTempProject(); _resetPersistStateForTests(); });
  afterEach(async () => { await fs.rm(projectRoot, { recursive: true, force: true }); });

  it("copies config.example.yml on first run, parses shared + per-mode buckets", async () => {
    await fs.writeFile(path.join(projectRoot, "config.example.yml"), EXAMPLE_YAML, "utf8");
    const startup = await bootstrapProjectConfig(projectRoot);
    expect(startup.createdFromExample).toBe(true);
    expect(startup.modeId).toBe("collection");
    expect(startup.shared.thread).toBe("3");
    expect(startup.shared.includeCover).toBe(false);
    expect(startup.byMode.collection?.limit).toBe("10");
    expect(startup.byMode.collection?.startTime).toBe("2024-01-01");
    // config.yml now exists with the example contents.
    expect(await fs.readFile(path.join(projectRoot, "config.yml"), "utf8")).toBe(EXAMPLE_YAML);
  });

  it("each mode is remembered INDEPENDENTLY (collection.limit ≠ creator-liked-posts.limit)", async () => {
    await fs.writeFile(
      path.join(projectRoot, "config.yml"),
      'modeId: collection\ncookieJar: {}\nshared: {}\nmodes:\n  collection:\n    limit: "25"\n  creator-liked-posts:\n    limit: "200"\n',
      "utf8",
    );
    const startup = await bootstrapProjectConfig(projectRoot);
    expect(startup.byMode.collection?.limit).toBe("25");
    expect(startup.byMode["creator-liked-posts"]?.limit).toBe("200");
  });

  it("drops stale / removed fields and unknown modeIds silently", async () => {
    await fs.writeFile(
      path.join(projectRoot, "config.yml"),
      'modeId: not-a-real-mode\ncookieJar: {}\nshared:\n  transcriptEnabled: true\n  useDatabase: true\n  proxy: "http://x"\nmodes:\n  single-video:\n    videoUrl: "kept"\n    unknownField: "dropped"\n',
      "utf8",
    );
    const startup = await bootstrapProjectConfig(projectRoot);
    expect(startup.modeId).toBeUndefined();
    expect(startup.shared.proxy).toBe("http://x");
    expect((startup.shared as Record<string, unknown>)["transcriptEnabled"]).toBeUndefined();
    expect((startup.shared as Record<string, unknown>)["useDatabase"]).toBeUndefined();
    expect(startup.byMode["single-video"]?.videoUrl).toBe("kept");
    expect((startup.byMode["single-video"] as Record<string, unknown>)["unknownField"]).toBeUndefined();
  });

  it("legacy flat `values:` schema migrates to shared + per-mode buckets", async () => {
    await fs.writeFile(
      path.join(projectRoot, "config.yml"),
      'modeId: collection\ncookieJar: {msToken: "tok"}\nvalues:\n  videoUrl: "v"\n  collectionUrl: "c"\n  limit: "7"\n  thread: "9"\n  proxy: "http://leg"\n',
      "utf8",
    );
    const startup = await bootstrapProjectConfig(projectRoot);
    // Shared fields route to shared.
    expect(startup.shared.thread).toBe("9");
    expect(startup.shared.proxy).toBe("http://leg");
    // Per-mode fields route to each mode that owns them (videoUrl only on single-video,
    // collectionUrl only on collection, limit on every mode that exposes it).
    expect(startup.byMode["single-video"]?.videoUrl).toBe("v");
    expect((startup.byMode["single-video"] as Record<string, unknown>)?.["collectionUrl"]).toBeUndefined();
    expect(startup.byMode.collection?.collectionUrl).toBe("c");
    expect(startup.byMode.collection?.limit).toBe("7");
    expect(startup.byMode["creator-liked-posts"]?.limit).toBe("7");
    expect((startup.byMode["image-note"] as Record<string, unknown>)?.["limit"]).toBeUndefined();
    expect(startup.cookieJar).toEqual({ msToken: "tok" });
  });

  it("reports a friendly status when no config.yml and no example", async () => {
    const startup = await bootstrapProjectConfig(projectRoot);
    expect(startup.createdFromExample).toBe(false);
    expect(startup.status).toContain("config.example.yml");
  });
});

describe("config-persist (TUI auto-saves on change)", () => {
  let projectRoot: string;
  let configPath: string;
  beforeEach(async () => {
    projectRoot = await mkTempProject();
    configPath = path.join(projectRoot, "config.yml");
    _resetPersistStateForTests();
  });
  afterEach(async () => { await fs.rm(projectRoot, { recursive: true, force: true }); });

  function state(overrides: Partial<AppState> = {}): AppState {
    return { ...INITIAL_STATE, ...overrides };
  }

  it("flush writes mode + cookieJar + shared + per-mode `modes` sections", async () => {
    const s = state({
      modeId: "collection",
      cookieJar: { msToken: "tok123", ttwid: "ttw" },
      shared: { ...INITIAL_STATE.shared, thread: "8", savePath: "/tmp/out" },
      byMode: {
        ...INITIAL_STATE.byMode,
        collection: { ...INITIAL_STATE.byMode.collection, collectionUrl: "https://col", limit: "12" },
      },
    });
    await flushPendingConfigWrite(configPath, s);
    const parsed = YAML.parse(await fs.readFile(configPath, "utf8")) as {
      modeId: string;
      cookieJar: Record<string, string>;
      shared: Record<string, unknown>;
      modes: Record<string, Record<string, unknown>>;
    };
    expect(parsed.modeId).toBe("collection");
    expect(parsed.cookieJar).toEqual({ msToken: "tok123", ttwid: "ttw" });
    expect(parsed.shared["thread"]).toBe("8");
    expect(parsed.shared["savePath"]).toBe("/tmp/out");
    expect(parsed.modes["collection"]?.["collectionUrl"]).toBe("https://col");
    expect(parsed.modes["collection"]?.["limit"]).toBe("12");
    // All 6 modes appear in the file, not just the active one.
    expect(Object.keys(parsed.modes).sort()).toEqual([
      "collection", "creator-liked-posts", "image-note",
      "music-track", "my-favorite-collection", "single-video",
    ]);
  });

  it("debounced write lands after the delay", async () => {
    persistConfigDebounced(configPath, state({ modeId: "music-track" }), 30);
    await expect(fs.access(configPath)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 80));
    const parsed = YAML.parse(await fs.readFile(configPath, "utf8")) as { modeId: string };
    expect(parsed.modeId).toBe("music-track");
  });

  it("identical content is a no-op (mtime unchanged)", async () => {
    const s = state({ modeId: "image-note" });
    await flushPendingConfigWrite(configPath, s);
    const firstMtime = (await fs.stat(configPath)).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    await flushPendingConfigWrite(configPath, s);
    const secondMtime = (await fs.stat(configPath)).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });
});
