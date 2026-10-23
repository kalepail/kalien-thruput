import {
  createThruputClient,
  defineCluster,
  HttpTransport,
  networkHash as toNetworkHash,
  sha256Hash,
  toHex0x,
  type ConnectedThruputClient,
  type Cluster,
} from "@thruputchain/client";
import type { WorkerEnv } from "../env";
import { hexToBytes } from "../hex";

export const DEFAULT_RPC_URL = "https://rpc.thruput.network";
export const DEFAULT_EXPLORER_URL = "https://explorer.thruput.network";
const RPC_TIMEOUT_MS = 15_000;

export interface ChainSettings {
  rpcUrl: string;
  /** Pinned network hash (0x hex), or null to accept the RPC's identity. */
  networkHash: string | null;
  scoreContract: string | null;
  tokenContract: string | null;
  explorerUrl: string;
}

function optionalHex32(raw: string | undefined, name: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const bytes = hexToBytes(trimmed);
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes of hex`);
  }
  return toHex0x(bytes);
}

export function chainSettings(env: WorkerEnv): ChainSettings {
  return {
    rpcUrl: env.THRUPUT_RPC_URL?.trim() || DEFAULT_RPC_URL,
    networkHash: optionalHex32(env.THRUPUT_NETWORK_HASH, "THRUPUT_NETWORK_HASH"),
    scoreContract: optionalHex32(env.SCORE_CONTRACT, "SCORE_CONTRACT"),
    tokenContract: optionalHex32(env.TOKEN_CONTRACT, "TOKEN_CONTRACT"),
    explorerUrl: env.EXPLORER_URL?.trim() || DEFAULT_EXPLORER_URL,
  };
}

function cluster(settings: ChainSettings): Cluster<readonly ["airdrop"]> {
  return defineCluster({
    name: "kalien",
    rpcUrl: settings.rpcUrl,
    ...(settings.networkHash
      ? { networkHash: toNetworkHash(sha256Hash(hexToBytes(settings.networkHash))) }
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
  return toHex0x(client.network.networkHash);
}
