// BREAK-GLASS transport — NOT the default path. Spawns + speaks JSON-lines to
// parser_sidecar.py, used only under DOUYIN_HOZON_PARSER=sidecar. The default
// runtime is pure TypeScript (src/engine/native/*); see dispatch.ts. Keep —
// the native signers are faithful ports, but this is the fallback for a douyin
// signing bump that outpaces them.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import type {
  InitParams,
  InitResult,
  ParsedUrl,
  SidecarErrPayload,
  SidecarEvent,
  SidecarReady,
  SidecarSpawnConfig,
} from "./types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
};

type IncomingFrame =
  | SidecarReady
  | SidecarEvent
  | { id: number; result: unknown }
  | { id: number; error: SidecarErrPayload };

const DEFAULT_READY_TIMEOUT_MS = 10_000;

export class SidecarError extends Error {
  readonly code: string;
  readonly trace?: string;
  constructor(payload: SidecarErrPayload, method: string) {
    super(`[${payload.code}] ${method}: ${payload.message}`);
    this.name = "SidecarError";
    this.code = payload.code;
    this.trace = payload.trace;
  }
}

export class ParserClient extends EventEmitter {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private rl: ReadlineInterface | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready = false;
  private downloaderRoot: string | null = null;
  private fatal: Error | null = null;

  constructor(private readonly config: SidecarSpawnConfig) {
    super();
  }

  async start(): Promise<{ downloaderRoot: string }> {
    if (this.proc) throw new Error("ParserClient already started");

    const proc = spawn(this.config.pythonBin, [this.config.sidecarScript], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    this.rl = createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trimEnd();
      if (text) this.emit("stderr", text);
    });

    proc.on("exit", (code, signal) => this.onExit(code, signal));
    proc.on("error", (error) => this.onFatal(error));

    return new Promise<{ downloaderRoot: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Sidecar did not announce ready in time"));
      }, this.config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
      const onReady = (ready: SidecarReady): void => {
        cleanup();
        this.ready = true;
        this.downloaderRoot = ready.downloader_root;
        resolve({ downloaderRoot: ready.downloader_root });
      };
      const onExit = (): void => {
        cleanup();
        reject(this.fatal ?? new Error("Sidecar exited before ready"));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.off("ready", onReady);
        this.off("exit", onExit);
      };
      this.once("ready", onReady);
      this.once("exit", onExit);
    });
  }

  async init(params: InitParams): Promise<InitResult> {
    return this.call<InitResult>("init", { ...params });
  }

  async parseUrl(url: string): Promise<ParsedUrl | null> {
    return this.call<ParsedUrl | null>("parse_url", { url });
  }

  async call<R>(method: string, params: Record<string, unknown> = {}): Promise<R> {
    if (this.fatal) throw this.fatal;
    if (!this.proc || !this.ready) throw new Error("Sidecar not ready");

    const id = this.nextId++;
    const frame = JSON.stringify({ id, method, params });

    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      });
      const ok = this.proc!.stdin.write(frame + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      if (!ok) {
        this.proc!.stdin.once("drain", () => {
          /* backpressure released; nothing else to do */
        });
      }
    });
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.call<{ ok: boolean }>("shutdown");
    } catch {
      /* may already be down */
    }
    await this.waitForExit(2_000);
    if (this.proc) this.proc.kill("SIGTERM");
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    if (!this.proc) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.off("exit", onExit);
        resolve();
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.once("exit", onExit);
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: IncomingFrame;
    try {
      frame = JSON.parse(trimmed) as IncomingFrame;
    } catch (err) {
      this.emit("stderr", `[parser-client] bad json: ${trimmed}`);
      return;
    }

    if ("type" in frame && frame.type === "ready") {
      this.emit("ready", frame);
      return;
    }
    if ("event" in frame) {
      this.emit("event", frame);
      return;
    }
    if ("id" in frame) {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        this.emit("stderr", `[parser-client] orphan response id=${frame.id}`);
        return;
      }
      this.pending.delete(frame.id);
      if ("error" in frame) {
        pending.reject(new SidecarError(frame.error, pending.method));
      } else {
        pending.resolve(frame.result);
      }
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason = `Sidecar exited (code=${code ?? "?"} signal=${signal ?? "?"})`;
    if (!this.fatal && (code ?? 0) !== 0) {
      this.fatal = new Error(reason);
    }
    for (const [, pending] of this.pending) {
      pending.reject(this.fatal ?? new Error(reason));
    }
    this.pending.clear();
    this.ready = false;
    this.proc = null;
    this.rl?.close();
    this.rl = null;
    this.emit("exit", { code, signal });
  }

  private onFatal(error: Error): void {
    this.fatal = error;
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
    this.emit("fatal", error);
  }

  get downloaderRootPath(): string | null {
    return this.downloaderRoot;
  }
}
