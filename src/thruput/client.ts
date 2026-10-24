// Read-only Thruput client for browser views (KALIEN balance, best score).
// Loaded lazily so the game route does not pay for the SDK up front.

import {
  contractAddress,
  createThruputClient,
  defineCluster,
  networkHash,
  sha256Hash,
  type CoreThruputClient,
} from "@thruputchain/client";
import { KalienScore } from "../../shared/thruput/bindings/kalien-score";
import { ERC20 } from "../../shared/thruput/bindings/kalien-token";
import { getThruputConfig, type ThruputConfig } from "./config";
import { idBytes } from "./ids";

let clientPromise: Promise<{ client: CoreThruputClient; config: ThruputConfig }> | null = null;

export function getThruputClient(): Promise<{ client: CoreThruputClient; config: ThruputConfig }> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await getThruputConfig();
      const client = await createThruputClient({
        cluster: defineCluster({
          name: "kalien-devnet",
          rpcUrl: config.rpcUrl,
          networkHash: networkHash(sha256Hash(idBytes(config.networkHash))),
          capabilities: [],
        }),
      });
      return { client, config };
    })().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** KALIEN balance in base units (7 decimals) for a player address. */
export async function readKalienBalance(
  address: string,
  signal?: AbortSignal,
): Promise<{ balance: bigint; tokenContract: string }> {
  const { client, config } = await getThruputClient();
  const result = await ERC20.v0_1.getBalanceOf.view({
    client,
    address: contractAddress(idBytes(config.tokenContract)),
    args: { addr: contractAddress(idBytes(address)) },
    signal,
  });
  return { balance: result.value, tokenContract: config.tokenContract };
}

/** The player's best score on one seed epoch, read from the score contract. */
export async function readBestScore(
  address: string,
  seedId: number,
  signal?: AbortSignal,
): Promise<number> {
  const { client, config } = await getThruputClient();
  const result = await KalienScore.v0_1.bestScore.view({
    client,
    address: contractAddress(idBytes(config.scoreContract)),
    args: { player: contractAddress(idBytes(address)), seedId: BigInt(seedId >>> 0) },
    signal,
  });
  return Number(result.value);
}
