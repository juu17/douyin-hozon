import { EventEmitter } from "node:events";

export type ProgressEvent =
  | { kind: "stage"; stage: "parsing" | "fetching" | "writing" | "done" | "error"; detail?: string }
  | { kind: "page"; page: number; totalSoFar: number }
  | { kind: "item-start"; title: string; index: number; total?: number }
  | { kind: "item-bytes"; got: number; expected?: number }
  | { kind: "item-skip"; title: string; reason: string }
  | { kind: "item-done"; success: boolean; pathHint?: string; error?: string }
  | { kind: "summary"; total: number; success: number; failed: number; skipped: number };

export class ProgressBus extends EventEmitter {
  emitProgress(event: ProgressEvent): void {
    this.emit("progress", event);
  }

  onProgress(handler: (event: ProgressEvent) => void): () => void {
    this.on("progress", handler);
    return () => this.off("progress", handler);
  }
}
