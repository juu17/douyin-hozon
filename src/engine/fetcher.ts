import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { suffixFromContentType } from "./file-layout.js";
import { withRetry } from "./concurrency.js";

export interface FetchAndWriteOptions {
  url: string;
  headers?: Record<string, string>;
  destPath: string;
  proxy?: string;                       // currently unused; reserved for HttpsProxyAgent
  preferContentTypeSuffix?: boolean;    // images: rename based on Content-Type
  onBytes?: (got: number, expected: number | undefined) => void;
  signal?: AbortSignal;                 // engine-wide cancel: aborts in-flight fetch
}

export interface FetchAndWriteResult {
  finalPath: string;
  bytes: number;
}

const TIMEOUT_MS = 300_000;

// Streams the response body to a `.tmp` file then renames atomically — same
// approach as upstream's storage/file_manager.py:download_file.
export async function fetchAndWrite(opts: FetchAndWriteOptions): Promise<FetchAndWriteResult> {
  return withRetry(async () => {
    if (opts.signal?.aborted) throw new Error("aborted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onExternalAbort, { once: true });
    try {
      const response = await fetch(opts.url, {
        headers: opts.headers ?? {},
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} for ${opts.url}`);
      }

      let finalPath = opts.destPath;
      if (opts.preferContentTypeSuffix) {
        const suffix = suffixFromContentType(response.headers.get("content-type"));
        if (suffix) {
          const dir = path.dirname(opts.destPath);
          const base = path.basename(opts.destPath, path.extname(opts.destPath));
          finalPath = path.join(dir, `${base}${suffix}`);
        }
      }

      const expectedHeader = response.headers.get("content-length");
      const expected = expectedHeader ? Number.parseInt(expectedHeader, 10) : undefined;
      const tmpPath = `${finalPath}.tmp`;

      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      const handle = await fs.open(tmpPath, "w");
      let written = 0;
      try {
        const stream = Readable.fromWeb(response.body as never);
        for await (const chunk of stream) {
          const buf = chunk as Buffer;
          await handle.write(buf);
          written += buf.length;
          opts.onBytes?.(written, expected);
        }
      } finally {
        await handle.close();
      }

      if (expected !== undefined && Number.isFinite(expected) && written !== expected) {
        await fs.rm(tmpPath, { force: true });
        throw new Error(
          `Size mismatch for ${path.basename(finalPath)}: expected ${expected}, got ${written}`,
        );
      }

      await fs.rename(tmpPath, finalPath);
      return { finalPath, bytes: written };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  });
}
