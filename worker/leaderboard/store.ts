import { chainSettings } from "../chain/network";
import type { WorkerEnv } from "../env";

export type LeaderboardWindow = "10m" | "day" | "all";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LEADERBOARD_LIMIT = 25;
export const MAX_LEADERBOARD_LIMIT = 100;
export const MAX_LEADERBOARD_OFFSET = 10_000;

export interface ScoreEventRow {
  tapeHash: string;
  playerAddress: string;
  seedId: number;
  seed: number;
  frameCount: number;
  finalScore: number;
  previousBest: number;
  newBest: number;
  /** KALIEN base units (7 decimals), as a decimal string. */
  mintedDelta: string;
  txHash: string;
  blockHeight: string;
  closedAt: string;
  source: "relay" | "indexer";
}

export interface PlayerProfile {
  playerAddress: string;
  username: string | null;
  linkUrl: string | null;
  updatedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  playerAddress: string;
  score: number;
  seedId: number;
  seed: number;
  frameCount: number;
  mintedDelta: string;
  tapeHash: string;
  /** Run id for `/api/runs/:id` and its tape (the tape hash). */
  runId: string;
  txHash: string;
  blockHeight: string;
  closedAt: string;
  profile: PlayerProfile | null;
}

export interface IndexerState {
  contractAddress: string;
  fromHeight: string;
  cursor: string;
  lastHeight: string;
  latestBlock: string | null;
  oldestBlock: string | null;
  lastSyncedAt: string | null;
  totalEvents: number;
  lastError: string | null;
}

type Row = Record<string, unknown>;

/** Rows belong to one score contract; a redeploy starts a new leaderboard. */
function contractOf(env: WorkerEnv): string {
  return chainSettings(env).scoreContract ?? "";
}

function db(env: WorkerEnv): D1Database {
  if (!env.LEADERBOARD_DB) {
    throw new Error("LEADERBOARD_DB binding is not configured");
  }
  return env.LEADERBOARD_DB;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toIntegerString(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }
  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    return value;
  }
  return "0";
}

export function parseLeaderboardWindow(raw: string | undefined): LeaderboardWindow | null {
  if (!raw || raw.trim().length === 0) {
    return "10m";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "10m" || normalized === "day" || normalized === "all") {
    return normalized;
  }
  return null;
}

function windowCutoffIso(window: LeaderboardWindow, nowMs: number): string | null {
  if (window === "10m") {
    return new Date(nowMs - TEN_MINUTES_MS).toISOString();
  }
  if (window === "day") {
    return new Date(nowMs - ONE_DAY_MS).toISOString();
  }
  return null;
}

// Best run per player in the window, ranked by score, then earliest, then
// tape hash for a stable order.
function rankedCte(cutoff: string | null): string {
  return `WITH filtered AS (
    SELECT * FROM score_events WHERE contract = ? ${cutoff ? "AND closed_at >= ?" : ""}
  ),
  best_per_player AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY player_address
        ORDER BY new_best DESC, closed_at ASC, tape_hash ASC
      ) AS player_rank
    FROM filtered
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (ORDER BY new_best DESC, closed_at ASC, tape_hash ASC) AS rank
    FROM best_per_player
    WHERE player_rank = 1
  )`;
}

const RANKED_COLUMNS = `ranked.rank, ranked.player_address, ranked.new_best, ranked.seed_id, ranked.seed,
  ranked.frame_count, ranked.minted_delta, ranked.tape_hash, ranked.tx_hash, ranked.block_height,
  ranked.closed_at, p.username AS profile_username, p.link_url AS profile_link_url,
  p.updated_at AS profile_updated_at`;

function mapProfile(row: Row, playerAddress: string): PlayerProfile | null {
  const updatedAt = toNullableString(row.profile_updated_at);
  if (!updatedAt) {
    return null;
  }
  return {
    playerAddress,
    username: toNullableString(row.profile_username),
    linkUrl: toNullableString(row.profile_link_url),
    updatedAt,
  };
}

