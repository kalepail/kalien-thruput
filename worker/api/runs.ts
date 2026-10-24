import { Hono } from "hono";
import { claimMessage, pubkeyAccountAddress, verifyEd25519 } from "../claim";
import { chainContext } from "../chain/context";
import { MAX_TAPE_BYTES } from "../constants";
import { bytesToHex, parseFixedHex, sha256 } from "../hex";
import { replayTape } from "../replay";
import { allLanes, allowedLanes, findRun, pickLane, relayLane } from "../relay/stub";
import type { RunCursor } from "../relay/store";
import type { RunView } from "../relay/view";
import { blockedSeedIds, isSeedIdActive, lookupSeed } from "../seed";
import { parseAndValidateTape } from "../tape";
import { getTape, putTape } from "../tapes";
import { getScoreEvent } from "../leaderboard/store";
import { safeErrorMessage } from "../utils";
import {
  TAPE_CACHE_CONTROL,
  RUN_STATUS_CACHE_CONTROL,
  RUN_TERMINAL_CACHE_CONTROL,
} from "../cache-control";
import {
  clientIp,
  isAdmin,
  jsonError,
  normalizeAddress,
  RateLimiter,
  rateLimited,
  type AppContext,
  type AppEnv,
} from "./http";

const RUN_ID_PATTERN = /^[0-9a-f]{64}$/u;

/** Run ids are the tape hash: 64 hex chars, with or without 0x. */
function parseRunId(raw: string): string | null {
  const id = raw.trim().toLowerCase().replace(/^0x/u, "");
  return RUN_ID_PATTERN.test(id) ? id : null;
}
// Per player key, and per IP (players can share an IP). The admin key skips
// the IP limit, for load tests.
const SUBMIT_LIMIT_PER_PLAYER = 30;
const SUBMIT_LIMIT_PER_IP = 120;
const SUBMIT_WINDOW_MS = 10 * 60_000;
const READ_LIMIT_PER_MINUTE = 240;
const MAX_LIST_OFFSET = 1_000;

/** Cursor for newest-first run lists: `<createdAt ms>.<runId>`. */
function formatRunCursor(run: Pick<RunView, "createdAt" | "runId">): string {
  return `${Date.parse(run.createdAt)}.${run.runId}`;
}

function parseRunCursor(raw: string): RunCursor | null {
  const match = /^(\d{1,15})\.([0-9a-f]{64})$/u.exec(raw.trim().toLowerCase());
  return match ? { createdAt: Number(match[1]), runId: match[2] ?? "" } : null;
}

function compareNewestFirst(aAt: string, aId: string, bAt: string, bId: string): number {
  const byTime = Date.parse(bAt) - Date.parse(aAt);
  if (byTime !== 0) {
    return byTime;
  }
  return aId < bId ? 1 : aId > bId ? -1 : 0;
}

const submitByIp = new RateLimiter(SUBMIT_LIMIT_PER_IP, SUBMIT_WINDOW_MS);
const submitByPlayer = new RateLimiter(SUBMIT_LIMIT_PER_PLAYER, SUBMIT_WINDOW_MS);
const readByIp = new RateLimiter(READ_LIMIT_PER_MINUTE, 60_000);

function runResponse(c: AppContext, run: RunView, status: 200 | 202 = 200): Response {
  const terminal =
    run.status === "confirmed" || run.status === "rejected" || run.status === "failed";
  c.header("Cache-Control", terminal ? RUN_TERMINAL_CACHE_CONTROL : RUN_STATUS_CACHE_CONTROL);
  return c.json({ success: true, ...run }, status);
}

async function readBody(c: AppContext): Promise<Uint8Array | null> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_TAPE_BYTES) {
    return null;
  }
  const body = new Uint8Array(await c.req.arrayBuffer());
  return body.length > MAX_TAPE_BYTES ? null : body;
}

/** A confirmed run known only from the leaderboard (for example, submitted by another relay). */
async function indexedRun(c: AppContext, runId: string): Promise<RunView | null> {
  const event = await getScoreEvent(c.env, runId);
  if (!event) {
    return null;
  }
  return {
    runId,
    status: "confirmed",
    playerAddress: event.playerAddress,
    seedId: event.seedId,
    seed: event.seed,
    frameCount: event.frameCount,
    claimedScore: event.finalScore,
    score: event.newBest,
    previousBest: event.previousBest,
    minted: event.mintedDelta,
    txHash: event.txHash,
    blockHeight: event.blockHeight,
    attempts: 0,
    error: null,
    createdAt: event.closedAt,
    updatedAt: event.closedAt,
  };
}

