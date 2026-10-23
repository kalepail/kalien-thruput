import type { WorkerEnv } from "../env";
import { laneCount, laneForRun, laneObjectName } from "./lanes";
import type { RunView } from "./view";

export function relayLane(env: WorkerEnv, lane: number) {
  return env.RELAY.get(env.RELAY.idFromName(laneObjectName(lane)));
}

export function allLanes(env: WorkerEnv): number[] {
  return Array.from({ length: laneCount(env) }, (_, lane) => lane);
}

/** The lane that owns a run, by its id. */
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