function mapEntry(row: Row): LeaderboardEntry {
  const playerAddress = String(row.player_address);
  const tapeHash = String(row.tape_hash);
  return {
    rank: toNumber(row.rank),
    playerAddress,
    score: toNumber(row.new_best),
    seedId: toNumber(row.seed_id),
    seed: toNumber(row.seed) >>> 0,
    frameCount: toNumber(row.frame_count),
    mintedDelta: toIntegerString(row.minted_delta),
    tapeHash,
    runId: tapeHash,
    txHash: String(row.tx_hash),
    blockHeight: toIntegerString(row.block_height),
    closedAt: String(row.closed_at),
    profile: mapProfile(row, playerAddress),
  };
}

export async function upsertScoreEvent(env: WorkerEnv, event: ScoreEventRow): Promise<boolean> {
  const result = await scoreEventStatement(env, event).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function getLeaderboardPage(
  env: WorkerEnv,
  options: {
    window: LeaderboardWindow;
    limit: number;
    offset: number;
    playerAddress: string | null;
    nowMs?: number;
  },
): Promise<{
  window: LeaderboardWindow;
  generatedAt: string;
  windowRange: { startAt: string | null; endAt: string };
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}> {
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = windowCutoffIso(options.window, nowMs);
  const params = [contractOf(env), ...(cutoff ? [cutoff] : [])];
  const database = db(env);

  const [totalRow, rows, meRow] = await Promise.all([
    database
      .prepare(`${rankedCte(cutoff)} SELECT COUNT(*) AS total FROM ranked`)
      .bind(...params)
      .first<Row>(),
    database
      .prepare(
        `${rankedCte(cutoff)}
         SELECT ${RANKED_COLUMNS}
         FROM ranked LEFT JOIN player_profiles AS p ON p.player_address = ranked.player_address
         ORDER BY ranked.rank ASC LIMIT ? OFFSET ?`,
      )
      .bind(...params, options.limit, options.offset)
      .all<Row>(),
    options.playerAddress
      ? database
          .prepare(
            `${rankedCte(cutoff)}
             SELECT ${RANKED_COLUMNS}
             FROM ranked LEFT JOIN player_profiles AS p ON p.player_address = ranked.player_address
             WHERE ranked.player_address = ? LIMIT 1`,
          )
          .bind(...params, options.playerAddress)
          .first<Row>()
      : Promise.resolve(null),
  ]);

  const total = toNumber(totalRow?.total);
  return {
    window: options.window,
    generatedAt: new Date(nowMs).toISOString(),
    windowRange: { startAt: cutoff, endAt: new Date(nowMs).toISOString() },
    total,
    limit: options.limit,
    offset: options.offset,
    nextOffset: options.offset + options.limit < total ? options.offset + options.limit : null,
    entries: (rows.results ?? []).map(mapEntry),
    me: meRow ? mapEntry(meRow) : null,
  };
}

async function playerRank(
  env: WorkerEnv,
  playerAddress: string,
  window: LeaderboardWindow,
  nowMs: number,
): Promise<number | null> {
  const cutoff = windowCutoffIso(window, nowMs);
  const row = await db(env)
    .prepare(`${rankedCte(cutoff)} SELECT rank FROM ranked WHERE player_address = ? LIMIT 1`)
    .bind(contractOf(env), ...(cutoff ? [cutoff] : []), playerAddress)
    .first<Row>();
  return row ? toNumber(row.rank) || null : null;
}

export interface PlayerRun {
  runId: string;
  tapeHash: string;
  score: number;
  previousBest: number;
  mintedDelta: string;
  seedId: number;
  seed: number;
  frameCount: number;
  txHash: string;
  blockHeight: string;
  closedAt: string;
}

export async function getProfile(
  env: WorkerEnv,
  playerAddress: string,
): Promise<PlayerProfile | null> {
  const row = await db(env)
    .prepare(
      `SELECT username AS profile_username, link_url AS profile_link_url,
         updated_at AS profile_updated_at
       FROM player_profiles WHERE player_address = ?`,
    )
    .bind(playerAddress)
    .first<Row>();
  return row ? mapProfile(row, playerAddress) : null;
}

export async function getPlayer(
  env: WorkerEnv,
  playerAddress: string,
  runs: { limit: number; offset: number },
  nowMs = Date.now(),
): Promise<{
  profile: PlayerProfile | null;
  stats: { totalRuns: number; bestScore: number; totalMinted: string; lastPlayedAt: string | null };
  ranks: { tenMin: number | null; day: number | null; all: number | null };
  recentRuns: PlayerRun[];
  runsPagination: { limit: number; offset: number; total: number; nextOffset: number | null };
}> {
  const database = db(env);
  const [profile, statsRow, runRows, tenMin, day, all] = await Promise.all([
    getProfile(env, playerAddress),
    database
      .prepare(
        `SELECT COUNT(*) AS total_runs, COALESCE(MAX(new_best), 0) AS best_score,
           COALESCE(SUM(minted_delta), 0) AS total_minted, MAX(closed_at) AS last_played_at
         FROM score_events WHERE contract = ? AND player_address = ?`,
      )
      .bind(contractOf(env), playerAddress)
      .first<Row>(),
    database
      .prepare(
        `SELECT * FROM score_events WHERE contract = ? AND player_address = ?
         ORDER BY closed_at DESC, tape_hash ASC LIMIT ? OFFSET ?`,
      )
      .bind(contractOf(env), playerAddress, runs.limit, runs.offset)
      .all<Row>(),
    playerRank(env, playerAddress, "10m", nowMs),
    playerRank(env, playerAddress, "day", nowMs),
    playerRank(env, playerAddress, "all", nowMs),
  ]);

  const totalRuns = toNumber(statsRow?.total_runs);
  return {
    profile,
    stats: {
      totalRuns,
      bestScore: toNumber(statsRow?.best_score),
      totalMinted: toIntegerString(statsRow?.total_minted),
      lastPlayedAt: toNullableString(statsRow?.last_played_at),
    },
    ranks: { tenMin, day, all },
    recentRuns: (runRows.results ?? []).map((row) => ({
      runId: String(row.tape_hash),
      tapeHash: String(row.tape_hash),
      score: toNumber(row.new_best),
      previousBest: toNumber(row.previous_best),
      mintedDelta: toIntegerString(row.minted_delta),
      seedId: toNumber(row.seed_id),
      seed: toNumber(row.seed) >>> 0,
      frameCount: toNumber(row.frame_count),
      txHash: String(row.tx_hash),
      blockHeight: toIntegerString(row.block_height),
      closedAt: String(row.closed_at),
    })),
    runsPagination: {
      limit: runs.limit,
      offset: runs.offset,
      total: totalRuns,
      nextOffset: runs.offset + runs.limit < totalRuns ? runs.offset + runs.limit : null,
    },
  };
}

/**
 * Writes a profile only when the signed timestamp is newer than the stored
 * one. Returns false when a newer update already exists.
 */
export async function upsertProfile(
  env: WorkerEnv,
  profile: {
    playerAddress: string;
    playerPubkey: string;
    username: string | null;
    linkUrl: string | null;
    signedAt: number;
  },
): Promise<boolean> {
  const result = await db(env)
    .prepare(
      `INSERT INTO player_profiles (player_address, player_pubkey, username, link_url, signed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_address) DO UPDATE SET
         player_pubkey = excluded.player_pubkey,
         username = excluded.username,
         link_url = excluded.link_url,
         signed_at = excluded.signed_at,
         updated_at = excluded.updated_at
       WHERE excluded.signed_at > player_profiles.signed_at`,
    )
    .bind(
      profile.playerAddress,
      profile.playerPubkey,
      profile.username,
      profile.linkUrl,
      profile.signedAt,
      new Date().toISOString(),
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordSeed(env: WorkerEnv, seedId: number, seed: number): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO seeds (contract, seed_id, seed, recorded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(contract, seed_id) DO NOTHING`,
    )
    .bind(contractOf(env), seedId, seed >>> 0, new Date().toISOString())
    .run();
}

export async function getSeed(env: WorkerEnv, seedId: number): Promise<number | null> {
  const row = await db(env)
    .prepare(`SELECT seed FROM seeds WHERE contract = ? AND seed_id = ?`)
    .bind(contractOf(env), seedId)
    .first<Row>();
  return row ? toNumber(row.seed) >>> 0 : null;
}

export async function getIndexerState(env: WorkerEnv): Promise<IndexerState | null> {
  const row = await db(env)
    .prepare(`SELECT * FROM indexer_state WHERE singleton_id = 1`)
    .first<Row>();
  if (!row) {
    return null;
  }
  return {
    contractAddress: String(row.contract_address),
    fromHeight: String(row.from_height),
    cursor: String(row.cursor ?? ""),
    lastHeight: String(row.last_height ?? "0"),
    latestBlock: toNullableString(row.latest_block),
    oldestBlock: toNullableString(row.oldest_block),
    lastSyncedAt: toNullableString(row.last_synced_at),
    totalEvents: toNumber(row.total_events),
    lastError: toNullableString(row.last_error),
  };
}

export function indexerStateStatement(env: WorkerEnv, state: IndexerState): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO indexer_state (singleton_id, contract_address, from_height, cursor, last_height,
         latest_block, oldest_block, last_synced_at, total_events, last_error)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton_id) DO UPDATE SET
         contract_address = excluded.contract_address,
         from_height = excluded.from_height,
         cursor = excluded.cursor,
         last_height = excluded.last_height,
         latest_block = excluded.latest_block,
         oldest_block = excluded.oldest_block,
         last_synced_at = excluded.last_synced_at,
         total_events = excluded.total_events,
         last_error = excluded.last_error`,
    )
    .bind(
      state.contractAddress,
      state.fromHeight,
      state.cursor,
      state.lastHeight,
      state.latestBlock,
      state.oldestBlock,
      state.lastSyncedAt,
      state.totalEvents,
      state.lastError,
    );
}

export function scoreEventStatement(env: WorkerEnv, event: ScoreEventRow): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO score_events (contract, tape_hash, player_address, seed_id, seed, frame_count, final_score,
         previous_best, new_best, minted_delta, tx_hash, block_height, closed_at, source, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract, tape_hash) DO NOTHING`,
    )
    .bind(
      contractOf(env),
      event.tapeHash,
      event.playerAddress,
      event.seedId,
      event.seed >>> 0,
      event.frameCount,
      event.finalScore,
      event.previousBest,
      event.newBest,
      Number(event.mintedDelta),
      event.txHash,
      Number(event.blockHeight),
      event.closedAt,
      event.source,
      new Date().toISOString(),
    );
}

export async function countScoreEvents(env: WorkerEnv): Promise<number> {
  const row = await db(env)
    .prepare(`SELECT COUNT(*) AS n FROM score_events WHERE contract = ?`)
    .bind(contractOf(env))
    .first<Row>();
  return toNumber(row?.n);
}

export async function getScoreEvent(
  env: WorkerEnv,
  tapeHash: string,
): Promise<ScoreEventRow | null> {
  const row = await db(env)
    .prepare(`SELECT * FROM score_events WHERE contract = ? AND tape_hash = ?`)
    .bind(contractOf(env), tapeHash.toLowerCase())
    .first<Row>();
  if (!row) {
    return null;
  }
  return {
    tapeHash: String(row.tape_hash),
    playerAddress: String(row.player_address),
    seedId: toNumber(row.seed_id),
    seed: toNumber(row.seed) >>> 0,
    frameCount: toNumber(row.frame_count),
    finalScore: toNumber(row.final_score),
    previousBest: toNumber(row.previous_best),
    newBest: toNumber(row.new_best),
    mintedDelta: toIntegerString(row.minted_delta),
    txHash: String(row.tx_hash),
    blockHeight: toIntegerString(row.block_height),
    closedAt: String(row.closed_at),
    source: row.source === "relay" ? "relay" : "indexer",
  };
}
