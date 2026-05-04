import { useEffect, useRef } from "react";
import { Engine, resolveEnginePaths, type ProgressEvent } from "../engine/index.js";
import { useStore } from "./store.js";
import { useThrottledStatus } from "./use-throttled-status.js";

export interface DownloaderApi {
  launch: () => Promise<void>;
  cancel: () => void;
}

// Engine-driven download: Python sidecar parses douyin's responses, Node
// downloads + writes. douyin-downloader is consumed only as a parser library
// — no CLI dependency, no YAML schema coupling, no shared file layout
// assumptions beyond what the sidecar reports.

export function useDownloader(): DownloaderApi {
  const { state, dispatch } = useStore();
  const setStatus = useThrottledStatus();
  const engineRef = useRef<Engine | null>(null);
  // Synchronous in-flight flag — `state.downloadActive` reads from a stale
  // closure on rapid Enter presses, so we also gate on a ref that flips
  // immediately. Both must be false to start a new download.
  const inFlightRef = useRef<boolean>(false);
  const paths = useRef(resolveEnginePaths(process.cwd())).current;

  useEffect(() => {
    return () => {
      void engineRef.current?.stop().catch(() => {});
      engineRef.current = null;
    };
  }, []);

  const cancel = (): void => {
    void engineRef.current?.stop().catch(() => {});
    engineRef.current = null;
    dispatch({ type: "SET_DOWNLOAD_ACTIVE", active: false });
  };

  const launch = async (): Promise<void> => {
    if (inFlightRef.current || state.downloadActive) {
      dispatch({
        type: "OPEN_ALERT",
        alert: { title: "Download In Progress", message: "A download is already running." },
      });
      return;
    }
    if (state.cookieCaptureActive) {
      dispatch({
        type: "OPEN_ALERT",
        alert: {
          title: "Capture In Progress",
          message: "Cookies are being captured. Wait a moment and try again.",
        },
      });
      return;
    }
    inFlightRef.current = true;

    const preflight = preflightValidate(state.modeId, state.values);
    if (preflight) {
      inFlightRef.current = false;
      dispatch({
        type: "OPEN_ALERT",
        alert: { title: "Validation Error", message: preflight },
      });
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let phase: "starting" | "running" = "starting";
    try {
      const engine = engineRef.current ?? new Engine(paths);
      engineRef.current = engine;
      unsubscribe = engine.progress.onProgress(makeRenderProgress(setStatus));

      dispatch({ type: "SET_STATUS", status: "Starting parser" });
      dispatch({ type: "SET_DOWNLOAD_ACTIVE", active: true });
      await engine.start(state.values, state.cookieJar);
      phase = "running";

      const result = await engine.runMode(state.modeId, state.values);
      const items = result === undefined
        ? []
        : Array.isArray(result) ? result : [result];
      const success = items.filter((i) => i.ok && !i.skipped).length;
      const skipped = items.filter((i) => i.skipped).length;
      const failed = items.length - success - skipped;

      if (failed === 0) {
        const summary = skipped > 0
          ? `Saved ${success} item${success === 1 ? "" : "s"} (${skipped} skipped, already in db).`
          : `Saved ${success} item${success === 1 ? "" : "s"}.`;
        dispatch({ type: "SET_STATUS", status: `Done (${success})` });
        dispatch({
          type: "OPEN_ALERT",
          alert: { title: "Download Finished", message: summary },
        });
      } else {
        const firstError = items.find((i) => !i.ok && !i.skipped)?.error ?? "unknown error";
        dispatch({ type: "SET_STATUS", status: `Failed (${failed}/${items.length})` });
        dispatch({
          type: "OPEN_ALERT",
          alert: {
            title: "Download Failed",
            message: `${failed} of ${items.length} item(s) failed.\nFirst error: ${firstError}`,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const title = phase === "starting" ? "Engine Startup Failed" : "Download Failed";
      dispatch({ type: "SET_STATUS", status: title });
      dispatch({ type: "OPEN_ALERT", alert: { title, message } });
    } finally {
      // Always run regardless of success/failure: unsubscribe progress
      // handler (would otherwise stack across launches) and reset both
      // the in-flight flag and the public "downloading" state.
      try { unsubscribe?.(); } catch { /* noop */ }
      inFlightRef.current = false;
      dispatch({ type: "SET_DOWNLOAD_ACTIVE", active: false });
    }
  };

  return { launch, cancel };
}

import { urlFieldForMode, type ModeId, type ValueMap } from "../modes.js";

function preflightValidate(modeId: ModeId, values: ValueMap): string | null {
  if (modeId !== "my-favorite-collection") {
    const urlKey = urlFieldForMode(modeId);
    if (!String(values[urlKey] ?? "").trim()) {
      return "The current mode requires a valid resource URL.";
    }
  }
  if (!String(values.savePath ?? "").trim()) {
    return "Save Path cannot be empty.";
  }
  for (const field of ["thread", "retryTimes", "limit"] as const) {
    const raw = String(values[field] ?? "").trim();
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) return `${field} must be a non-negative integer.`;
  }
  for (const field of ["startTime", "endTime"] as const) {
    const raw = String(values[field] ?? "").trim();
    if (!raw) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${field} must use YYYY-MM-DD.`;
  }
  return null;
}

function makeRenderProgress(setStatus: (s: string) => void) {
  // Track the active item title so item-bytes events show "Item — 50% (10MB)"
  // instead of overwriting the title.
  let currentTitle: string | null = null;
  return (event: ProgressEvent): void => {
    switch (event.kind) {
      case "stage":
        // Skip transient sidecar-stderr passthroughs (`[sidecar] ...`).
        // They're informational at most and otherwise pollute the footer.
        if (event.detail?.startsWith("[sidecar]")) return;
        if (event.stage === "parsing") setStatus("Parsing URL");
        else if (event.stage === "fetching") setStatus(`Fetching ${event.detail ?? ""}`.trim());
        else if (event.stage === "writing") setStatus("Downloading");
        else if (event.stage === "done") setStatus("Done");
        else if (event.stage === "error") setStatus("Error");
        break;
      case "page":
        setStatus(`Page ${event.page} · ${event.totalSoFar} item${event.totalSoFar === 1 ? "" : "s"} so far`);
        break;
      case "item-start":
        currentTitle = event.title.slice(0, 32);
        setStatus(`${currentTitle} · starting`);
        break;
      case "item-bytes": {
        const prefix = currentTitle ? `${currentTitle} · ` : "";
        if (event.expected) {
          const pct = Math.min(100, Math.round((event.got / event.expected) * 100));
          setStatus(`${prefix}${pct}% (${formatBytes(event.got)} / ${formatBytes(event.expected)})`);
        } else {
          setStatus(`${prefix}${formatBytes(event.got)}`);
        }
        break;
      }
      case "item-skip":
        setStatus(`Skip: ${event.reason}`);
        break;
      case "item-done":
        if (event.success) setStatus(`${currentTitle ?? "Item"} · done`);
        else setStatus(`${currentTitle ?? "Item"} failed: ${event.error ?? ""}`.trim());
        currentTitle = null;
        break;
      case "summary":
        setStatus(`Summary ${event.success}/${event.total}`);
        break;
    }
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
