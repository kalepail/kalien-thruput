// Runtime Thruput network config, served by the Worker at `/api/config`.
// Futurenet resets change the network hash and contract addresses, so the browser
// never hard-codes them; it reads them once per page load.

import { fetchWithTimeout } from "@/lib/api";
import { DEFAULT_EXPLORER_URL, DEFAULT_THRUPUT_RPC_URL } from "@/consts";
import { toCanonicalId } from "./ids";

export interface ThruputConfig {
  /** Network hash, base58. */
  networkHash: string;
  rpcUrl: string;
  /** Score contract address, base58. */
  scoreContract: string;
  /** KALIEN token contract address, base58. */
  tokenContract: string;
  /** Explorer base URL without a trailing slash. */
  explorerUrl: string;
}

const CONFIG_TIMEOUT_MS = 10_000;

let configPromise: Promise<ThruputConfig> | null = null;

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function parseThruputConfig(payload: unknown): ThruputConfig {
  if (!payload || typeof payload !== "object") {
    throw new Error("config response is not an object");
  }
  const record = payload as Record<string, unknown>;
  const networkHash = toCanonicalId(readString(record, "networkHash", "network_hash"));
  const scoreContract = toCanonicalId(readString(record, "scoreContract", "score_contract"));
  const tokenContract = toCanonicalId(readString(record, "tokenContract", "token_contract"));
  if (!networkHash || !scoreContract || !tokenContract) {
    throw new Error("config response needs 32-byte networkHash, scoreContract, and tokenContract");
  }
  const explorerUrl = readString(record, "explorerUrl", "explorer_url") ?? DEFAULT_EXPLORER_URL;
  return {
    networkHash,
    rpcUrl: readString(record, "rpcUrl", "rpc_url") ?? DEFAULT_THRUPUT_RPC_URL,
    scoreContract,
    tokenContract,
    explorerUrl: explorerUrl.replace(/\/+$/, ""),
  };
}

async function fetchThruputConfig(): Promise<ThruputConfig> {
  const response = await fetchWithTimeout(
    "/api/config",
    { method: "GET", cache: "no-store" },
    CONFIG_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`failed to load network config (${response.status})`);
  }
  const config = parseThruputConfig(await response.json());
  // Dev only: reach a local node through the Vite `/rpc` proxy (see vite.config.ts).
  if (typeof __KALIEN_RPC_PROXY__ !== "undefined" && __KALIEN_RPC_PROXY__) {
    config.rpcUrl = new URL("/rpc", window.location.origin).href;
  }
  return config;
}

// The last config this page saw. A Futurenet reset changes the network hash and
// the contracts; an open tab must notice, or it signs for the old network.
let currentConfig: ThruputConfig | null = null;
const changeListeners = new Set<(config: ThruputConfig) => void>();

/** Network hash plus contracts: what a Futurenet reset changes. */
export function configIdentity(config: ThruputConfig): string {
  return `${config.networkHash}|${config.scoreContract}|${config.tokenContract}`;
}

export function getThruputConfig(): Promise<ThruputConfig> {
  if (!configPromise) {
    configPromise = fetchThruputConfig()
      .then((config) => {
        currentConfig = config;
        return config;
      })
      .catch((error: unknown) => {
        // Allow a later call to retry after a transient failure.
        configPromise = null;
        throw error;
      });
  }
  return configPromise;
}

/**
 * Fetch the config again. When the network identity changed, replace the
 * cached config and tell every subscriber (client, seed cache, balance, UI).
 * Returns true when it changed.
 */
export async function refreshThruputConfig(): Promise<boolean> {
  const previous = currentConfig;
  const next = await fetchThruputConfig();
  const changed = previous !== null && configIdentity(previous) !== configIdentity(next);
  currentConfig = next;
  configPromise = Promise.resolve(next);
  if (changed) {
    for (const listener of changeListeners) {
      listener(next);
    }
  }
  return changed;
}

/** Called with the new config after a network change (not on the first load). */
export function onThruputConfigChange(listener: (config: ThruputConfig) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Test hook: forget the cached config (subscribers stay). */
export function resetThruputConfigForTests(): void {
  configPromise = null;
  currentConfig = null;
}

export function explorerTxUrl(explorerUrl: string, txHash: string): string {
  return `${explorerUrl}/tx/${encodeURIComponent(toCanonicalId(txHash) ?? txHash)}`;
}

export function explorerAddressUrl(explorerUrl: string, address: string): string {
  return `${explorerUrl}/address/${encodeURIComponent(toCanonicalId(address) ?? address)}`;
}
