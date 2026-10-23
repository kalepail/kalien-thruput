// Runtime Thruput network config, served by the Worker at `/api/config`.
// Devnet resets change the network hash and contract addresses, so the browser
// never hard-codes them; it reads them once per page load.

import { fetchWithTimeout } from "@/lib/api";
import { DEFAULT_EXPLORER_URL, DEFAULT_THRUPUT_RPC_URL } from "@/consts";
import { strip0x, with0x } from "@/lib/hex";

export interface ThruputConfig {
  /** Network hash, `0x`-prefixed lowercase hex. */
  networkHash: string;
  rpcUrl: string;
  /** Score contract address, `0x`-prefixed lowercase hex. */
  scoreContract: string;
  /** KALIEN token contract address, `0x`-prefixed lowercase hex. */
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
  const networkHash = readString(record, "networkHash", "network_hash");
  const scoreContract = readString(record, "scoreContract", "score_contract");
  const tokenContract = readString(record, "tokenContract", "token_contract");
  if (!networkHash || !scoreContract || !tokenContract) {
    throw new Error("config response is missing networkHash, scoreContract, or tokenContract");
  }
  const explorerUrl = readString(record, "explorerUrl", "explorer_url") ?? DEFAULT_EXPLORER_URL;
  return {
    networkHash: with0x(strip0x(networkHash)),
    rpcUrl: readString(record, "rpcUrl", "rpc_url") ?? DEFAULT_THRUPUT_RPC_URL,
    scoreContract: with0x(strip0x(scoreContract)),
    tokenContract: with0x(strip0x(tokenContract)),
    explorerUrl: explorerUrl.replace(/\/+$/, ""),
  };
}

export function getThruputConfig(): Promise<ThruputConfig> {
  if (!configPromise) {
    configPromise = (async () => {
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
    })().catch((error: unknown) => {
      // Allow a later call to retry after a transient failure.
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
}

export function explorerTxUrl(explorerUrl: string, txHash: string): string {
  return `${explorerUrl}/tx/${with0x(txHash)}`;
}

export function explorerAddressUrl(explorerUrl: string, address: string): string {
  return `${explorerUrl}/address/${with0x(address)}`;
}
