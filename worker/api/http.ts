import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerEnv } from "../env";
import { normalizeAddressInput } from "../ids";

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

/** A Thruput address (base58, 64 hex chars, or C StrKey) as base58, or null. */
export function normalizeAddress(raw: string | undefined | null): string | null {
  return normalizeAddressInput(raw);
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

/** Compares in time that does not depend on where the strings differ. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export function isAdmin(c: AppContext): boolean {
  const key = c.env.DEV_API_KEY;
  return Boolean(key) && constantTimeEqual(c.req.header("authorization") ?? "", `Bearer ${key}`);
}

/**
 * Reads a request body but stops after `maxBytes`, also without a
 * Content-Length (chunked upload). Null when the body is larger.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return null;
  }
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- stream chunks in order
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > maxBytes) {
      // eslint-disable-next-line no-await-in-loop -- stop the upload once
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
