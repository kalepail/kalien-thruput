import type { WorkerEnv } from "../env";
import { DEFAULT_RELAY_POLICY, type RelayPolicy } from "./engine";

function bigintVar(raw: string | undefined, fallback: bigint): bigint {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`invalid integer: ${trimmed}`);
  }
  return BigInt(trimmed);
}

function intVar(raw: string | undefined, fallback: number): number {
  const value = Number(bigintVar(raw, BigInt(fallback)));
  return value >= 1 ? value : fallback;
}

export function relayPolicy(env: WorkerEnv): RelayPolicy {
  const base = DEFAULT_RELAY_POLICY;
  return {
    ...base,
    gasBase: bigintVar(env.RELAY_GAS_BASE, base.gasBase),
    gasPerFrame: bigintVar(env.RELAY_GAS_PER_FRAME, base.gasPerFrame),
    gasMax: bigintVar(env.RELAY_GAS_MAX, base.gasMax),
    gasRetryMax: bigintVar(env.RELAY_GAS_RETRY_MAX, base.gasRetryMax),
    walletGasOverhead: bigintVar(env.RELAY_WALLET_GAS_OVERHEAD, base.walletGasOverhead),
    seedTouchGas: bigintVar(env.RELAY_SEED_GAS, base.seedTouchGas),
    expiryBlocks: bigintVar(env.RELAY_EXPIRY_BLOCKS, base.expiryBlocks),
    maxInFlight: intVar(env.RELAY_MAX_IN_FLIGHT, base.maxInFlight),
  };
}
