import { useEffect, useRef } from "react";
import { useStore } from "./store.js";

const DEFAULT_INTERVAL_MS = 100;

export function useThrottledStatus(intervalMs: number = DEFAULT_INTERVAL_MS): (line: string) => void {
  const { dispatch } = useStore();
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  return (line: string): void => {
    pendingRef.current = line;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null) dispatch({ type: "SET_STATUS", status: next });
    }, intervalMs);
  };
}
