// Startup helpers shared between the engine and the TUI bootstrap.
//
// The legacy YAML-config + `python run.py` spawn path is gone. All runtime
// download orchestration now lives in src/engine/. What remains here:
//
//   - resolvePaths           : project + downloader paths used by the bootstrap
//   - dependencyExists       : sanity-check that douyin-downloader is present
//   - mapConfigToValues      : read existing config.yml on first run so users
//                              with a pre-existing config don't have to re-type
//                              cookies / save path / mode in the TUI
//   - bootstrapProjectConfig : the app.tsx mount-time hook that runs the above
//
// Cookies and most fields read from config.yml seed the in-memory store. The
// TUI no longer writes back to config.yml — values are kept in-process and
// survive the session via the engine.

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { urlFieldForMode, type ModeId, type ValueMap } from "./modes.js";

export interface DownloaderPaths {
  projectRoot: string;
  downloaderRoot: string;
}

export interface StartupConfigState {
  configPath: string;
  createdFromExample: boolean;
  modeId?: ModeId;
  values: Partial<ValueMap>;
  status: string;
}

export function resolvePaths(projectRoot: string): DownloaderPaths {
  const downloaderRoot = process.env.DOUYIN_HOZON_DOWNLOADER_PATH
    ? path.resolve(process.env.DOUYIN_HOZON_DOWNLOADER_PATH)
    : path.join(projectRoot, "douyin-downloader");
  return { projectRoot, downloaderRoot };
}

export async function dependencyExists(downloaderRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(downloaderRoot, "core", "api_client.py"));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function readBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function readFirstLink(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
    }
  }
  return undefined;
}

function readModeEntry(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
    }
  }
  return undefined;
}

