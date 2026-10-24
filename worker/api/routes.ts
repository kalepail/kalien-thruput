import { Hono } from "hono";
import { chainContext } from "../chain/context";
import { chainSettings } from "../chain/network";
import { CONFIG_CACHE_CONTROL, HEALTH_CACHE_CONTROL, SEED_CACHE_CONTROL } from "../cache-control";
import { getIndexerState } from "../leaderboard/store";
import { resetIndexer } from "../leaderboard/indexer";
import { runLeaderboardSync } from "../leaderboard/sync";
import type { RunStatus } from "../relay/store";
import { allLanes, allowedLanes, findRun, relayLane } from "../relay/stub";
import { currentSeedId, lookupSeed, secondsLeftInEpoch } from "../seed";
import { safeErrorMessage } from "../utils";
import { isAdmin, jsonError, type AppEnv } from "./http";
import { createLeaderboardRouter } from "./leaderboard";
import { createRunsRouter } from "./runs";

const HEALTH_TTL_MS = 15_000;
let healthCache: { at: number; body: unknown } | null = null;

export function createApiRouter(): Hono<AppEnv> {
  const api = new Hono<AppEnv>();

  // GET /api/config — network and contracts for browser and CLI.
  api.get("/config", async (c) => {
    let settings: ReturnType<typeof chainSettings>;
    try {
      settings = chainSettings(c.env);
    } catch (error) {
      return jsonError(c, 500, safeErrorMessage(error));
    }
    let networkHash = settings.networkHash;
    if (!networkHash) {
      try {
        networkHash = (await chainContext(c.env)).networkHash;
      } catch (error) {
        return jsonError(c, 503, `chain is not available: ${safeErrorMessage(error)}`);
      }
    }
    c.header("Cache-Control", CONFIG_CACHE_CONTROL);
    return c.json({
      success: true,
      networkHash,
      rpcUrl: settings.rpcUrl,
      scoreContract: settings.scoreContract,
      tokenContract: settings.tokenContract,
      explorerUrl: settings.explorerUrl,
    });
  });

  // GET /api/seed/current
  api.get("/seed/current", async (c) => {
    const now = Date.now();
    const seedId = currentSeedId(now);
    let seed: number | null;
    try {
      seed = await lookupSeed(c.env, await chainContext(c.env), seedId);
    } catch (error) {
      return jsonError(c, 503, `chain is not available: ${safeErrorMessage(error)}`);
    }
    if (seed === null) {
      // Ask the relay to create it; the client polls until it exists.
      c.executionCtx.waitUntil(
        relayLane(c.env, 0)
          .touchSeed(0, seedId)
          .catch((error: unknown) => {
            console.warn(`[seed] touch failed: ${safeErrorMessage(error)}`);
          }),
      );
    }
    c.header("Cache-Control", seed === null ? "no-store" : SEED_CACHE_CONTROL);
    return c.json({
      success: true,
      seedId,
      seed,
      indexed: seed !== null,
      secondsLeft: secondsLeftInEpoch(now),
    });
  });

  // GET /api/health
  // GET /api/health — public: cached per isolate for 15 s and never kicks the
  // relay. With the admin key: fresh, and it re-arms lanes that have work.
  api.get("/health", async (c) => {
    const admin = isAdmin(c);
    const now = Date.now();
    if (!admin && healthCache && now - healthCache.at < HEALTH_TTL_MS) {
      c.header("Cache-Control", HEALTH_CACHE_CONTROL);
      return c.json(healthCache.body);
    }
    const allowed = await chainContext(c.env)
      .then((chain) => allowedLanes(c.env, chain.score))
      .catch(() => null);
    const [lanes, indexer] = await Promise.all([
      Promise.all(
        allLanes(c.env).map((lane) =>
          relayLane(c.env, lane)
            .status(lane, admin)
            .then((status) => ({ lane, allowed: allowed?.includes(lane) ?? null, ...status }))
            .catch((error: unknown) => ({ lane, error: safeErrorMessage(error) })),
        ),
      ),
      getIndexerState(c.env).catch(() => null),
    ]);
    const body = { success: true, lanes, indexer };
    if (!admin) {
      healthCache = { at: now, body };
    }
    c.header("Cache-Control", admin ? "no-store" : HEALTH_CACHE_CONTROL);
    return c.json(body);
  });

  // Admin routes need `Authorization: Bearer <DEV_API_KEY>`.
  api.post("/admin/sync", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    try {
      return c.json({ success: true, result: await runLeaderboardSync(c.env) });
    } catch (error) {
      return jsonError(c, 502, safeErrorMessage(error));
    }
  });

  // GET /api/admin/runs?status=failed,rejected&limit=50 — recent problem runs, all lanes.
  api.get("/admin/runs", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    const known = new Set(["queued", "submitting", "confirmed", "rejected", "failed", "unknown"]);
    const statuses = (c.req.query("status") ?? "failed,rejected,unknown")
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is RunStatus => known.has(value));
    const limitRaw = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
    const pages = await Promise.all(
      allLanes(c.env).map(async (lane) =>
        (await relayLane(c.env, lane).runsByStatus(lane, statuses, limit)).map((run) => ({
          lane,
          ...run,
        })),
      ),
    );
    const merged = pages.flat();
    // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
    merged.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const runs = merged.slice(0, limit);
    c.header("Cache-Control", "no-store");
    return c.json({ success: true, statuses, runs });
  });

  // POST /api/admin/runs/:id/retry — queue a failed (not final) or a provably
  // dead `unknown` run again in its lane.
  api.post("/admin/runs/:id/retry", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    const runId = c.req.param("id").trim().toLowerCase().replace(/^0x/u, "");
    const found = /^[0-9a-f]{64}$/u.test(runId) ? await findRun(c.env, runId) : null;
    if (!found) {
      return jsonError(c, 404, "run not found");
    }
    const result = await relayLane(c.env, found.lane).retryRun(found.lane, runId);
    if ("refused" in result) {
      return jsonError(c, 409, result.refused);
    }
    return c.json({ success: true, lane: found.lane, ...result.run });
  });

  // POST /api/admin/indexer/reset?fromHeight=N — recover from a bad cursor or a
  // history gap. Rows dedupe, so re-reading a range is safe.
  api.post("/admin/indexer/reset", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    const raw = c.req.query("fromHeight") ?? "";
    if (!/^\d{1,19}$/u.test(raw)) {
      return jsonError(c, 400, "fromHeight must be a block height");
    }
    try {
      const chain = await chainContext(c.env);
      return c.json({
        success: true,
        state: await resetIndexer(c.env, chain.score.address, BigInt(raw)),
      });
    } catch (error) {
      return jsonError(c, 502, safeErrorMessage(error));
    }
  });

  api.post("/admin/seed/touch", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    try {
      const seedId = currentSeedId();
      return c.json({ success: true, seedId, ...(await relayLane(c.env, 0).touchSeed(0, seedId)) });
    } catch (error) {
      return jsonError(c, 502, safeErrorMessage(error));
    }
  });

  api.route("/runs", createRunsRouter());
  api.route("/leaderboard", createLeaderboardRouter());

  api.notFound((c) => jsonError(c, 404, `unknown api route: ${c.req.path}`));

  return api;
}
