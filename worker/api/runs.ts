import { Hono } from "hono";
import { claimMessage, pubkeyAccountAddress, verifyEd25519 } from "../claim";
import { chainContext } from "../chain/context";
import { MAX_TAPE_BYTES } from "../constants";
import { bytesToHex, parseFixedHex, sha256 } from "../hex";
import { replayTape } from "../replay";
import { relayStub } from "../relay/stub";
import type { RunView } from "../relay/view";
import { isSeedIdActive, lookupSeed } from "../seed";
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
  jsonError,
  normalizeAddress,
  RateLimiter,
  rateLimited,
  type AppContext,
  type AppEnv,
} from "./http";

const RUN_ID_PATTERN = /^[0-9a-f]{64}$/u;
const SUBMIT_LIMIT_PER_WINDOW = 30;
const SUBMIT_WINDOW_MS = 10 * 60_000;
const READ_LIMIT_PER_MINUTE = 240;

const submitByIp = new RateLimiter(SUBMIT_LIMIT_PER_WINDOW, SUBMIT_WINDOW_MS);
const submitByPlayer = new RateLimiter(SUBMIT_LIMIT_PER_WINDOW, SUBMIT_WINDOW_MS);
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

    const pubkeyHex = bytesToHex(pubkey);
    const retryIp = submitByIp.take(clientIp(c));
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
    const relay = relayStub(c.env);
    const existing = await relay.getRun(runId);
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

    const playerAddress = pubkeyAccountAddress(pubkey);
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

    await putTape(c.env, runId, tape);
    const { run } = await relay.submitRun({
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
    const runs = await relayStub(c.env).listRuns(player, limit);
    c.header("Cache-Control", RUN_STATUS_CACHE_CONTROL);
    return c.json({ success: true, player, runs });
  });

  // GET /api/runs/:id
  router.get("/:id", async (c) => {
    const retry = readByIp.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const runId = c.req.param("id").toLowerCase();
    if (!RUN_ID_PATTERN.test(runId)) {
      return jsonError(c, 400, "run id must be 32 bytes of hex", { code: "bad_run_id" });
    }
    const run = (await relayStub(c.env).getRun(runId)) ?? (await indexedRun(c, runId));
    if (!run) {
      return jsonError(c, 404, "run not found", { code: "not_found" });
    }
    return runResponse(c, run);
  });

  // GET /api/runs/:id/tape — only for confirmed runs, so a pending tape cannot be front-run.
  router.get("/:id/tape", async (c) => {
    const runId = c.req.param("id").toLowerCase();
    if (!RUN_ID_PATTERN.test(runId)) {
      return jsonError(c, 400, "run id must be 32 bytes of hex", { code: "bad_run_id" });
    }
    const run = (await relayStub(c.env).getRun(runId)) ?? (await indexedRun(c, runId));
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
