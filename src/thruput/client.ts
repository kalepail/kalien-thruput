// Read-only Thruput client for browser views (KALIEN balance, best score, transactions).
// Loaded lazily so the game route does not pay for the SDK up front.

import {
  connectKalien,
  getBestScore,
  getKalienBalance,
  type KalienClient,
} from "../../shared/thruput/kalien";
import { getThruputConfig, onThruputConfigChange, type ThruputConfig } from "./config";

let clientPromise: Promise<{ client: KalienClient; config: ThruputConfig }> | null = null;

// The client pins the network hash; after a Futurenet reset make a new one.
onThruputConfigChange(() => {
  clientPromise = null;
});

/** One client per page, pinned to the network hash from `/api/config`. */
export function getThruputClient(): Promise<{ client: KalienClient; config: ThruputConfig }> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await getThruputConfig();
      const client = await connectKalien(config);
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
): Promise<{ balance: bigint; tokenContract: string }> {
  const { client, config } = await getThruputClient();
  return {
    balance: await getKalienBalance(client, config, address),
    tokenContract: config.tokenContract,
  };
}

/** The player's best score on one seed epoch, read from the score contract. */
export async function readBestScore(address: string, seedId: number): Promise<number> {
  const { client, config } = await getThruputClient();
  return getBestScore(client, config, address, seedId >>> 0);
}
