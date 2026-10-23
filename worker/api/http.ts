import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerEnv } from "../env";

export type AppEnv = { Bindings: WorkerEnv };
export type AppContext = Context<AppEnv>;

export function jsonError(
  c: AppContext,
  status: ContentfulStatusCode,
  error: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json({ success: false, error, ...extra }, status);
}

export function clientIp(c: AppContext): string {
  return c.req.raw.headers.get("cf-connecting-ip") ?? "unknown";
}

const ADDRESS_PATTERN = /^(?:0x)?[0-9a-f]{64}$/iu;

/** Normalizes a 32-byte Thruput address to lowercase 0x hex, or null. */
export function normalizeAddress(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !ADDRESS_PATTERN.test(trimmed)) {
    return null;
  }
  return `0x${trimmed.replace(/^0x/iu, "").toLowerCase()}`;
}

/** Fixed-window counters per key; in memory, per isolate. */
export class RateLimiter {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns 0 when allowed, else seconds until the window resets. */
  take(key: string, now = Date.now()): number {
    const entry = this.counters.get(key);
    if (!entry || now >= entry.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return 0;
    }
    entry.count += 1;
    return entry.count <= this.limit ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }

  private prune(now: number): void {
    if (this.counters.size <= 1_000) {
      return;
    }
    for (const [key, entry] of this.counters) {
      if (now >= entry.resetAt) {
        this.counters.delete(key);
      }
    }
  }
}

export function rateLimited(c: AppContext, retryAfter: number): Response {
  c.header("Retry-After", String(retryAfter));
  return jsonError(c, 429, "rate limit exceeded", { retryAfterSeconds: retryAfter });
}

export function isAdmin(c: AppContext): boolean {
  const key = c.env.DEV_API_KEY;
  return Boolean(key) && c.req.header("authorization") === `Bearer ${key}`;
}
