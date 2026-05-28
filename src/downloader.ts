// Startup helpers shared between the engine and the TUI bootstrap.
//
//   - resolvePaths           : project + downloader paths used by the bootstrap
//                              (downloaderRoot is only consumed by the sidecar
//                              break-glass path; native default ignores it).
//   - bootstrapProjectConfig : on app mount, ensure a ./config.yml exists
//                              (copying ./config.example.yml if not), parse it
//                              with the NATIVE schema (modeId / cookieJar /
//                              values), and return values to seed the store.
//
// The TUI auto-persists state.modeId / state.values / state.cookieJar back
// into ./config.yml on every change (debounced) — see src/state/config-persist.ts.

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  isPerModeField,
  MODE_DEFINITIONS,
  MODE_INDEX,
  PER_MODE_FIELD_IDS,
  SHARED_DEFAULTS,
  type ModeId,
  type ValueMap,
} from "./modes.js";

export interface DownloaderPaths {
  projectRoot: string;
  downloaderRoot: string;
}

export interface StartupConfigState {
  configPath: string;
  createdFromExample: boolean;
  modeId?: ModeId;
  shared: Partial<ValueMap>;
  byMode: Partial<Record<ModeId, Partial<ValueMap>>>;
  cookieJar: Record<string, string>;
  status: string;
}

export function resolvePaths(projectRoot: string): DownloaderPaths {
  const downloaderRoot = process.env.DOUYIN_HOZON_DOWNLOADER_PATH
    ? path.resolve(process.env.DOUYIN_HOZON_DOWNLOADER_PATH)
    : path.join(projectRoot, "douyin-downloader");
  return { projectRoot, downloaderRoot };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Pick the keys that are valid for a given bucket (shared vs per-mode), drop
// anything else (stale fields from a prior version, junk, wrong-typed values).
function pickValid(raw: unknown, validKeys: Set<string>): Partial<ValueMap> {
  if (!isRecord(raw)) return {};
  const out: Partial<ValueMap> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!validKeys.has(k)) continue;
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
      (out as Record<string, string | boolean | number>)[k] = v;
    }
  }
  return out;
}

// Parse the native config.yml schema: { modeId, cookieJar, shared, modes: <per-mode buckets> }.
// Also accepts the legacy { values: <flat> } shape so a config.yml from before
// W8 still bootstraps (those values are routed into shared/byMode by ownership).
function parseNativeConfig(raw: unknown): {
  modeId?: ModeId;
  shared: Partial<ValueMap>;
  byMode: Partial<Record<ModeId, Partial<ValueMap>>>;
  cookieJar: Record<string, string>;
} {
  const out: {
    modeId?: ModeId;
    shared: Partial<ValueMap>;
    byMode: Partial<Record<ModeId, Partial<ValueMap>>>;
    cookieJar: Record<string, string>;
  } = { shared: {}, byMode: {}, cookieJar: {} };
  if (!isRecord(raw)) return out;

  if (typeof raw["modeId"] === "string" && MODE_INDEX.has(raw["modeId"] as ModeId)) {
    out.modeId = raw["modeId"] as ModeId;
  }

  const jar = raw["cookieJar"];
  if (isRecord(jar)) {
    for (const [k, v] of Object.entries(jar)) {
      if (typeof v === "string") out.cookieJar[k] = v;
    }
  }

  const sharedKeys = new Set(Object.keys(SHARED_DEFAULTS));
  out.shared = pickValid(raw["shared"], sharedKeys);

  const modes = raw["modes"];
  if (isRecord(modes)) {
    for (const def of MODE_DEFINITIONS) {
      const bucket = modes[def.id];
      if (!isRecord(bucket)) continue;
      out.byMode[def.id] = pickValid(bucket, PER_MODE_FIELD_IDS);
    }
  }

  // Legacy compatibility: an older config.yml with a flat `values:` map.
  // Route each entry into the right bucket so existing users keep their data.
  const legacyValues = raw["values"];
  if (isRecord(legacyValues)) {
    for (const [k, v] of Object.entries(legacyValues)) {
      if (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number") continue;
      if (isPerModeField(k)) {
        // Without a hint, fold legacy per-mode values into EVERY mode's bucket
        // (matches the old flat semantics where one key served all). The user
        // can then edit per-mode in the TUI.
        for (const def of MODE_DEFINITIONS) {
          const cur = out.byMode[def.id] ?? {};
          // Only fill in keys that mode actually owns (e.g. don't put videoUrl
          // in the Collection bucket).
          if (defOwnsField(def.id, k)) {
            (cur as Record<string, unknown>)[k] = v;
            out.byMode[def.id] = cur;
          }
        }
      } else if (sharedKeys.has(k)) {
        (out.shared as Record<string, unknown>)[k] = v;
      }
    }
  }

  return out;
}

// Does this mode actually expose `fieldId`? Cheap lookup against MODE_DEFINITIONS.
function defOwnsField(modeId: ModeId, fieldId: string): boolean {
  const def = MODE_INDEX.get(modeId);
  if (!def) return false;
  return def.fields.some((f) => f.id === fieldId);
}

export async function bootstrapProjectConfig(projectRoot: string): Promise<StartupConfigState> {
  const configPath = path.join(projectRoot, "config.yml");
  const examplePath = path.join(projectRoot, "config.example.yml");
  let createdFromExample = false;

  // 1. Ensure ./config.yml exists, copying from ./config.example.yml if not.
  try {
    await fs.access(configPath);
  } catch {
    try {
      await fs.copyFile(examplePath, configPath);
      createdFromExample = true;
    } catch {
      return {
        configPath,
        createdFromExample: false,
        shared: {},
        byMode: {},
        cookieJar: {},
        status: "No config.yml; config.example.yml missing too",
      };
    }
  }

  // 2. Parse the native schema.
  try {
    const text = await fs.readFile(configPath, "utf8");
    const parsed = parseNativeConfig(YAML.parse(text));
    return {
      configPath,
      createdFromExample,
      modeId: parsed.modeId,
      shared: parsed.shared,
      byMode: parsed.byMode,
      cookieJar: parsed.cookieJar,
      status: createdFromExample ? "Created config.yml from example" : "Loaded config.yml",
    };
  } catch (err) {
    return {
      configPath,
      createdFromExample,
      shared: {},
      byMode: {},
      cookieJar: {},
      status: `Failed to parse config.yml: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
