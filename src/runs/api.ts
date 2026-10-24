// Client for the Worker runs API (PORT-PLAN "Worker API v0").
// Parsing is lenient about camelCase vs snake_case so small Worker shape
// changes do not break the browser.

import {
  API_TIMEOUT_GET_RUN_MS,
  API_TIMEOUT_GET_TAPE_MS,
  API_TIMEOUT_LIST_RUNS_MS,
  API_TIMEOUT_SUBMIT_RUN_MS,
} from "../consts";
import { fetchWithTimeout as baseFetchWithTimeout } from "../lib/api";
import { parseBaseUnits } from "../lib/format";
import { toCanonicalId } from "../thruput/ids";

export type RunStatus = "queued" | "submitting" | "confirmed" | "rejected" | "failed";

export interface RunRecord {
  runId: string;
  status: RunStatus;
  txHash: string | null;
  score: number | null;
  previousBest: number | null;
  /** KALIEN minted by this run, in base units (7 decimals). */
  minted: bigint | null;
  error: string | null;
  player: string | null;
  seedId: number | null;
  seed: number | null;
  frameCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RunListPage {
  runs: RunRecord[];
  total: number | null;
  nextOffset: number | null;
}

export class RunApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly run: RunRecord | null;
  /** Best score on this seed, when the API rejects a run that does not beat it. */
  readonly bestScore: number | null;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    run: RunRecord | null = null,
    bestScore: number | null = null,
  ) {
    super(message);
    this.name = "RunApiError";
    this.status = status;
    this.code = code;
    this.run = run;
    this.bestScore = bestScore;
  }
}

const RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "submitting",
  "confirmed",
  "rejected",
  "failed",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "confirmed" || status === "rejected" || status === "failed";
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function parseRunRecord(payload: unknown): RunRecord {
  if (!payload || typeof payload !== "object") {
    throw new Error("run response is not an object");
  }
  const outer = payload as Record<string, unknown>;
  const record =
    outer.run && typeof outer.run === "object" ? (outer.run as Record<string, unknown>) : outer;
  const runId = asString(pick(record, "runId", "run_id", "id"));
  const rawStatus = asString(pick(record, "status"));
  if (!runId || !rawStatus) {
    throw new Error("run response is missing runId or status");
  }
  const status: RunStatus = (RUN_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as RunStatus)
    : "queued";
  return {
    runId,
    status,
    txHash: toCanonicalId(asString(pick(record, "txHash", "tx_hash"))),
    score: asNumber(pick(record, "score", "claimedScore", "finalScore", "final_score")),
    previousBest: asNumber(pick(record, "previousBest", "previous_best")),
    minted: parseBaseUnits(pick(record, "minted", "mintedDelta", "minted_delta")),
    error: asString(pick(record, "error")),
    player: toCanonicalId(asString(pick(record, "player", "playerAddress", "player_address"))),
    seedId: asNumber(pick(record, "seedId", "seed_id")),
    seed: asNumber(pick(record, "seed")),
    frameCount: asNumber(pick(record, "frameCount", "frame_count")),
    createdAt: asString(pick(record, "createdAt", "created_at")),
    updatedAt: asString(pick(record, "updatedAt", "updated_at")),
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await baseFetchWithTimeout(input, init, timeoutMs);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new RunApiError("request timed out", 0);
    }
    throw err;
  }
}

async function parseError(response: Response): Promise<RunApiError> {
  let message = `request failed (${response.status})`;
  let code: string | null = null;
  let run: RunRecord | null = null;
  let bestScore: number | null = null;
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const error = asString(payload.error) ?? asString(payload.message);
    if (error) message = error;
    code = asString(payload.code) ?? asString(payload.error_code);
    bestScore = asNumber(pick(payload, "bestScore", "best_score"));
    if (payload.run) {
      try {
        run = parseRunRecord(payload.run);
      } catch {
        run = null;
      }
    }
  } catch {
    // Keep the fallback message.
  }
  return new RunApiError(message, response.status, code, run, bestScore);
}

export interface SubmitRunInput {
  tape: Uint8Array;
  /** Ed25519 public key, hex without `0x`. */
  pubkeyHex: string;
  seedId: number;
  /** Ed25519 signature over the claim message, hex without `0x`. */
  signatureHex: string;
}

export async function submitRun(input: SubmitRunInput): Promise<RunRecord> {
  const params = new URLSearchParams({
    pubkey: input.pubkeyHex,
    seed_id: String(input.seedId >>> 0),
    sig: input.signatureHex,
  });
  const response = await fetchWithTimeout(
    `/api/runs?${params.toString()}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(input.tape).buffer,
    },
    API_TIMEOUT_SUBMIT_RUN_MS,
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseRunRecord(await response.json());
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<RunRecord> {
  const response = await fetchWithTimeout(
    `/api/runs/${encodeURIComponent(runId)}`,
    { method: "GET", cache: "no-store", signal },
    API_TIMEOUT_GET_RUN_MS,
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return parseRunRecord(await response.json());
}

export async function listRuns(
  player: string,
  options: { limit?: number; offset?: number } = {},
): Promise<RunListPage> {
  const params = new URLSearchParams({ player });
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  const response = await fetchWithTimeout(
    `/api/runs?${params.toString()}`,
    { method: "GET", cache: "no-store" },
    API_TIMEOUT_LIST_RUNS_MS,
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const payload = (await response.json()) as unknown;
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rawRuns = Array.isArray(payload) ? payload : Array.isArray(record.runs) ? record.runs : [];
  const runs: RunRecord[] = [];
  for (const raw of rawRuns) {
    try {
      runs.push(parseRunRecord(raw));
    } catch {
      // Skip malformed rows rather than failing the whole page.
    }
  }
  const pagination =
    record.pagination && typeof record.pagination === "object"
      ? (record.pagination as Record<string, unknown>)
      : record;
  return {
    runs,
    total: asNumber(pick(pagination, "total")),
    nextOffset: asNumber(pick(pagination, "nextOffset", "next_offset")),
  };
}

export function getTapeDownloadUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/tape`;
}

function isTapeContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return (
    normalized.includes("application/octet-stream") || normalized.includes("application/x-binary")
  );
}

export async function fetchRunTape(
  runId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const response = await fetchWithTimeout(
    getTapeDownloadUrl(runId),
    { method: "GET" },
    API_TIMEOUT_GET_TAPE_MS,
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new RunApiError("not_found", 404);
    }
    throw await parseError(response);
  }
  const contentType = response.headers.get("content-type");
  if (!isTapeContentType(contentType)) {
    const normalized = contentType?.toLowerCase() ?? "";
    const message = normalized.includes("text/html")
      ? "expected tape bytes but received HTML"
      : `expected tape bytes but received ${contentType ?? "an unknown content type"}`;
    throw new RunApiError(message, response.status);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, filename: `${runId}.tape` };
}

export async function downloadRunTape(runId: string): Promise<void> {
  const { bytes, filename } = await fetchRunTape(runId);
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
