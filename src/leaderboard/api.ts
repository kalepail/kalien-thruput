import { fetchWithTimeout as baseFetchWithTimeout, parseJson } from "@/lib/api";
import { parseBaseUnits } from "@/lib/format";
import { bytesToHex } from "@/lib/hex";
import { getThruputConfig } from "@/thruput/config";

export type LeaderboardWindow = "10m" | "day" | "all";

export interface PlayerProfile {
  playerAddress: string;
  username: string | null;
  linkUrl: string | null;
  updatedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  /** Run id for replay, when the Worker still has the tape. */
  runId: string | null;
  playerAddress: string;
  profile: PlayerProfile | null;
  score: number;
  /** KALIEN minted by this run, in base units (7 decimals). */
  minted: bigint | null;
  seed: number;
  seedId: number | null;
  frameCount: number | null;
  completedAt: string;
  txHash: string | null;
}

export interface LeaderboardPageResponse {
  window: LeaderboardWindow;
  generatedAt: string | null;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset: number | null;
  };
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  ingestion: {
    lastSyncedAt: string | null;
    latestBlock: number | null;
    totalEvents: number | null;
  } | null;
}

export interface LeaderboardPlayer {
  playerAddress: string;
  profile: PlayerProfile | null;
  stats: {
    totalRuns: number;
    bestScore: number;
    /** Total KALIEN minted, in base units. */
    totalMinted: bigint | null;
    lastPlayedAt: string | null;
  };
  ranks: {
    tenMin: number | null;
    day: number | null;
    all: number | null;
  };
  recentRuns: LeaderboardEntry[];
  runsPagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset: number | null;
  };
}

export class LeaderboardApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LeaderboardApiError";
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function pick(record: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** KALIEN amounts from the Worker are base-unit decimal strings. */
function kalienAmount(value: unknown): bigint | null {
  return parseBaseUnits(value);
}

function parseProfile(raw: unknown, fallbackAddress: string): PlayerProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Json;
  return {
    playerAddress: str(pick(record, "playerAddress", "player_address")) ?? fallbackAddress,
    username: str(pick(record, "username")),
    linkUrl: str(pick(record, "linkUrl", "link_url")),
    updatedAt: str(pick(record, "updatedAt", "updated_at")) ?? new Date(0).toISOString(),
  };
}

export function parseLeaderboardEntry(raw: unknown, index = 0): LeaderboardEntry {
  const record = obj(raw);
  const playerAddress = str(pick(record, "playerAddress", "player_address", "player")) ?? "";
  return {
    rank: num(pick(record, "rank")) ?? index + 1,
    runId: str(pick(record, "runId", "run_id")),
    playerAddress,
    profile: parseProfile(pick(record, "profile"), playerAddress),
    score: num(pick(record, "score", "finalScore", "final_score", "newBest", "new_best")) ?? 0,
    minted: kalienAmount(pick(record, "minted", "mintedDelta", "minted_delta")),
    seed: num(pick(record, "seed")) ?? 0,
    seedId: num(pick(record, "seedId", "seed_id")),
    frameCount: num(pick(record, "frameCount", "frame_count")),
    completedAt:
      str(pick(record, "completedAt", "completed_at", "closedAt", "closed_at", "createdAt")) ??
      new Date(0).toISOString(),
    txHash: str(pick(record, "txHash", "tx_hash")),
  };
}

function parsePagination(raw: unknown, fallbackCount: number) {
  const record = obj(raw);
  return {
    limit: num(pick(record, "limit")) ?? fallbackCount,
    offset: num(pick(record, "offset")) ?? 0,
    total: num(pick(record, "total")) ?? fallbackCount,
    nextOffset: num(pick(record, "nextOffset", "next_offset")),
  };
}

export function parseLeaderboardPage(
  payload: unknown,
  window: LeaderboardWindow,
): LeaderboardPageResponse {
  const record = obj(payload);
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries = rawEntries.map((entry, index) => parseLeaderboardEntry(entry, index));
  const ingestion = record.ingestion ? obj(record.ingestion) : null;
  return {
    window: (str(record.window) as LeaderboardWindow | null) ?? window,
    generatedAt: str(pick(record, "generatedAt", "generated_at")),
    pagination: parsePagination(record.pagination, entries.length),
    entries,
    me: record.me ? parseLeaderboardEntry(record.me) : null,
    ingestion: ingestion
      ? {
          lastSyncedAt: str(pick(ingestion, "lastSyncedAt", "last_synced_at")),
          latestBlock: num(pick(ingestion, "latestBlock", "latest_block")),
          totalEvents: num(pick(ingestion, "totalEvents", "total_events")),
        }
      : null,
  };
}

