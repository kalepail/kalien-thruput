import { JsonRpcError, ThruputRpcErrorCode } from "@thruputchain/client";
import type { ChainClient } from "./network";

const NANOS_PER_MS = 1_000_000n;
const CACHE_LIMIT = 256;

/**
 * Block time in ms. Throws when the RPC cannot say; after a NOT_IMPLEMENTED
 * answer it stops asking for this client.
 */
export function blockTimeReader(client: ChainClient): (height: bigint) => Promise<number> {
  const cache = new Map<bigint, number>();
  let unsupported = false;
  return async (height) => {
    if (unsupported) {
      throw new Error("getBlockByNumber is not supported by this RPC");
    }
    const cached = cache.get(height);
    if (cached !== undefined) {
      return cached;
    }
    let block: Awaited<ReturnType<ChainClient["getBlockByNumber"]>>;
    try {
      block = await client.getBlockByNumber(height);
    } catch (error) {
      if (error instanceof JsonRpcError && error.code === ThruputRpcErrorCode.NotImplemented) {
        unsupported = true;
      }
      throw error;
    }
    if (!block) {
      throw new Error(`block ${height} not found`);
    }
    const ms = Number(block.blockTimepoint / NANOS_PER_MS);
    if (cache.size >= CACHE_LIMIT) {
      cache.clear();
    }
    cache.set(height, ms);
    return ms;
  };
}
