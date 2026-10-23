import { chainContext } from "../chain/context";
import type { WorkerEnv } from "../env";
import { parseBoolean, parseInteger } from "../utils";
import { syncScoreEvents, type SyncResult } from "./indexer";

const DEFAULT_MAX_PAGES = 10;
const PAGE_LIMIT = 200;

export async function runLeaderboardSync(env: WorkerEnv): Promise<SyncResult | null> {
  if (!parseBoolean(env.LEADERBOARD_SYNC_ENABLED, true)) {
    return null;
  }
  const chain = await chainContext(env);
  return syncScoreEvents(env, chain.score, chain, {
    maxPages: parseInteger(env.LEADERBOARD_SYNC_MAX_PAGES, DEFAULT_MAX_PAGES),
    pageLimit: PAGE_LIMIT,
  });
}
