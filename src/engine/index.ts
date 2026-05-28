import path from "node:path";
import { ParserClient } from "./parser-client.js";
import { NativeDouyinApiClient } from "./native/api-client.js";
import { parserMode } from "./native/dispatch.js";
import { ProgressBus } from "./progress.js";
import {
  parseDateFilter,
  runCollection,
  runCreatorLikedPosts,
  runMusicTrack,
  runMyFavoriteCollection,
  runSingleAweme,
  type DownloaderOptions,
  type ItemOutcome,
} from "./downloader.js";
import { defaultSavePath } from "./file-layout.js";
import { urlFieldForMode } from "../modes.js";
import type { ModeId, ValueMap } from "../modes.js";

export interface EnginePaths {
  projectRoot: string;
  pythonBin: string;       // absolute path to .venv/bin/python
  sidecarScript: string;   // absolute path to parser_sidecar.py
  downloaderRoot: string;  // absolute path to vendored douyin-downloader
}

export function resolveEnginePaths(projectRoot: string): EnginePaths {
  const downloaderRoot = process.env.DOUYIN_HOZON_DOWNLOADER_PATH
    ? path.resolve(process.env.DOUYIN_HOZON_DOWNLOADER_PATH)
    : path.join(projectRoot, "douyin-downloader");
  return {
    projectRoot,
    pythonBin: path.join(projectRoot, ".venv", "bin", "python"),
    sidecarScript: path.join(projectRoot, "parser_sidecar.py"),
    downloaderRoot,
  };
}

const COOKIE_FIELD_TO_NAME: Record<string, string> = {
  msToken: "msToken",
  ttwid: "ttwid",
  odin_tt: "odin_tt",
  passportCsrfToken: "passport_csrf_token",
  sidGuard: "sid_guard",
};

function extractCookies(values: ValueMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [valueKey, cookieName] of Object.entries(COOKIE_FIELD_TO_NAME)) {
    const raw = values[valueKey];
    if (typeof raw === "string" && raw.trim()) out[cookieName] = raw.trim();
  }
  return out;
}

const MODE_FOLDER: Record<ModeId, string> = {
  "single-video": "post",
  "image-note": "post",
  "collection": "mix",
  "music-track": "music",
  "creator-liked-posts": "like",
  "my-favorite-collection": "collect",
};

export class Engine {
  private client: ParserClient | null = null;
  // Native signed HTTP client, built only in native mode. In sidecar mode this
  // stays null and `client` (the Python process) does the work.
  private nativeClient: NativeDouyinApiClient | null = null;
  private bus = new ProgressBus();
  // Each launch gets a fresh AbortController; stop() aborts all in-flight
  // HTTP fetches (via DownloaderOptions.signal → fetcher).
  private abortController: AbortController = new AbortController();

  constructor(private readonly paths: EnginePaths) {}

  get progress(): ProgressBus {
    return this.bus;
  }

  async start(values: ValueMap, cookieJar?: Record<string, string> | null): Promise<void> {
    if (this.client || this.nativeClient) return;
    // A captured jar (full ~30-cookie dict from Chrome) wins over the
    // 5-field manual entry.
    const cookies = cookieJar && Object.keys(cookieJar).length > 0
      ? cookieJar
      : extractCookies(values);
    const proxy = typeof values.proxy === "string" ? values.proxy : "";

    if (parserMode() === "native") {
      // Default path: pure TypeScript. No Python sidecar is spawned.
      this.nativeClient = new NativeDouyinApiClient(cookies, proxy);
    } else {
      // Break-glass: DOUYIN_HOZON_PARSER=sidecar spawns the Python sidecar.
      this.client = new ParserClient({
        pythonBin: this.paths.pythonBin,
        sidecarScript: this.paths.sidecarScript,
        cwd: this.paths.projectRoot,
        env: { DOUYIN_HOZON_DOWNLOADER_PATH: this.paths.downloaderRoot },
      });
      this.client.on("stderr", (line) => {
        this.bus.emitProgress({ kind: "stage", stage: "fetching", detail: `[sidecar] ${line}` });
      });
      await this.client.start();
      await this.client.init({ cookies, proxy });
    }
  }

  async stop(): Promise<void> {
    // Abort first so in-flight fetches unwind quickly.
    this.abortController.abort();
    this.abortController = new AbortController();
    const c = this.client;
    this.client = null;
    this.nativeClient = null;
    if (c) await c.shutdown();
  }

  async runMode(modeId: ModeId, values: ValueMap): Promise<ItemOutcome | ItemOutcome[]> {
    if (!this.client && !this.nativeClient) throw new Error("Engine not started");
    const limit = parseLimit(values.limit);
    const dateFilter = parseDateFilter(
      typeof values.startTime === "string" ? values.startTime : "",
      typeof values.endTime === "string" ? values.endTime : "",
    );
    const opts: DownloaderOptions = {
      client: this.client,
      nativeClient: this.nativeClient,
      baseDir: typeof values.savePath === "string" && values.savePath.trim()
        ? values.savePath
        : defaultSavePath(),
      modeFolder: MODE_FOLDER[modeId],
      flags: {
        cover: values.includeCover === true,
        music: values.includeMusic === true,
        avatar: values.includeAvatar === true,
        json: values.includeJson === true,
      },
      bus: this.bus,
      itemLimit: limit,
      dateFilter,
      parallelism: parseThread(values.thread),
      signal: this.abortController.signal,
    };

    // Each mode has its own URL key (videoUrl / noteUrl / …). The mapping
    // lives in modes.ts so adding a mode is a single-file change.
    const url = String(values[urlFieldForMode(modeId)] ?? "");
    switch (modeId) {
      case "single-video":
      case "image-note":
        return runSingleAweme(url, opts);
      case "music-track":
        return runMusicTrack(url, opts);
      case "collection":
        return runCollection(url, opts);
      case "creator-liked-posts":
        return runCreatorLikedPosts(url, opts);
      case "my-favorite-collection":
        return runMyFavoriteCollection(opts);
    }
  }
}

function parseLimit(raw: unknown): number {
  if (typeof raw === "number") return Math.max(0, Math.floor(raw));
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

function parseThread(raw: unknown): number | undefined {
  if (typeof raw === "number") return Math.max(1, Math.floor(raw));
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export type { ItemOutcome } from "./downloader.js";
export type { ProgressEvent } from "./progress.js";
