// Read-only Thruput client for browser views (KALIEN balance).
// Loaded lazily so the game route does not pay for the SDK up front.

import {
  addressFromHex,
  createThruputClient,
  defineCluster,
  hashFromHex,
  networkHash,
  type CoreThruputClient,
} from "@thruputchain/client";
import { ERC20 } from "@thruputchain/client/contracts";
import { getThruputConfig, type ThruputConfig } from "./config";

let clientPromise: Promise<{ client: CoreThruputClient; config: ThruputConfig }> | null = null;

export function getThruputClient(): Promise<{ client: CoreThruputClient; config: ThruputConfig }> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await getThruputConfig();
      const client = await createThruputClient({
        cluster: defineCluster({
          name: "kalien-devnet",
          rpcUrl: config.rpcUrl,
          networkHash: networkHash(hashFromHex(config.networkHash)),
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
    contract: addressFromHex(config.tokenContract),
    args: { addr: addressFromHex(address) },
    signal,
  });
  return { balance: result.value, tokenContract: config.tokenContract };
}
