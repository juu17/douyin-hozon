// Vendor Interpreter — stage 3 (shared): the consumed-symbol tally.
// Imported by baseline.ts (W1.3, write) and check.ts (W1.4, compare).
// DEV-ONLY — never imported by runtime src/.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_COMMIT, VENDOR_REPO } from "./acquire.js";
import type { SigRecord } from "./extract.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const TALLY_PATH = path.join(REPO_ROOT, "vendor-api", "tally.json");
export const TALLY_FORMAT_VERSION = "1.0";

// Every vendor symbol our native TS port depends on. `module::qualname`,
// module exactly as the extractor emits it (relative path incl. `.py`).
// buildTally() throws if any of these is absent from a fresh extraction —
// that's the self-check that keeps this list honest.
export const CONSUMED: readonly string[] = [
  "core/api_client.py::DouyinAPIClient.__init__",
  "core/api_client.py::DouyinAPIClient.sign_url",
  "core/api_client.py::DouyinAPIClient.build_signed_path",
  "core/api_client.py::DouyinAPIClient.resolve_short_url",
  "core/api_client.py::DouyinAPIClient.get_video_detail",
  "core/api_client.py::DouyinAPIClient.get_user_info",
  "core/api_client.py::DouyinAPIClient.get_user_post",
  "core/api_client.py::DouyinAPIClient.get_user_like",
  "core/api_client.py::DouyinAPIClient.get_user_mix",
  "core/api_client.py::DouyinAPIClient.get_user_music",
  "core/api_client.py::DouyinAPIClient.get_user_collects",
  "core/api_client.py::DouyinAPIClient.get_collect_aweme",
  "core/api_client.py::DouyinAPIClient.get_user_collect_mix",
  "core/api_client.py::DouyinAPIClient.get_mix_detail",
  "core/api_client.py::DouyinAPIClient.get_mix_aweme",
  "core/api_client.py::DouyinAPIClient.get_music_detail",
  "core/api_client.py::DouyinAPIClient.collect_user_post_ids_via_browser",
  "core/url_parser.py::URLParser.parse",
  "utils/validators.py::parse_url_type",
  "utils/validators.py::sanitize_filename",
  "utils/xbogus.py::XBogus.__init__",
  "utils/xbogus.py::XBogus.build",
  "utils/abogus.py::ABogus.__init__",
  "utils/abogus.py::ABogus.generate_abogus",
  "utils/abogus.py::BrowserFingerprintGenerator.generate_fingerprint",
  "auth/ms_token_manager.py::MsTokenManager.__init__",
  "auth/ms_token_manager.py::MsTokenManager.ensure_ms_token",
];

// Only decorators that change call/binding semantics matter for drift.
const SEMANTIC_DECORATORS = new Set(["staticmethod", "classmethod", "property"]);

export interface CanonicalSymbol {
  module: string;
  qualname: string;
  kind: string;
  async: boolean;
  decorators: string[];
  params: { name: string; annotation: string | null; default: string | null; kind: string }[];
  vararg: string | null;
  kwarg: string | null;
  returns: string | null;
  bases: string[];
}

export interface TallySymbol extends CanonicalSymbol {
  digest: string;
}

export interface Tally {
  tallyFormatVersion: string;
  vendorRepo: string;
  vendorCommit: string;
  baselinedAt: string;
  scope: string;
  symbols: Record<string, TallySymbol>;
}

export function symbolKey(rec: { module: string; qualname: string }): string {
  return `${rec.module}::${rec.qualname}`;
}

function normalizeAnnotation(a: string | null | undefined): string | null {
  if (a == null) return null;
  return a.replace(/\s+/g, "");
}

export function canonicalize(rec: SigRecord): CanonicalSymbol {
  const params = (rec.params ?? [])
    .filter((p) => p.name !== "self" && p.name !== "cls")
    .map((p) => ({
      name: p.name,
      annotation: normalizeAnnotation(p.annotation),
      default: p.default ?? null,
      kind: p.kind,
    }));
  const positional = params.filter((p) => p.kind !== "keyword_only");
  const kwonly = params
    .filter((p) => p.kind === "keyword_only")
    .sort((a, b) => a.name.localeCompare(b.name));
  const decorators = (rec.decorators ?? [])
    .filter((d) => SEMANTIC_DECORATORS.has(d))
    .sort();
  return {
    module: rec.module,
    qualname: rec.qualname,
    kind: rec.kind,
    async: rec.async ?? false,
    decorators,
    params: [...positional, ...kwonly],
    vararg: rec.vararg ?? null,
    kwarg: rec.kwarg ?? null,
    returns: normalizeAnnotation(rec.returns),
    bases: (rec.bases ?? []).slice().sort(),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// sha256 of the canonical form (param array order preserved, all object keys
// sorted). lineno is never part of the canonical form, so it can't churn the
// fingerprint.
export function fingerprint(canonical: CanonicalSymbol): string {
  return crypto.createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

export function buildTally(records: SigRecord[]): Tally {
  const byKey = new Map(records.map((r) => [symbolKey(r), r]));
  const symbols: Record<string, TallySymbol> = {};
  const missing: string[] = [];
  for (const k of CONSUMED) {
    const rec = byKey.get(k);
    if (!rec) {
      missing.push(k);
      continue;
    }
    const canon = canonicalize(rec);
    symbols[k] = { ...canon, digest: fingerprint(canon) };
  }
  if (missing.length > 0) {
    throw new Error(
      `CONSUMED symbols missing from vendor extraction (allowlist stale?):\n  ${missing.join("\n  ")}`,
    );
  }
  return {
    tallyFormatVersion: TALLY_FORMAT_VERSION,
    vendorRepo: VENDOR_REPO,
    vendorCommit: PINNED_COMMIT,
    baselinedAt: new Date().toISOString().slice(0, 10),
    scope: "consumed-only",
    symbols,
  };
}

export async function readTally(p: string = TALLY_PATH): Promise<Tally> {
  return JSON.parse(await fs.readFile(p, "utf8")) as Tally;
}

export async function writeTally(t: Tally, p: string = TALLY_PATH): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  // Sort symbol keys for clean, reviewable git diffs.
  const sortedSymbols: Record<string, TallySymbol> = {};
  for (const k of Object.keys(t.symbols).sort()) sortedSymbols[k] = t.symbols[k]!;
  await fs.writeFile(p, `${JSON.stringify({ ...t, symbols: sortedSymbols }, null, 2)}\n`, "utf8");
}
