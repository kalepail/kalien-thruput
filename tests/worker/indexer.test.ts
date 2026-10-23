import { describe, expect, it } from "bun:test";
import type { WorkerEnv } from "../../worker/env";
import {
  estimateEventTimeMs,
  scoreEventRow,
  syncScoreEvents,
} from "../../worker/leaderboard/indexer";
import {
  countScoreEvents,
  getIndexerState,
  upsertScoreEvent,
} from "../../worker/leaderboard/store";
import { FakeChain } from "./helpers/fake-chain";
import { d1 } from "./helpers/sqlite";

function event(chain: FakeChain, index: number, height: bigint) {
  const e = {
    player: `0x${"ab".repeat(31)}${index.toString(16).padStart(2, "0")}`,
    seedId: 100,
    seed: 1,
    frameCount: 600,
    finalScore: 1000 + index,
    previousBest: 0,
    newBest: 1000 + index,
    mintedDelta: BigInt(1000 + index) * 10_000_000n,
    tapeHash: `0x${index.toString(16).padStart(64, "0")}`,
  };
  chain.events.push({
    ...e,
    txHash: `0x${"f".repeat(63)}${index % 10}`,
    blockHeight: height,
    sequenceNumber: index,
  });
  return e;
}

describe("syncScoreEvents", () => {
  it("walks pages, saves progress, and dedupes rows the relay wrote", async () => {
    const chain = new FakeChain();
    const env = { LEADERBOARD_DB: d1() } as unknown as WorkerEnv;
    const score = chain.scoreContract();
    const blockTimes = { blockTimeMs: async (h: bigint) => chain.blockTimeMs(h) };

    const first = event(chain, 1, 10n);
    for (let i = 2; i <= 5; i += 1) {
      event(chain, i, BigInt(10 + i));
    }
    // The relay already wrote event 1.
    await upsertScoreEvent(
      env,
      scoreEventRow(first, {
        txHash: "0xaa",
        blockHeight: 10n,
        closedAtMs: chain.blockTimeMs(10n),
        source: "relay",
      }),
    );

    const result = await syncScoreEvents(env, score, blockTimes, { maxPages: 10, pageLimit: 2 });
    expect(result).toMatchObject({
      pages: 3,
      events: 5,
      inserted: 4,
      exhausted: true,
      lastHeight: "15",
    });
    expect(await countScoreEvents(env)).toBe(5);
    const state = await getIndexerState(env);
    expect(state).toMatchObject({ fromHeight: "15", cursor: "", totalEvents: 5 });

    // A new walk restarts inclusively at the last height and finds new rows.
    event(chain, 6, 15n);
    event(chain, 7, 20n);
    const second = await syncScoreEvents(env, score, blockTimes, { maxPages: 10, pageLimit: 2 });
    expect(second).toMatchObject({ inserted: 2, lastHeight: "20" });
    expect(await countScoreEvents(env)).toBe(7);
  });

  it("continues an unfinished walk from the saved cursor", async () => {
    const chain = new FakeChain();
    const env = { LEADERBOARD_DB: d1() } as unknown as WorkerEnv;
    for (let i = 1; i <= 5; i += 1) {
      event(chain, i, BigInt(i));
    }
    const blockTimes = { blockTimeMs: async (h: bigint) => chain.blockTimeMs(h) };
    const partial = await syncScoreEvents(env, chain.scoreContract(), blockTimes, {
      maxPages: 1,
      pageLimit: 2,
    });
    expect(partial).toMatchObject({ events: 2, exhausted: false });
    expect((await getIndexerState(env))?.cursor).not.toBe("");
    const rest = await syncScoreEvents(env, chain.scoreContract(), blockTimes, {
      maxPages: 10,
      pageLimit: 2,
    });
    expect(rest).toMatchObject({ events: 3, inserted: 3, exhausted: true });
  });

  it("restarts the walk when the score contract changes", async () => {
    const chain = new FakeChain();
    const env = { LEADERBOARD_DB: d1() } as unknown as WorkerEnv;
    event(chain, 1, 50n);
    const blockTimes = { blockTimeMs: async (h: bigint) => chain.blockTimeMs(h) };
    await syncScoreEvents(env, chain.scoreContract(), blockTimes, { maxPages: 10, pageLimit: 10 });
    expect((await getIndexerState(env))?.fromHeight).toBe("50");
    const other = { ...chain.scoreContract(), address: `0x${"99".repeat(32)}` };
    chain.events = [];
    event(chain, 2, 3n);
    const result = await syncScoreEvents(env, other, blockTimes, { maxPages: 10, pageLimit: 10 });
    expect(result).toMatchObject({ inserted: 1, lastHeight: "3" });
    expect((await getIndexerState(env))?.contractAddress).toBe(other.address);
  });
});

describe("estimateEventTimeMs", () => {
  const now = Date.UTC(2026, 9, 23, 12, 5, 0);
  const seedId = Math.floor(now / 600_000);

  it("counts back 2 s per block from the head", () => {
    expect(estimateEventTimeMs({ blockHeight: 90n, seedId }, 100n, now)).toBe(now - 20_000);
  });

  it("stays inside the seed's active window", () => {
    expect(estimateEventTimeMs({ blockHeight: 0n, seedId }, 1_000_000n, now)).toBe(
      seedId * 600_000,
    );
    expect(estimateEventTimeMs({ blockHeight: 100n, seedId: seedId - 200 }, 100n, now)).toBe(
      (seedId - 200 + 144) * 600_000,
    );
  });

  it("is used when the RPC has no block times", async () => {
    const chain = new FakeChain();
    const env = { LEADERBOARD_DB: d1() } as unknown as WorkerEnv;
    event(chain, 1, chain.height);
    const before = Date.now();
    await syncScoreEvents(
      env,
      chain.scoreContract(),
      { blockTimeMs: async () => Promise.reject(new Error("not implemented")) },
      { maxPages: 1, pageLimit: 10 },
    );
    const row = await env.LEADERBOARD_DB.prepare("SELECT closed_at FROM score_events").first<{
      closed_at: string;
    }>();
    // seedId 100 is far in the past, so the time clamps to its window end.
    expect(new Date(row?.closed_at ?? 0).getTime()).toBe((100 + 144) * 600_000);
    expect(before).toBeGreaterThan(0);
  });
});
