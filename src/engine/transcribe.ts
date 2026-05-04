import fs from "node:fs/promises";
import path from "node:path";

// Direct OpenAI Whisper transcription. No upstream dependency — this is a
// straight HTTPS call that doesn't move with douyin's site, so we own it.

export interface TranscribeOptions {
  apiKey: string;
  apiUrl?: string;                  // default https://api.openai.com/v1/audio/transcriptions
  model?: string;                   // default gpt-4o-mini-transcribe
  responseFormats?: ("txt" | "json")[];   // both by default
}

export interface TranscribeResult {
  status: "success" | "skipped" | "failed";
  reason?: string;
  textPath?: string;
  jsonPath?: string;
}

const DEFAULT_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

export async function transcribeVideo(
  videoPath: string,
  outputDir: string,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  if (!options.apiKey) {
    return { status: "skipped", reason: "no api key" };
  }

  let stat;
  try {
    stat = await fs.stat(videoPath);
  } catch {
    return { status: "skipped", reason: "video file not found" };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { status: "skipped", reason: "video file empty" };
  }

  const formats = options.responseFormats ?? ["txt", "json"];
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
  const model = options.model ?? DEFAULT_MODEL;

  const stem = path.basename(videoPath, path.extname(videoPath));
  await fs.mkdir(outputDir, { recursive: true });

  const result: TranscribeResult = { status: "success" };

  for (const format of formats) {
    try {
      const body = new FormData();
      const data = await fs.readFile(videoPath);
      const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
      body.append("file", blob, path.basename(videoPath));
      body.append("model", model);
      body.append("response_format", format === "txt" ? "text" : "json");

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body,
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return {
          status: "failed",
          reason: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        };
      }

      const outPath = path.join(outputDir, `${stem}.transcript.${format}`);
      if (format === "txt") {
        const text = await response.text();
        await fs.writeFile(outPath, text, "utf8");
        result.textPath = outPath;
      } else {
        const json = await response.json();
        await fs.writeFile(outPath, JSON.stringify(json, null, 2), "utf8");
        result.jsonPath = outPath;
      }
    } catch (err) {
      return {
        status: "failed",
        reason: err instanceof Error ? err.message : "unknown transcribe error",
      };
    }
  }

  return result;
}
