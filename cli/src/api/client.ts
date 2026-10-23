import { bytesToHex, claimMessage } from "../identity/claim";
import { signClaim, type Identity } from "../identity/keyfile";

// Client for the Kalien Worker API v0 (see docs/thruput/PORT-PLAN.md).

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiConfig {
  networkHash: string;
  rpcUrl: string;
  scoreContract: string;
  tokenContract: string;
  explorerUrl: string;
}

export interface CurrentSeed {
  seedId: number;
  seed: number;
}

export type RunStatus = "queued" | "submitting" | "confirmed" | "rejected" | "failed";

export interface RunRecord {
  runId: string;
  status: RunStatus | string;
  seedId?: number;
  txHash?: string | null;
  score?: number | null;
  previousBest?: number | null;
  minted?: string | number | null;
  error?: string | null;
}

export interface SubmitResult {
  success: boolean;
  runId?: string;
  status?: string;
  error?: string;
  httpStatus?: number;
  rateLimited?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isTerminalStatus(status: string): boolean {
  return status === "confirmed" || status === "rejected" || status === "failed";
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {}
  return `HTTP ${response.status}`;
}

async function getJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }
  return (await response.json()) as T;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseRunRecord(payload: unknown): RunRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const outer = payload as Record<string, unknown>;
  const obj = (outer.run && typeof outer.run === "object" ? outer.run : outer) as Record<
    string,
    unknown
  >;
  const runId = str(obj.runId) ?? str(obj.run_id) ?? str(obj.id);
  const status = str(obj.status);
  if (!runId || !status) return null;
  return {
    runId,
    status,
    seedId: num(obj.seedId ?? obj.seed_id),
    txHash: str(obj.txHash ?? obj.tx_hash) ?? null,
    score: num(obj.score) ?? null,
    previousBest: num(obj.previousBest ?? obj.previous_best) ?? null,
    minted: (obj.minted as string | number | null | undefined) ?? null,
    error: str(obj.error) ?? null,
  };
}

export class KalienApi {
  readonly baseUrl: string;
  #config: ApiConfig | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeApiUrl(baseUrl);
  }

  async config(refresh = false): Promise<ApiConfig> {
    if (this.#config && !refresh) return this.#config;
    const body = await getJson<Partial<ApiConfig>>(`${this.baseUrl}/api/config`);
    if (typeof body.networkHash !== "string" || typeof body.scoreContract !== "string") {
      throw new Error(`${this.baseUrl}/api/config is missing networkHash or scoreContract`);
    }
    this.#config = {
      networkHash: body.networkHash,
      rpcUrl: body.rpcUrl ?? "",
      scoreContract: body.scoreContract,
      tokenContract: body.tokenContract ?? "",
      explorerUrl: body.explorerUrl ?? "",
    };
    return this.#config;
  }

  async currentSeed(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CurrentSeed> {
    const body = await getJson<Record<string, unknown>>(
      `${this.baseUrl}/api/seed/current`,
      timeoutMs,
    );
    const seedId = num(body.seedId ?? body.seed_id);
    const seed = num(body.seed);
    if (seedId === undefined || seed === undefined) {
      throw new Error("seed not available yet");
    }
    return { seedId: seedId >>> 0, seed: seed >>> 0 };
  }

  /** Sign the claim for `tape` and POST it as a new run. */
  async submitRun(identity: Identity, seedId: number, tape: Uint8Array): Promise<SubmitResult> {
    let sigHex: string;
    try {
      const cfg = await this.config();
      const message = claimMessage({
        networkHash: cfg.networkHash,
        scoreContract: cfg.scoreContract,
        seedId: seedId >>> 0,
        tape,
      });
      sigHex = bytesToHex(await signClaim(identity, message));
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const params = new URLSearchParams({
      pubkey: identity.publicKeyHex,
      seed_id: String(seedId >>> 0),
      sig: sigHex,
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/runs?${params.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(tape),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        return {
          success: false,
          error: await errorMessage(response),
          httpStatus: response.status,
          rateLimited: response.status === 429,
        };
      }
      const run = parseRunRecord(await response.json());
      if (!run) {
        return { success: false, error: "unexpected response from /api/runs" };
      }
      return { success: true, runId: run.runId, status: run.status };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getRun(runId: string): Promise<RunRecord> {
    const body = await getJson<unknown>(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`);
    const run = parseRunRecord(body);
    if (!run) throw new Error(`unexpected response for run ${runId}`);
    return run;
  }

  /** Poll a run until it reaches a terminal status or the timeout passes. */
  async waitForRun(
    runId: string,
    opts: {
      timeoutMs?: number;
      intervalMs?: number;
      onUpdate?: (run: RunRecord) => void;
    } = {},
  ): Promise<RunRecord> {
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    const interval = opts.intervalMs ?? 2_000;
    let last: RunRecord | null = null;
    /* eslint-disable no-await-in-loop -- polling must stay sequential */
    while (Date.now() < deadline) {
      try {
        const run = await this.getRun(runId);
        if (!last || last.status !== run.status) opts.onUpdate?.(run);
        last = run;
        if (isTerminalStatus(run.status)) return run;
      } catch (err) {
        // A 404 right after submit or a network blip is not fatal while polling.
        if (err instanceof ApiError && err.status !== 404 && err.status < 500) throw err;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    /* eslint-enable no-await-in-loop */
    if (last) return last;
    throw new Error(`run ${runId} status not available before timeout`);
  }

  async listRuns(player: string): Promise<RunRecord[]> {
    const body = await getJson<unknown>(
      `${this.baseUrl}/api/runs?player=${encodeURIComponent(player)}`,
    );
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as { runs?: unknown }).runs)
        ? (body as { runs: unknown[] }).runs
        : [];
    return list.map(parseRunRecord).filter((r): r is RunRecord => r !== null);
  }

  /** Best confirmed score for `player` on `seedId`, from the run history. 0 if none. */
  async bestScoreForSeed(player: string, seedId: number): Promise<number> {
    try {
      const runs = await this.listRuns(player);
      let best = 0;
      for (const run of runs) {
        if (run.status !== "confirmed" || run.seedId !== seedId) continue;
        best = Math.max(best, run.score ?? 0);
      }
      return best;
    } catch {
      return 0;
    }
  }
}
