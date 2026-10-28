import type { ChainContext } from "./chain/context";
import { SEED_ACTIVE_EPOCHS, SEED_EPOCH_SECONDS } from "./constants";
import deployment from "../shared/thruput/deployments/futurenet.json";
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

/**
 * Epochs the Worker refuses: BLOCKED_SEED_IDS (comma-separated) plus the
 * deploy record's `fixtureSeedIds`. Fixture epochs have seeds the admin set
 * to match public tapes, so a valid claim needs no play.
 */
export function blockedSeedIds(env: Pick<WorkerEnv, "BLOCKED_SEED_IDS">): Set<number> {
  const out = new Set<number>();
  const fromRecord = (deployment as { fixtureSeedIds?: unknown }).fixtureSeedIds;
  if (Array.isArray(fromRecord)) {
    for (const id of fromRecord) {
      if (Number.isSafeInteger(id)) out.add(id as number);
    }
  }
  for (const part of (env.BLOCKED_SEED_IDS ?? "").split(/[\s,]+/u)) {
    if (/^\d{1,10}$/u.test(part)) out.add(Number(part));
  }
  return out;
}
