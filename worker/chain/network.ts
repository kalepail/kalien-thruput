import {
  createThruputClient,
  defineCluster,
  HttpTransport,
  networkHash as toNetworkHash,
  sha256Hash,
  toBase58,
  type Cluster,
  type ConnectedThruputClient,
} from "@thruputchain/client";
// The Futurenet deployment record from kt-contract. A redeploy updates this file;
// a Worker build then picks it up. Non-empty env vars override each field.
import deployment from "../../shared/thruput/deployments/futurenet.json";
import type { WorkerEnv } from "../env";
import { normalizeId, parseId32 } from "../ids";

export const DEFAULT_RPC_URL = deployment.rpcUrl || "https://rpc.thruput.network";
export const DEFAULT_EXPLORER_URL = (
  deployment.explorerUrl || "https://explorer.thruput.network"
).replace(/\/+$/u, "");
const RPC_TIMEOUT_MS = 15_000;

export interface ChainSettings {
  rpcUrl: string;
  /** Pinned network hash (base58), or null to accept the RPC's identity. */
  networkHash: string | null;
  scoreContract: string | null;
  tokenContract: string | null;
  explorerUrl: string;
}

/** A 32-byte id from config (base58 or hex) as base58, or null when unset. */
function optionalId(raw: string | undefined, name: string): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const id = normalizeId(raw);
  if (!id) {
    throw new Error(`${name} must be a 32-byte id (base58 or hex)`);
  }
  return id;
}

export function chainSettings(env: WorkerEnv): ChainSettings {
  // An RPC override (for example a local node) drops the Futurenet defaults, so
  // Futurenet addresses are never used against another chain.
  const rpcOverride = env.THRUPUT_RPC_URL?.trim();
  const useDeployment = !rpcOverride || rpcOverride === deployment.rpcUrl;
  const pick = (value: string | undefined, fallback: string) =>
    value?.trim() || (useDeployment ? fallback : "");
  return {
    rpcUrl: rpcOverride || DEFAULT_RPC_URL,
    networkHash: optionalId(
      pick(env.THRUPUT_NETWORK_HASH, deployment.networkHash),
      "THRUPUT_NETWORK_HASH",
    ),
    scoreContract: optionalId(pick(env.SCORE_CONTRACT, deployment.scoreContract), "SCORE_CONTRACT"),
    tokenContract: optionalId(pick(env.TOKEN_CONTRACT, deployment.tokenContract), "TOKEN_CONTRACT"),
    explorerUrl: env.EXPLORER_URL?.trim() || DEFAULT_EXPLORER_URL,
  };
}

function cluster(settings: ChainSettings): Cluster<readonly ["airdrop"]> {
  return defineCluster({
    name: "kalien",
    rpcUrl: settings.rpcUrl,
    ...(settings.networkHash
      ? {
          networkHash: toNetworkHash(
            sha256Hash(parseId32(settings.networkHash) ?? new Uint8Array()),
          ),
        }
      : {}),
    capabilities: ["airdrop"] as const,
  });
}

export type ChainClient = ConnectedThruputClient<Cluster<readonly ["airdrop"]>>;

const clients = new Map<string, Promise<ChainClient>>();

/**
 * One connected client per isolate and settings. The client fetches the
 * network identity and checks it against THRUPUT_NETWORK_HASH when that is set.
 */
export function chainClient(settings: ChainSettings): Promise<ChainClient> {
  const key = `${settings.rpcUrl}|${settings.networkHash ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = createThruputClient({
      cluster: cluster(settings),
      transport: new HttpTransport(settings.rpcUrl, {
        timeoutMs: RPC_TIMEOUT_MS,
        fetch: (input, init) => fetch(input, init),
      }),
    }).catch((error: unknown) => {
      clients.delete(key);
      throw error;
    });
    clients.set(key, client);
  }
  return client;
}

export function clientNetworkHash(client: ChainClient): string {
  return toBase58(client.network.networkHash);
}