export function parseLeaderboardPlayer(
  payload: unknown,
  fallbackAddress: string,
): LeaderboardPlayer {
  const player = obj(obj(payload).player ?? payload);
  const playerAddress =
    str(pick(player, "playerAddress", "player_address", "address")) ?? fallbackAddress;
  const stats = obj(player.stats);
  const ranks = obj(player.ranks);
  const rawRuns = pick(player, "recentRuns", "recent_runs");
  const recentRuns = (Array.isArray(rawRuns) ? rawRuns : []).map((run, index) =>
    parseLeaderboardEntry(run, index),
  );
  return {
    playerAddress,
    profile: parseProfile(player.profile, playerAddress),
    stats: {
      totalRuns: num(pick(stats, "totalRuns", "total_runs")) ?? 0,
      bestScore: num(pick(stats, "bestScore", "best_score")) ?? 0,
      totalMinted: kalienAmount(pick(stats, "totalMinted", "total_minted")),
      lastPlayedAt: str(pick(stats, "lastPlayedAt", "last_played_at")),
    },
    ranks: {
      tenMin: num(pick(ranks, "tenMin", "ten_min")),
      day: num(pick(ranks, "day")),
      all: num(pick(ranks, "all")),
    },
    recentRuns,
    runsPagination: parsePagination(
      pick(player, "runsPagination", "runs_pagination"),
      recentRuns.length,
    ),
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await baseFetchWithTimeout(input, init, timeoutMs);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LeaderboardApiError("request timed out", 0);
    }
    throw error;
  }
}

async function parseError(response: Response): Promise<LeaderboardApiError> {
  let message = `request failed (${response.status})`;
  try {
    const payload = (await response.json()) as Json;
    const error = str(payload.error);
    if (error && error.trim().length > 0) {
      message = error;
    }
  } catch {
    // ignored
  }

  return new LeaderboardApiError(message, response.status);
}

export async function getLeaderboard({
  window,
  limit = 25,
  offset = 0,
  address,
}: {
  window: LeaderboardWindow;
  limit?: number;
  offset?: number;
  address?: string | null;
}): Promise<LeaderboardPageResponse> {
  const params = new URLSearchParams();
  params.set("window", window);
  params.set("limit", `${limit}`);
  params.set("offset", `${offset}`);
  if (address && address.trim().length > 0) {
    params.set("address", address.trim());
  }

  const response = await fetchWithTimeout(
    `/api/leaderboard?${params.toString()}`,
    { method: "GET" },
    10_000,
  );
  if (!response.ok) {
    throw await parseError(response);
  }

  return parseLeaderboardPage(await response.json(), window);
}

export async function getLeaderboardPlayer(
  playerAddress: string,
  options?: { runsLimit?: number; runsOffset?: number },
): Promise<LeaderboardPlayer> {
  const params = new URLSearchParams();
  if (options?.runsLimit != null) {
    params.set("runs_limit", `${options.runsLimit}`);
  }
  if (options?.runsOffset != null) {
    params.set("runs_offset", `${options.runsOffset}`);
  }
  const qs = params.toString();
  const url = `/api/leaderboard/player/${encodeURIComponent(playerAddress)}${qs ? `?${qs}` : ""}`;
  const response = await fetchWithTimeout(url, { method: "GET" }, 10_000);
  if (!response.ok) {
    throw await parseError(response);
  }

  return parseLeaderboardPlayer(await response.json(), playerAddress);
}

export const PROFILE_MESSAGE_DOMAIN = "kalien-profile-v1";

/**
 * Text the player key signs to edit a profile. Must match `profileMessage` in
 * `worker/profile.ts`: the Worker rebuilds it from the request and checks the
 * Ed25519 signature over its UTF-8 bytes. Null fields are empty strings.
 */
export function profileUpdateMessage(input: {
  networkHash: string;
  address: string;
  timestamp: number;
  username: string | null;
  linkUrl: string | null;
}): string {
  return [
    PROFILE_MESSAGE_DOMAIN,
    input.networkHash.toLowerCase(),
    input.address.toLowerCase(),
    String(input.timestamp),
    input.username ?? "",
    input.linkUrl ?? "",
  ].join("\n");
}

export interface ProfileSigner {
  pubkeyHex: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export async function updateLeaderboardProfile(
  playerAddress: string,
  updates: { username: string | null; linkUrl: string | null },
  signer: ProfileSigner,
): Promise<{ profile: PlayerProfile }> {
  const { networkHash } = await getThruputConfig();
  const timestamp = Date.now();
  const message = profileUpdateMessage({
    networkHash,
    address: playerAddress,
    username: updates.username,
    linkUrl: updates.linkUrl,
    timestamp,
  });
  const signature = await signer.sign(new TextEncoder().encode(message));

  const response = await fetchWithTimeout(
    `/api/leaderboard/player/${encodeURIComponent(playerAddress)}/profile`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: updates.username,
        linkUrl: updates.linkUrl,
        pubkey: signer.pubkeyHex,
        timestamp,
        signature: bytesToHex(signature),
      }),
    },
    10_000,
  );
  if (!response.ok) {
    throw await parseError(response);
  }

  const payload = await parseJson<Json>(response);
  const profile = parseProfile(payload.profile, playerAddress);
  if (!profile) {
    throw new LeaderboardApiError("profile response is missing the profile", response.status);
  }
  return { profile };
}
