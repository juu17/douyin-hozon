import { useEffect, useRef } from "react";
import { isShortDouyinUrl, resolveShortUrl } from "../engine/url-utils.js";
import { getMode } from "../modes.js";
import { useStore } from "./store.js";

// Watches every store value that's marked `resolvable` in modes.ts. When a
// value changes to a short douyin URL (v.douyin.com / v.iesdouyin.com /
// iesdouyin.com), follows the redirect via HTTP and writes the canonical
// long URL back into the store. Tracks already-resolved strings in a Set so
// the dispatch-driven re-render doesn't loop.
export function useUrlResolver(): void {
  const { state, dispatch } = useStore();
  // Strings we've already attempted to resolve. Lives across renders so we
  // don't re-fetch for the same input on every keystroke / re-render.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const mode = getMode(state.modeId);
    const resolvableFieldIds = mode.fields
      .filter((f) => f.resolvable)
      .map((f) => f.id);
    if (resolvableFieldIds.length === 0) return;

    let cancelled = false;
    const ctrl = new AbortController();

    for (const fieldId of resolvableFieldIds) {
      const raw = state.values[fieldId];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (seenRef.current.has(trimmed)) continue;
      if (!isShortDouyinUrl(trimmed)) {
        // Mark as seen so we don't re-check on every render.
        seenRef.current.add(trimmed);
        continue;
      }

      // Mark immediately so concurrent dispatches don't re-trigger.
      seenRef.current.add(trimmed);
      dispatch({ type: "SET_STATUS", status: `Resolving ${shortHostOf(trimmed)}…` });

      void resolveShortUrl(trimmed, { signal: ctrl.signal })
        .then((resolved) => {
          if (cancelled) return;
          seenRef.current.add(resolved);
          if (resolved !== trimmed) {
            dispatch({ type: "SET_VALUE", id: fieldId, value: resolved });
            dispatch({ type: "SET_STATUS", status: "URL resolved" });
          } else {
            dispatch({ type: "SET_STATUS", status: "URL already canonical" });
          }
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ type: "SET_STATUS", status: `Resolve failed: ${message}` });
        });
    }

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [state.modeId, state.values, dispatch]);
}

function shortHostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
