import { chainSettings } from "../chain/network";
import type { WorkerEnv } from "../env";
import { relayAddress } from "../chain/relay-wallet";
import type { ScoreContract } from "../chain/score-contract";
import { laneCount, laneForRun, laneObjectName, relaySecrets } from "./lanes";
import type { RunView } from "./view";

export function relayLane(env: WorkerEnv, lane: number) {
  const contract = chainSettings(env).scoreContract ?? "none";
  return env.RELAY.get(env.RELAY.idFromName(laneObjectName(lane, contract)));
}

export function allLanes(env: WorkerEnv): number[] {
  return Array.from({ length: laneCount(env) }, (_, lane) => lane);
}

/** The lane a run maps to over all lanes (where lookups look first). */
export function laneOf(env: WorkerEnv, runId: string): number {
  return laneForRun(runId, laneCount(env));
}

/**
 * Finds a run in its own lane, then in the others (the lane count may have
 * changed since the run was queued).
 */
export async function findRun(
  env: WorkerEnv,
  runId: string,
): Promise<{ lane: number; run: RunView } | null> {
  const home = laneOf(env, runId);
  const homeRun = await relayLane(env, home).getRun(home, runId);
  if (homeRun) {
    return { lane: home, run: homeRun };
  }
  const others = allLanes(env).filter((lane) => lane !== home);
  const found = await Promise.all(
    others.map(async (lane) => ({ lane, run: await relayLane(env, lane).getRun(lane, runId) })),
  );
  const hit = found.find((entry) => entry.run !== null);
  return hit?.run ? { lane: hit.lane, run: hit.run } : null;
}

const ALLOWLIST_TTL_MS = 60_000;
const allowlistCache = new Map<string, { at: number; lanes: number[] }>();

/**
 * Lanes whose relay key is on the contract's allowlist (cached for a minute).
 * New runs go only to these, so a key that is not allowed cannot waste them.
 * If none is allowed (or relay-only is off and nothing is listed), all lanes
 * stay in use and the contract decides.
 */
export async function allowedLanes(env: WorkerEnv, score: ScoreContract): Promise<number[]> {
  const lanes = allLanes(env);
  const key = `${score.address}|${env.RELAY_SECRETS ?? ""}`.slice(0, 120);
  const cached = allowlistCache.get(key);
  if (cached && Date.now() - cached.at < ALLOWLIST_TTL_MS) {
    return cached.lanes;
  }
  let addresses: string[];
  try {
    addresses = relaySecrets(env).map(relayAddress);
  } catch {
    return lanes;
  }
  const flags = await Promise.all(
    addresses.map((address) => score.isRelay(address).catch(() => false)),
  );
  const allowed = lanes.filter((lane) => flags[lane]);
  const result = allowed.length > 0 ? allowed : lanes;
  allowlistCache.set(key, { at: Date.now(), lanes: result });
  return result;
}

/** The lane a new run goes to: stable for a run id over the allowed lanes. */
export function pickLane(runId: string, lanes: number[]): number {
  return lanes[laneForRun(runId, lanes.length)] ?? 0;
}

/** Test hook: forget cached allowlist answers. */
export function resetAllowlistCache(): void {
  allowlistCache.clear();
}
