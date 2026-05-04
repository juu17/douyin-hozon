// Bounded concurrency + retry primitives. Mirrors upstream's defaults:
// thread=5, retry_times=3, backoff [1s, 2s, 5s] (control/retry_handler.py).

export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(initial: number) {
    this.permits = Math.max(1, initial);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.permits += 1;
  }
}

export interface RetryOptions {
  attempts?: number;             // total attempts; default 3
  backoffMs?: number[];          // gap before each retry; default [1000, 2000, 5000]
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000];

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) break;
      if (i === attempts - 1) break;
      const delay = backoff[Math.min(i, backoff.length - 1)] ?? 1000;
      await sleep(delay);
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBounded<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const sem = new Semaphore(limit);
  const out: R[] = new Array(items.length);
  await Promise.all(
    items.map(async (item, index) => {
      await sem.acquire();
      try {
        out[index] = await task(item, index);
      } finally {
        sem.release();
      }
    }),
  );
  return out;
}
