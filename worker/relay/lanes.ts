import type { WorkerEnv } from "../env";
import { hexToBytes } from "../hex";

/**
 * Relay lanes. Each lane is one relay key and one RelayDO per score contract
 * (`relay-<contract prefix>-<lane>`), so a redeployed contract starts with
 * empty journals.
 * RELAY_SECRETS is a comma-separated list of 32-byte Ed25519 seeds (hex);
 * lane i signs with entry i. Keep the order stable: a lane's journal holds
 * transactions signed by its key.
 */
export function relaySecrets(env: Pick<WorkerEnv, "RELAY_SECRETS">): Uint8Array[] {
  const entries = (env.RELAY_SECRETS ?? "")
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("RELAY_SECRETS is not configured");
  }
  return entries.map((entry, lane) => {
    if (!/^(?:0x)?[0-9a-f]{64}$/iu.test(entry)) {
      throw new Error(`RELAY_SECRETS entry ${lane} must be a 32-byte hex Ed25519 seed`);
    }
    return hexToBytes(entry);
  });
}

/** Lane count; 1 when RELAY_SECRETS is missing, so reads still work. */
export function laneCount(env: Pick<WorkerEnv, "RELAY_SECRETS">): number {
  try {
    return relaySecrets(env).length;
  } catch {
    return 1;
  }
}

/** Stable lane for a run id (hex tape hash): the same run always maps to one lane. */
export function laneForRun(runId: string, lanes: number): number {
  return Number.parseInt(runId.slice(0, 8), 16) % lanes;
}

export function laneObjectName(lane: number, scoreContract: string): string {
  return `relay-${scoreContract.replace(/^0x/iu, "").slice(0, 16)}-${lane}`;
}
