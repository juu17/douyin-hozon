// Vendor Interpreter — stage 2 (TS face): run the Python signature extractor
// and parse its JSON. Imported by W1.3 (tally build) and W1.4 (drift check).
// DEV-ONLY — never imported by runtime src/.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveVendorPath } from "./acquire.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACTOR = path.join(HERE, "extract_signatures.py");

export type SigParamKind = "positional_only" | "positional_or_keyword" | "keyword_only";

export interface SigParam {
  name: string;
  annotation: string | null;
  default: string | null;
  kind: SigParamKind;
}

export interface SigRecord {
  module: string;
  qualname: string;
  kind: "function" | "method" | "class" | "staticmethod" | "classmethod" | "property";
  async?: boolean;
  decorators?: string[];
  params?: SigParam[];
  vararg?: string | null;
  kwarg?: string | null;
  returns?: string | null;
  bases?: string[];
  lineno: number;
}

// Stdlib-only extractor → any python3 (3.9+) works. Override with
// DOUYIN_HOZON_PYTHON (e.g. the repo .venv) if system python3 is too old.
function pythonBin(): string {
  return process.env["DOUYIN_HOZON_PYTHON"] || "python3";
}

export async function extractSignatures(vendorPath?: string): Promise<SigRecord[]> {
  const root = vendorPath ?? (await resolveVendorPath());
  const { stdout } = await execFileAsync(pythonBin(), [EXTRACTOR, root], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as SigRecord[];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  extractSignatures()
    .then((recs) => process.stdout.write(`${JSON.stringify(recs, null, 2)}\n`))
    .catch((err: unknown) => {
      process.stderr.write(`vendor:extract failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
