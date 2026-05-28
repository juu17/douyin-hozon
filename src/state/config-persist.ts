// Debounced writer that auto-saves the TUI state (mode + values + cookieJar)
// to ./config.yml so all user inputs across the 6 modes survive restarts.
//
// Design notes:
//   - config.yml is a "hint, not a gate": a failed write must not break the
//     running app, so errors are swallowed (the user simply loses persistence
//     for that change; the next successful write catches up).
//   - We compare the serialized YAML, not just object identity, so a no-op
//     re-render doesn't churn the file.
//   - Single in-flight timer per process — the TUI is single-instance.

import fs from "node:fs/promises";
import YAML from "yaml";
import type { AppState } from "./store.js";

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized: string | null = null;

function serialize(state: AppState): string {
  // {modeId, cookieJar, shared, modes:<per-mode buckets>} so each mode is
  // visibly its own section in config.yml.
  return YAML.stringify({
    modeId: state.modeId,
    cookieJar: state.cookieJar ?? {},
    shared: state.shared,
    modes: state.byMode,
  });
}

export function persistConfigDebounced(configPath: string, state: AppState, delayMs = 500): void {
  const next = serialize(state);
  if (next === lastSerialized) return; // no semantic change since last write
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    fs.writeFile(configPath, next, "utf8")
      .then(() => {
        lastSerialized = next;
      })
      .catch(() => {
        // Hint, not a gate. Disk full / perms / read-only FS — keep running;
        // the next successful write will catch up.
      });
  }, delayMs);
}

// For tests + clean shutdown: flush any pending debounce immediately.
export async function flushPendingConfigWrite(configPath: string, state: AppState): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const next = serialize(state);
  if (next === lastSerialized) return;
  try {
    await fs.writeFile(configPath, next, "utf8");
    lastSerialized = next;
  } catch {
    /* see above */
  }
}

// For tests: reset the in-module state (avoids cross-test bleed).
export function _resetPersistStateForTests(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  lastSerialized = null;
}
