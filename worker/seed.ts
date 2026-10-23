import type { ChainContext } from "./chain/context";
import { SEED_ACTIVE_EPOCHS, SEED_EPOCH_SECONDS } from "./constants";
import type { WorkerEnv } from "./env";
import { getSeed, recordSeed } from "./leaderboard/store";

export function currentSeedId(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / SEED_EPOCH_SECONDS);
}

export function secondsLeftInEpoch(nowMs = Date.now()): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  return SEED_EPOCH_SECONDS - (nowSeconds % SEED_EPOCH_SECONDS);
}

/**
 * The contract accepts the current epoch and the previous 143. The Worker
 * clock can differ from block time a little, so allow one epoch ahead too;
 * the contract makes the final check.
 */
export function isSeedIdActive(seedId: number, nowMs = Date.now()): boolean {
  const current = currentSeedId(nowMs);
  return seedId <= current + 1 && seedId > current - SEED_ACTIVE_EPOCHS;
}

/** Stored seed for an epoch: D1 cache first, then the contract. */
export async function lookupSeed(
  env: WorkerEnv,
  chain: ChainContext,
  seedId: number,
): Promise<number | null> {
  const cached = await getSeed(env, seedId);
  if (cached !== null) {
    return cached;
  }
  const seed = await chain.score.seedFor(seedId);
  if (seed !== null) {
    await recordSeed(env, seedId, seed);
  }
  return seed;
}
