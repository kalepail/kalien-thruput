// Run journal for the relay Durable Object. It uses the Durable Object SQLite
// API (synchronous); tests pass a bun:sqlite wrapper with the same shape.

export interface SqlCursorLike<T> {
  toArray(): T[];
}

export interface SqlLike {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursorLike<T>;
}

/**
 * `unknown`: the relay could not settle the transaction in time (for example
 * a commitment without a receipt). It frees the lane slot, is re-checked with
 * backoff, and is never re-sent automatically (wire-14 guide).
 */
export type RunStatus = "queued" | "submitting" | "confirmed" | "rejected" | "failed" | "unknown";

export interface RunRecord {
  runId: string;
  playerPubkey: string;
  playerAddress: string;
  seedId: number;
  seed: number;
  frameCount: number;
  claimedScore: number;
  signature: string;
  status: RunStatus;
  attempts: number;
  txHash: string | null;
  signedTx: string | null;
  expiryHeight: string | null;
  lastBroadcastAt: number | null;
  /** Height from a `committed` status of the current transaction, if seen. */
  committedHeight: string | null;
  /** Root gas limit of the current transaction. */
  gasLimit: string | null;
  /** Child gas for the next attempt after an out-of-gas fault, else null. */
  gasOverride: string | null;
  /** Out-of-gas retries used (at most one). */
  oogRetries: number;
  /** When the current transaction was signed (ms). */
  attemptAt: number | null;
  /** True for a failure that repeats for the same input; a re-POST does not queue it. */
  final: boolean;
  /** Reconcile checks of an `unknown` run so far. */
  checks: number;
  nextAttemptAt: number;
  score: number | null;
  previousBest: number | null;
  minted: string | null;
  blockHeight: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type NewRun = Pick<
  RunRecord,
  | "runId"
  | "playerPubkey"
  | "playerAddress"
  | "seedId"
  | "seed"
  | "frameCount"
  | "claimedScore"
  | "signature"
>;

/** Position after a run in newest-first order. */
export interface RunCursor {
  createdAt: number;
  runId: string;
}

/** A pending seed-touch transaction. Only one exists at a time. */
export interface SeedTouch {
  seedId: number;
  txHash: string;
  expiryHeight: string;
  createdAt: number;
}

type Row = Record<string, SqlStorageValue>;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    player_pubkey TEXT NOT NULL,
    player_address TEXT NOT NULL,
    seed_id INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    frame_count INTEGER NOT NULL,
    claimed_score INTEGER NOT NULL,
    signature TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    tx_hash TEXT,
    signed_tx TEXT,
    expiry_height TEXT,
    last_broadcast_at INTEGER,
    committed_height TEXT,
    gas_limit TEXT,
    gas_override TEXT,
    oog_retries INTEGER NOT NULL DEFAULT 0,
    attempt_at INTEGER,
    final INTEGER NOT NULL DEFAULT 0,
    checks INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    previous_best INTEGER,
    minted TEXT,
    block_height TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_address, created_at DESC)`,
  // Every signed transaction, kept before broadcast. A run can have several
  // attempts; only an attempt whose expiry height has passed is replaced.
  `CREATE TABLE IF NOT EXISTS run_attempts (
    tx_hash TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    expiry_height TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relay_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

function num(value: SqlStorageValue | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function str(value: SqlStorageValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function toRun(row: Row): RunRecord {
  return {
    runId: String(row.run_id),
    playerPubkey: String(row.player_pubkey),
    playerAddress: String(row.player_address),
    seedId: num(row.seed_id),
    seed: num(row.seed) >>> 0,
    frameCount: num(row.frame_count),
    claimedScore: num(row.claimed_score),
    signature: String(row.signature),
    status: String(row.status) as RunStatus,
    attempts: num(row.attempts),
    txHash: str(row.tx_hash),
    signedTx: str(row.signed_tx),
    expiryHeight: str(row.expiry_height),
    lastBroadcastAt: row.last_broadcast_at === null ? null : num(row.last_broadcast_at),
    committedHeight: str(row.committed_height),
    gasLimit: str(row.gas_limit),
    gasOverride: str(row.gas_override),
    oogRetries: num(row.oog_retries),
    attemptAt: row.attempt_at === null || row.attempt_at === undefined ? null : num(row.attempt_at),
    final: num(row.final) === 1,
    checks: num(row.checks),
    nextAttemptAt: num(row.next_attempt_at),
    score: row.score === null ? null : num(row.score),
    previousBest: row.previous_best === null ? null : num(row.previous_best),
    minted: str(row.minted),
    blockHeight: str(row.block_height),
    error: str(row.error),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export class RelayStore {
  constructor(private readonly sql: SqlLike) {
    for (const statement of SCHEMA) {
      sql.exec(statement);
    }
    // Journals made before these columns existed.
    const columns = new Set(
      sql
        .exec<Row>(`PRAGMA table_info(runs)`)
        .toArray()
        .map((column) => String(column.name)),
    );
    for (const [name, type] of [
      ["committed_height", "TEXT"],
      ["gas_limit", "TEXT"],
      ["gas_override", "TEXT"],
      ["oog_retries", "INTEGER NOT NULL DEFAULT 0"],
      ["attempt_at", "INTEGER"],
      ["final", "INTEGER NOT NULL DEFAULT 0"],
      ["checks", "INTEGER NOT NULL DEFAULT 0"],
    ]) {
      if (!columns.has(name ?? "")) {
        sql.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
      }
    }
  }

  getRun(runId: string): RunRecord | null {
    const [row] = this.sql.exec<Row>(`SELECT * FROM runs WHERE run_id = ?`, runId).toArray();
    return row ? toRun(row) : null;
  }

  requireRun(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`unknown run ${runId}`);
    }
    return run;
  }

  /**
   * Inserts a queued run. A run that already exists is kept as is, except a
   * failed run, which goes back to the queue. Returns the stored run.
   */
  enqueue(run: NewRun, now: number): { run: RunRecord; created: boolean } {
    const existing = this.getRun(run.runId);
    if (existing) {
      if (existing.status === "failed" && !existing.final) {
        this.sql.exec(
          `UPDATE runs SET status = 'queued', attempts = 0, error = NULL, next_attempt_at = ?,
             updated_at = ? WHERE run_id = ?`,
          now,
          now,
          run.runId,
        );
        return { run: this.requireRun(run.runId), created: false };
      }
      return { run: existing, created: false };
    }
    this.sql.exec(
      `INSERT INTO runs (run_id, player_pubkey, player_address, seed_id, seed, frame_count,
         claimed_score, signature, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      run.runId,
      run.playerPubkey,
      run.playerAddress,
      run.seedId,
      run.seed >>> 0,
      run.frameCount,
      run.claimedScore,
      run.signature,
      now,
      now,
    );
    return { run: this.requireRun(run.runId), created: true };
  }

  /**
   * A player's runs, newest first (created_at DESC, run_id DESC). `before`
   * continues after the last row of a previous page.
   */
  listByPlayer(
    playerAddress: string,
    options: { limit: number; offset?: number; before?: RunCursor | null },
  ): RunRecord[] {
    const before = options.before ?? null;
    return this.sql
      .exec<Row>(
        `SELECT * FROM runs WHERE player_address = ?
           ${before ? "AND (created_at < ? OR (created_at = ? AND run_id < ?))" : ""}
         ORDER BY created_at DESC, run_id DESC LIMIT ? OFFSET ?`,
        playerAddress,
        ...(before ? [before.createdAt, before.createdAt, before.runId] : []),
        options.limit,
        options.offset ?? 0,
      )
      .toArray()
      .map(toRun);
  }

  countByPlayer(playerAddress: string): number {
    const [row] = this.sql
      .exec<Row>(`SELECT COUNT(*) AS n FROM runs WHERE player_address = ?`, playerAddress)
      .toArray();
    return row ? num(row.n) : 0;
  }

  /** Queued runs whose retry time has come, oldest first. */
  dueQueued(now: number, limit: number): RunRecord[] {
    return this.sql
      .exec<Row>(
        `SELECT * FROM runs WHERE status = 'queued' AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT ?`,
        now,
        limit,
      )
      .toArray()
      .map(toRun);
  }

  submitting(): RunRecord[] {
    return this.sql
      .exec<Row>(`SELECT * FROM runs WHERE status = 'submitting' ORDER BY created_at ASC`)
      .toArray()
      .map(toRun);
  }

  countByStatus(): Record<RunStatus, number> {
    const out: Record<RunStatus, number> = {
      queued: 0,
      submitting: 0,
      confirmed: 0,
      rejected: 0,
      failed: 0,
      unknown: 0,
    };
    for (const row of this.sql
      .exec<Row>(`SELECT status, COUNT(*) AS n FROM runs GROUP BY status`)
      .toArray()) {
      out[String(row.status) as RunStatus] = num(row.n);
    }
    return out;
  }

  /** Next time a queued run becomes due, or null. */
  nextQueuedAt(): number | null {
    const [row] = this.sql
      .exec<Row>(
        `SELECT MIN(next_attempt_at) AS at FROM runs WHERE status IN ('queued', 'unknown')`,
      )
      .toArray();
    return row && row.at !== null ? num(row.at) : null;
  }

  /** Journals a signed transaction. Call before broadcast. */
  recordAttempt(
    runId: string,
    attempt: { txHash: string; signedTx: string; expiryHeight: string; gasLimit: string },
    now: number,
  ): void {
    const run = this.requireRun(runId);
    this.sql.exec(
      `INSERT INTO run_attempts (tx_hash, run_id, attempt, expiry_height, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      attempt.txHash,
      runId,
      run.attempts + 1,
      attempt.expiryHeight,
      now,
    );
    this.sql.exec(
      `UPDATE runs SET status = 'submitting', attempts = attempts + 1, tx_hash = ?, signed_tx = ?,
         expiry_height = ?, gas_limit = ?, last_broadcast_at = NULL, committed_height = NULL,
         attempt_at = ?, checks = 0, updated_at = ?
       WHERE run_id = ?`,
      attempt.txHash,
      attempt.signedTx,
      attempt.expiryHeight,
      attempt.gasLimit,
      now,
      now,
      runId,
    );
  }

  /**
   * After an out-of-gas fault: queue one more attempt with more child gas.
   * The fault committed as a failure, so no state changed.
   */
  requeueWithMoreGas(runId: string, childGas: string, reason: string, now: number): void {
    this.sql.exec(
      `UPDATE runs SET status = 'queued', error = ?, signed_tx = NULL, gas_override = ?,
         oog_retries = oog_retries + 1, next_attempt_at = ?, updated_at = ? WHERE run_id = ?`,
      reason,
      childGas,
      now,
      now,
      runId,
    );
  }

  /** Recent runs with one of these statuses, newest first. */
  listByStatus(statuses: RunStatus[], limit: number): RunRecord[] {
    if (statuses.length === 0) {
      return [];
    }
    return this.sql
      .exec<Row>(
        `SELECT * FROM runs WHERE status IN (${statuses.map(() => "?").join(",")})
         ORDER BY updated_at DESC LIMIT ?`,
        ...statuses,
        limit,
      )
      .toArray()
      .map(toRun);
  }

  markCommitted(runId: string, height: string, now: number): void {
    this.sql.exec(
      `UPDATE runs SET committed_height = ?, updated_at = ? WHERE run_id = ?`,
      height,
      now,
      runId,
    );
  }

  markBroadcast(runId: string, now: number): void {
    this.sql.exec(
      `UPDATE runs SET last_broadcast_at = ?, updated_at = ? WHERE run_id = ?`,
      now,
      now,
      runId,
    );
  }

  /** Puts a run back in the queue for a new attempt after `retryAt`. */
  requeue(runId: string, reason: string, retryAt: number, now: number): void {
    this.sql.exec(
      `UPDATE runs SET status = 'queued', error = ?, signed_tx = NULL, next_attempt_at = ?,
         updated_at = ? WHERE run_id = ?`,
      reason,
      retryAt,
      now,
      runId,
    );
  }

  confirm(
    runId: string,
    result: {
      score: number | null;
      previousBest: number | null;
      minted: string | null;
      blockHeight: string | null;
    },
    now: number,
  ): void {
    this.sql.exec(
      `UPDATE runs SET status = 'confirmed', score = ?, previous_best = ?, minted = ?,
         block_height = ?, error = NULL, signed_tx = NULL, updated_at = ? WHERE run_id = ?`,
      result.score,
      result.previousBest,
      result.minted,
      result.blockHeight,
      now,
      runId,
    );
  }

  finish(
    runId: string,
    status: "rejected" | "failed",
    reason: string,
    blockHeight: string | null,
    now: number,
    final = false,
  ): void {
    this.sql.exec(
      `UPDATE runs SET status = ?, error = ?, block_height = ?, signed_tx = NULL, final = ?,
         updated_at = ?
       WHERE run_id = ?`,
      status,
      reason,
      blockHeight,
      final ? 1 : 0,
      now,
      runId,
    );
  }

  /** Needs attention: frees the lane slot; re-checked at `nextCheckAt`. */
  markUnknown(runId: string, reason: string, nextCheckAt: number, now: number): void {
    this.sql.exec(
      `UPDATE runs SET status = 'unknown', error = ?, next_attempt_at = ?, updated_at = ?
       WHERE run_id = ?`,
      reason,
      nextCheckAt,
      now,
      runId,
    );
  }

  /** `unknown` runs whose next check is due, oldest first. */
  dueUnknown(now: number, limit: number): RunRecord[] {
    return this.sql
      .exec<Row>(
        `SELECT * FROM runs WHERE status = 'unknown' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC LIMIT ?`,
        now,
        limit,
      )
      .toArray()
      .map(toRun);
  }

  scheduleCheck(runId: string, nextCheckAt: number, now: number): void {
    this.sql.exec(
      `UPDATE runs SET checks = checks + 1, next_attempt_at = ?, updated_at = ? WHERE run_id = ?`,
      nextCheckAt,
      now,
      runId,
    );
  }

  getKv(key: string): string | null {
    const [row] = this.sql.exec<Row>(`SELECT value FROM relay_kv WHERE key = ?`, key).toArray();
    return row ? String(row.value) : null;
  }

  setKv(key: string, value: string | null): void {
    if (value === null) {
      this.sql.exec(`DELETE FROM relay_kv WHERE key = ?`, key);
      return;
    }
    this.sql.exec(
      `INSERT INTO relay_kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  getSeedTouch(): SeedTouch | null {
    const raw = this.getKv("seed_touch");
    return raw ? (JSON.parse(raw) as SeedTouch) : null;
  }

  setSeedTouch(touch: SeedTouch | null): void {
    this.setKv("seed_touch", touch ? JSON.stringify(touch) : null);
  }
}
