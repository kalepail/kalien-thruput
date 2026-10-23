import { listRuns } from "./api";

const BEST_SCAN_LIMIT = 100;

/**
 * Best confirmed score for a player on one seed epoch.
 *
 * Returns `null` when the lookup fails, so callers can tell "unknown" apart
 * from "no score yet" (`0`).
 *
 * TODO(thruput): read `best_score(player, seed_id)` from the score contract
 * through the generated binding once `shared/thruput/` lands. The Worker run
 * history is a stand-in: it only covers runs submitted through this Worker.
 */
export async function fetchBestScoreForSeed(
  player: string,
  seedId: number,
): Promise<number | null> {
  try {
    const page = await listRuns(player, { limit: BEST_SCAN_LIMIT });
    let best = 0;
    for (const run of page.runs) {
      if (run.status === "confirmed" && run.seedId === seedId >>> 0 && run.score !== null) {
        best = Math.max(best, run.score >>> 0);
      }
    }
    return best;
  } catch {
    return null;
  }
}
