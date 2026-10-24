import type { ChainClient } from "./network";

const NANOS_PER_MS = 1_000_000n;
const CACHE_LIMIT = 256;

/** Block time in ms from `getBlockByHeight`. Throws when the block is unknown. */
export function blockTimeReader(client: ChainClient): (height: bigint) => Promise<number> {
  const cache = new Map<bigint, number>();
  return async (height) => {
    const cached = cache.get(height);
    if (cached !== undefined) {
      return cached;
    }
    const block = await client.getBlockByHeight({ blockHeight: height });
    if (!block) {
      throw new Error(`block ${height} is not indexed`);
    }
    const ms = Number(block.blockTimepoint / NANOS_PER_MS);
    if (cache.size >= CACHE_LIMIT) {
      cache.clear();
    }
    cache.set(height, ms);
    return ms;
  };
}
