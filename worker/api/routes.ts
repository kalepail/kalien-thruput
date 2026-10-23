import { Hono } from "hono";
import { chainContext } from "../chain/context";
import { chainSettings } from "../chain/network";
import { CONFIG_CACHE_CONTROL, HEALTH_CACHE_CONTROL, SEED_CACHE_CONTROL } from "../cache-control";
import { getIndexerState } from "../leaderboard/store";
import { runLeaderboardSync } from "../leaderboard/sync";
import { relayStub } from "../relay/stub";
import { currentSeedId, lookupSeed, secondsLeftInEpoch } from "../seed";
import { safeErrorMessage } from "../utils";
import { isAdmin, jsonError, type AppEnv } from "./http";
import { createLeaderboardRouter } from "./leaderboard";
import { createRunsRouter } from "./runs";

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
        relayStub(c.env)
          .touchSeed(seedId)
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
  api.get("/health", async (c) => {
    const [relay, indexer] = await Promise.all([
      relayStub(c.env)
        .status()
        .catch((error: unknown) => ({ error: safeErrorMessage(error) })),
      getIndexerState(c.env).catch(() => null),
    ]);
    c.header("Cache-Control", HEALTH_CACHE_CONTROL);
    return c.json({ success: true, relay, indexer });
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

  api.post("/admin/seed/touch", async (c) => {
    if (!isAdmin(c)) {
      return jsonError(c, 404, "not found");
    }
    try {
      const seedId = currentSeedId();
      return c.json({ success: true, seedId, ...(await relayStub(c.env).touchSeed(seedId)) });
    } catch (error) {
      return jsonError(c, 502, safeErrorMessage(error));
    }
  });

  api.route("/runs", createRunsRouter());
  api.route("/leaderboard", createLeaderboardRouter());

  api.notFound((c) => jsonError(c, 404, `unknown api route: ${c.req.path}`));

  return api;
}
