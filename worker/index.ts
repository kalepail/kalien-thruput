import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createApiRouter } from "./api/routes";
import { applyApiCacheControl } from "./cache-control";
import type { WorkerEnv } from "./env";
import { runLeaderboardSync } from "./leaderboard/sync";
import { relayStub } from "./relay/stub";
import { currentSeedId } from "./seed";
import { safeErrorMessage } from "./utils";

export { RelayDO } from "./durable/relay";

const app = new Hono<{ Bindings: WorkerEnv }>();
const LEADERBOARD_SYNC_CRON = "*/1 * * * *";
const SEED_TOUCH_CRON = "*/10 * * * *";

app.use("/api/*", async (c, next) => {
  await next();
  c.res = applyApiCacheControl(c.res);
});

app.route("/api", createApiRouter());

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const response = error.getResponse();
    return c.req.path.startsWith("/api/") ? applyApiCacheControl(response) : response;
  }

  console.error(`[worker] ${safeErrorMessage(error)}`);

  if (c.req.path.startsWith("/api/")) {
    return c.json({ success: false, error: "internal server error" }, 500);
  }

  return new Response("Internal Server Error", { status: 500 });
});

async function touchCurrentSeed(env: WorkerEnv): Promise<void> {
  // Touch the current epoch so its seed exists before players ask for it.
  // A touch near the epoch end also creates the next one early.
  const seedId = currentSeedId();
  const result = await relayStub(env).touchSeed(seedId);
  console.log(
    `[seed] epoch ${seedId}: ${result.seed !== null ? `seed ${result.seed}` : `touch ${result.txHash}`}`,
  );
}

export default {
  fetch(request: Request, env: WorkerEnv, executionCtx: ExecutionContext) {
    return app.fetch(request, env, executionCtx);
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv): Promise<void> {
    const cron = controller.cron ?? null;
    if (cron === null || cron === SEED_TOUCH_CRON) {
      await touchCurrentSeed(env).catch((error: unknown) => {
        console.warn(`[seed] touch failed: ${safeErrorMessage(error)}`);
      });
    }
    if (cron === null || cron === LEADERBOARD_SYNC_CRON) {
      const result = await runLeaderboardSync(env).catch((error: unknown) => {
        console.error(`[leaderboard-sync] failed: ${safeErrorMessage(error)}`);
        return null;
      });
      if (result?.warning) {
        console.warn(`[leaderboard-sync] ${result.warning}`);
      }
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