export function createRunsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // POST /api/runs?pubkey=<hex>&seed_id=<n>&sig=<hex>, raw tape body
  router.post("/", async (c) => {
    const pubkey = parseFixedHex(c.req.query("pubkey"), 32);
    if (!pubkey) {
      return jsonError(c, 400, "pubkey must be 32 bytes of hex", { code: "bad_pubkey" });
    }
    const signature = parseFixedHex(c.req.query("sig"), 64);
    if (!signature) {
      return jsonError(c, 400, "sig must be 64 bytes of hex", { code: "bad_signature" });
    }
    const seedIdRaw = c.req.query("seed_id") ?? "";
    const seedId = /^\d{1,10}$/u.test(seedIdRaw) ? Number(seedIdRaw) : Number.NaN;
    if (!Number.isSafeInteger(seedId) || seedId > 0xffffffff) {
      return jsonError(c, 400, "seed_id must be a u32", { code: "bad_seed_id" });
    }
    if (blockedSeedIds(c.env).has(seedId)) {
      return jsonError(c, 403, `seed ${seedId} is closed for claims`, { code: "seed_blocked" });
    }

    const pubkeyHex = bytesToHex(pubkey);
    const retryIp = isAdmin(c) ? 0 : submitByIp.take(clientIp(c));
    if (retryIp > 0) {
      return rateLimited(c, retryIp);
    }
    const retryPlayer = submitByPlayer.take(pubkeyHex);
    if (retryPlayer > 0) {
      return rateLimited(c, retryPlayer);
    }

    const tape = await readBody(c);
    if (!tape) {
      return jsonError(c, 413, `tape is larger than ${MAX_TAPE_BYTES} bytes`, {
        code: "tape_too_large",
      });
    }
    let meta: ReturnType<typeof parseAndValidateTape>;
    try {
      meta = parseAndValidateTape(tape, MAX_TAPE_BYTES);
    } catch (error) {
      return jsonError(c, 400, safeErrorMessage(error), { code: "bad_tape" });
    }

    const runId = bytesToHex(await sha256(tape));
    const playerAddress = pubkeyAccountAddress(pubkey);
    const found = await findRun(c.env, runId);
    const existing = found?.run ?? null;
    if (existing && existing.playerAddress !== playerAddress) {
      return jsonError(c, 409, "this tape was already submitted by another player", {
        code: "already_claimed",
        runId,
      });
    }
    if (existing && existing.status !== "failed") {
      return runResponse(c, existing);
    }

    if (!isSeedIdActive(seedId)) {
      return jsonError(c, 400, `seed ${seedId} is not active`, { code: "seed_inactive" });
    }

    let chain: Awaited<ReturnType<typeof chainContext>>;
    try {
      chain = await chainContext(c.env);
    } catch (error) {
      console.error(`[runs] chain unavailable: ${safeErrorMessage(error)}`);
      return jsonError(c, 503, "chain is not available", { code: "chain_unavailable" });
    }

    const message = claimMessage({
      networkHash: chain.networkHash,
      scoreContract: chain.score.address,
      seedId,
      tape,
    });
    if (!(await verifyEd25519(pubkey, message, signature))) {
      return jsonError(c, 400, "claim signature does not verify", { code: "bad_signature" });
    }

    const replay = replayTape(tape);
    if (replay.replayedScore !== meta.finalScore) {
      return jsonError(
        c,
        400,
        `replay score ${replay.replayedScore} does not match the claimed score ${meta.finalScore}`,
        { code: "replay_mismatch" },
      );
    }

    try {
      const seed = await lookupSeed(c.env, chain, seedId);
      if (seed === null) {
        return jsonError(c, 409, `seed ${seedId} does not exist yet`, { code: "seed_missing" });
      }
      if (seed !== meta.seed) {
        return jsonError(c, 400, `tape seed does not match seed ${seedId}`, {
          code: "seed_mismatch",
        });
      }
      const [best, claimed] = await Promise.all([
        chain.score.bestScore(playerAddress, seedId),
        chain.score.isClaimed(runId),
      ]);
      if (claimed) {
        return jsonError(c, 409, "this tape is already claimed", {
          code: "already_claimed",
          runId,
        });
      }
      if (meta.finalScore <= best) {
        return jsonError(
          c,
          409,
          `score ${meta.finalScore} does not beat your best ${best} for this seed`,
          {
            code: "not_improved",
            bestScore: best,
          },
        );
      }
    } catch (error) {
      console.error(`[runs] chain read failed: ${safeErrorMessage(error)}`);
      return jsonError(c, 503, "chain read failed; try again", { code: "chain_unavailable" });
    }

    // A failed run is queued again in the lane that holds it; a new run goes
    // to an allowed lane.
    const lane = found?.lane ?? pickLane(runId, await allowedLanes(c.env, chain.score));
    await putTape(c.env, runId, tape);
    const { run } = await relayLane(c.env, lane).submitRun(lane, {
      runId,
      playerPubkey: pubkeyHex,
      playerAddress,
      seedId,
      seed: meta.seed,
      frameCount: meta.frameCount,
      claimedScore: meta.finalScore,
      signature: bytesToHex(signature),
    });
    return runResponse(c, run, 202);
  });

  // GET /api/runs?player=<address>
  router.get("/", async (c) => {
    const retry = readByIp.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const player = normalizeAddress(c.req.query("player"));
    if (!player) {
      return jsonError(c, 400, "player must be a 32-byte hex address", { code: "bad_address" });
    }
    const limitRaw = Number.parseInt(c.req.query("limit") ?? "25", 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 100);
    const offsetRaw = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const offset = Math.min(
      Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0),
      MAX_LIST_OFFSET,
    );
    const cursorRaw = c.req.query("cursor");
    const before = cursorRaw ? parseRunCursor(cursorRaw) : null;
    if (cursorRaw && !before) {
      return jsonError(c, 400, "cursor is not valid", { code: "bad_cursor" });
    }

    // Each lane returns its newest rows; merge them, newest first.
    const perLane = before ? limit + 1 : offset + limit + 1;
    const pages = await Promise.all(
      allLanes(c.env).map((lane) =>
        relayLane(c.env, lane).listRuns(lane, player, { limit: perLane, before }),
      ),
    );
    const merged = pages.flatMap((page) => page.runs);
    // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
    merged.sort((a, b) => compareNewestFirst(a.createdAt, a.runId, b.createdAt, b.runId));
    const start = before ? 0 : offset;
    const runs = merged.slice(start, start + limit);
    const more = merged.length > start + limit;
    const last = runs.at(-1);
    c.header("Cache-Control", RUN_STATUS_CACHE_CONTROL);
    return c.json({
      success: true,
      player,
      runs,
      total: pages.reduce((sum, page) => sum + page.total, 0),
      limit,
      offset: before ? null : offset,
      nextOffset: !before && more ? offset + limit : null,
      nextCursor: more && last ? formatRunCursor(last) : null,
    });
  });

  // GET /api/runs/:id
  router.get("/:id", async (c) => {
    const retry = readByIp.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const runId = parseRunId(c.req.param("id"));
    if (!runId) {
      return jsonError(c, 400, "run id must be 32 bytes of hex", { code: "bad_run_id" });
    }
    const run = (await findRun(c.env, runId))?.run ?? (await indexedRun(c, runId));
    if (!run) {
      return jsonError(c, 404, "run not found", { code: "not_found" });
    }
    return runResponse(c, run);
  });

  // GET /api/runs/:id/tape — only for confirmed runs, so a pending tape cannot be front-run.
  router.get("/:id/tape", async (c) => {
    const runId = parseRunId(c.req.param("id"));
    if (!runId) {
      return jsonError(c, 400, "run id must be 32 bytes of hex", { code: "bad_run_id" });
    }
    const run = (await findRun(c.env, runId))?.run ?? (await indexedRun(c, runId));
    if (!run || run.status !== "confirmed") {
      return jsonError(c, 404, "no confirmed run with this id", { code: "not_found" });
    }
    const tape = await getTape(c.env, runId);
    if (!tape) {
      return jsonError(c, 404, "tape is not stored here", { code: "tape_missing" });
    }
    return new Response(tape, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="kalien-${run.score}-${runId.slice(0, 12)}.tape"`,
        "cache-control": TAPE_CACHE_CONTROL,
      },
    });
  });

  return router;
}
