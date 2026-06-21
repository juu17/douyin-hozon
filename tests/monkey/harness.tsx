import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/app.js";
import { StoreProvider, type AppState } from "../../src/state/store.js";

// Key encodings the TUI's useInput handlers understand.
export const KEY = {
  down: "\x1B[B",
  up: "\x1B[A",
  tab: "\t",
  shiftTab: "\x1B[Z",
  enter: "\r",
  esc: "\x1B",
  space: " ",
  backspace: "\x7f",
} as const;

// Ink renders + flushes effects asynchronously; give React a beat after each
// input so the frame reflects it. 40ms is comfortably above the reconcile
// time without making the suite slow.
export const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface MonkeyApp {
  stdin: { write: (data: string) => void };
  lastFrame: () => string | undefined;
  unmount: () => void;
}

// Render the full App with a clean, isolated cwd so the bootstrap finds no
// config.yml (deterministic: starts at mode index 0, default values, no
// pre-filled URLs). Returns the ink-testing-library instance + a cwd restorer.
export function launchMonkey(
  initial?: Partial<AppState>,
): MonkeyApp & { cleanup: () => void } {
  const prevCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hozon-monkey-"));
  process.chdir(tmp);

  const app = render(
    <StoreProvider initial={initial}>
      <App />
    </StoreProvider>,
  );

  return {
    stdin: app.stdin as unknown as { write: (data: string) => void },
    lastFrame: app.lastFrame as () => string | undefined,
    unmount: app.unmount,
    cleanup: () => {
      app.unmount();
      process.chdir(prevCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

// Send a key one or more times, ticking between each so each keystroke is
// processed against the result of the previous one (mirrors real typing).
export async function send(
  app: MonkeyApp,
  key: string,
  times = 1,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    app.stdin.write(key);
    await tick();
  }
}

// Type a literal string (one write — Ink delivers multi-char input as one
// `input` payload, matching a paste).
export async function typeText(app: MonkeyApp, text: string): Promise<void> {
  app.stdin.write(text);
  await tick();
}

// Return the single rendered line that contains `needle` (trimmed), or "".
// Used to assert per-row state (e.g. a checkbox's Enabled/Disabled glyph)
// without depending on the rest of the frame.
export function lineWith(frame: string | undefined, needle: string): string {
  if (!frame) return "";
  return frame.split("\n").find((l) => l.includes(needle)) ?? "";
}

// All the TASK-panel parameter labels a mode is expected to expose.
export const MODE_LABELS: Record<string, string[]> = {
  "Single Video": [
    "Video URL", "Save Path", "Download Cover", "Download Music",
    "Download Avatar", "Save Metadata JSON",
  ],
  "Image Note": [
    "Note URL", "Save Path", "Download Cover", "Download Music",
    "Download Avatar", "Save Metadata JSON",
  ],
  "Collection": [
    "Collection URL", "Save Path", "Item Limit", "Start Date", "End Date",
    "Download Cover", "Download Music", "Download Avatar", "Save Metadata JSON",
  ],
  "Music Track": [
    "Music URL", "Save Path", "Download Cover", "Download Avatar",
    "Save Metadata JSON",
  ],
  "Creator Liked Posts": [
    "Creator URL", "Save Path", "Item Limit", "Start Date", "End Date",
    "Download Cover", "Download Music",
    "Download Avatar", "Save Metadata JSON",
  ],
  "My Favorite Collection": [
    "Favorite Source", "Save Path", "Item Limit", "Download Cover",
    "Download Music", "Download Avatar", "Save Metadata JSON",
  ],
};
