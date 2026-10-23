import { listRuns } from "./api";

const BEST_SCAN_LIMIT = 100;

type ClientModule = typeof import("../thruput/client");

let clientModulePromise: Promise<ClientModule> | null = null;

function loadClientModule(): Promise<ClientModule> {
  if (!clientModulePromise) {
    clientModulePromise = import("../thruput/client");
  }
  return clientModulePromise;
}

/** Best confirmed score in the Worker run history (covers runs sent through this Worker). */
async function bestFromRunHistory(player: string, seedId: number): Promise<number> {
  const page = await listRuns(player, { limit: BEST_SCAN_LIMIT });
  let best = 0;
  for (const run of page.runs) {
    if (run.status === "confirmed" && run.seedId === seedId >>> 0 && run.score !== null) {
      best = Math.max(best, run.score >>> 0);
    }
  }
  return best;
}

/**
 * Best score for a player on one seed epoch.
 *
 * Reads `best_score(player, seed_id)` from the score contract. When the RPC
 * view fails (for example, a local node without CORS), it falls back to the
 * Worker run history. Returns `null` when both fail, so callers can tell
 * "unknown" apart from "no score yet" (`0`).
 */
export async function fetchBestScoreForSeed(
  player: string,
  seedId: number,
): Promise<number | null> {
  try {
    const clientModule = await loadClientModule();
    return await clientModule.readBestScore(player, seedId);
  } catch {
    try {
      return await bestFromRunHistory(player, seedId);
    } catch {
      return null;
    }
  }
}