function inferModeId(modeEntry: string | undefined, link: string | undefined): ModeId | undefined {
  switch (modeEntry) {
    case "music":
      return "music-track";
    case "mix":
      return "collection";
    case "like":
      return "creator-liked-posts";
    case "collect":
      return "my-favorite-collection";
    case "post":
      if (link && /\/(note|gallery)\//.test(link)) return "image-note";
      if (link && /\/video\/|v\.douyin\.com|iesdouyin\.com|\/share\/video\//.test(link)) {
        return "single-video";
      }
      return undefined;
    default:
      return undefined;
  }
}

function mapConfigToValues(rawConfig: unknown): Pick<StartupConfigState, "modeId" | "values"> {
  if (!isRecord(rawConfig)) return { modeId: undefined, values: {} };

  const link = readFirstLink(rawConfig.link);
  const modeEntry = readModeEntry(rawConfig.mode);
  const modeId = inferModeId(modeEntry, link);
  const numberConfig = isRecord(rawConfig.number) ? rawConfig.number : {};
  const increaseConfig = isRecord(rawConfig.increase) ? rawConfig.increase : {};
  const progressConfig = isRecord(rawConfig.progress) ? rawConfig.progress : {};
  const transcriptConfig = isRecord(rawConfig.transcript) ? rawConfig.transcript : {};
  const cookiesConfig = isRecord(rawConfig.cookies) ? rawConfig.cookies : {};

  const values: Partial<ValueMap> = {};
  if (link && modeId) {
    // Write the link into the mode-specific URL key (videoUrl / noteUrl / …)
    // so config-loaded URLs end up in the same field the user would type
    // them into.
    values[urlFieldForMode(modeId)] = link;
  }

  const pathValue = readStringValue(rawConfig.path);
  if (pathValue !== undefined) values.savePath = pathValue;

  const includeMusic = readBooleanValue(rawConfig.music);
  if (includeMusic !== undefined) values.includeMusic = includeMusic;

  const includeCover = readBooleanValue(rawConfig.cover);
  if (includeCover !== undefined) values.includeCover = includeCover;

  const includeAvatar = readBooleanValue(rawConfig.avatar);
  if (includeAvatar !== undefined) values.includeAvatar = includeAvatar;

  const includeJson = readBooleanValue(rawConfig.json);
  if (includeJson !== undefined) values.includeJson = includeJson;

  const startTime = readStringValue(rawConfig.start_time);
  if (startTime !== undefined) values.startTime = startTime;

  const endTime = readStringValue(rawConfig.end_time);
  if (endTime !== undefined) values.endTime = endTime;

  const thread = readStringValue(rawConfig.thread);
  if (thread !== undefined) values.thread = thread;

  const retryTimes = readStringValue(rawConfig.retry_times);
  if (retryTimes !== undefined) values.retryTimes = retryTimes;

  const proxy = readStringValue(rawConfig.proxy);
  if (proxy !== undefined) values.proxy = proxy;

  const useDatabase = readBooleanValue(rawConfig.database);
  if (useDatabase !== undefined) values.useDatabase = useDatabase;

  const databasePath = readStringValue(rawConfig.database_path);
  if (databasePath !== undefined) values.databasePath = databasePath;

  const quietLogs = readBooleanValue(progressConfig.quiet_logs);
  if (quietLogs !== undefined) values.quietLogs = quietLogs;

  const transcriptEnabled = readBooleanValue(transcriptConfig.enabled);
  if (transcriptEnabled !== undefined) values.transcriptEnabled = transcriptEnabled;

  const transcriptApiKey = readStringValue(transcriptConfig.api_key);
  if (transcriptApiKey !== undefined) values.transcriptApiKey = transcriptApiKey;

  const msToken = readStringValue(cookiesConfig.msToken);
  if (msToken !== undefined) values.msToken = msToken;

  const ttwid = readStringValue(cookiesConfig.ttwid);
  if (ttwid !== undefined) values.ttwid = ttwid;

  const odinTt = readStringValue(cookiesConfig.odin_tt);
  if (odinTt !== undefined) values.odin_tt = odinTt;

  const passportCsrfToken = readStringValue(cookiesConfig.passport_csrf_token);
  if (passportCsrfToken !== undefined) values.passportCsrfToken = passportCsrfToken;

  const sidGuard = readStringValue(cookiesConfig.sid_guard);
  if (sidGuard !== undefined) values.sidGuard = sidGuard;

  if (modeId === "collection") {
    const limit = readStringValue(numberConfig.mix);
    if (limit !== undefined) values.limit = limit;
  } else if (modeId === "creator-liked-posts") {
    const limit = readStringValue(numberConfig.like);
    if (limit !== undefined) values.limit = limit;
    const incremental = readBooleanValue(increaseConfig.like);
    if (incremental !== undefined) values.incremental = incremental;
  } else if (modeId === "my-favorite-collection") {
    const limit = readStringValue(numberConfig.collect);
    if (limit !== undefined) values.limit = limit;
  }

  return { modeId, values };
}

export async function bootstrapProjectConfig(
  projectRoot: string,
  downloaderRoot: string,
): Promise<StartupConfigState> {
  const configPath = path.join(projectRoot, "config.yml");
  let createdFromExample = false;

  try {
    await fs.access(configPath);
  } catch {
    const examplePath = path.join(downloaderRoot, "config.example.yml");
    try {
      await fs.copyFile(examplePath, configPath);
      createdFromExample = true;
    } catch {
      return {
        configPath,
        createdFromExample: false,
        values: {},
        status: "No config.yml found",
      };
    }
  }

  try {
    const fileContents = await fs.readFile(configPath, "utf8");
    const parsed = YAML.parse(fileContents);
    const mapped = mapConfigToValues(parsed);
    return {
      configPath,
      createdFromExample,
      modeId: mapped.modeId,
      values: mapped.values,
      status: createdFromExample ? "Created config.yml from example" : "Loaded config.yml",
    };
  } catch {
    return {
      configPath,
      createdFromExample,
      values: {},
      status: "Failed to load config.yml",
    };
  }
}
