import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NetworkMismatchError, type Transport } from "@thruputchain/client";
import {
  KALIEN_DECIMALS,
  SCORE_ERRORS,
  connectKalien,
  decodeScoreErrorCode,
  decodeSubmitReceipt,
  getBestScore,
  getCurrentSeedId,
  getKalienBalance,
  getScoreSubmittedPage,
  getSubmitResult,
  getTokenMetadata,
  iterateScoreSubmitted,
  readPlayerState,
  seedIdAt,
  submitGasLimit,
  type KalienConfig,
} from "./kalien";

// Real devnet responses, recorded by kalien-contract/scripts/record-rpc-fixtures.ts.
const recorded = JSON.parse(readFileSync(join(import.meta.dir, "test-data/devnet-rpc.json"), "utf8"));
const config: KalienConfig = recorded.deployment;
const player: string = recorded.player;

interface Exchange {
  method: string;
  params?: unknown;
  result: unknown;
}

/** Serves recorded results for identical (method, params); records what was asked. */
function replayTransport(exchanges: Exchange[]) {
  const calls: { method: string; params: unknown }[] = [];
  const transport: Transport = {
    async request<T>(method: string, params?: unknown[]): Promise<T> {
      calls.push({ method, params });
      const key = JSON.stringify(params ?? null);
      const hit = exchanges.find((e) => e.method === method && JSON.stringify(e.params ?? null) === key);
      if (!hit) throw new Error(`no recorded response for ${method} ${key.slice(0, 200)}`);
      return hit.result as T;
    },
  };
  return { transport, calls };
}

const connect = (exchanges: Exchange[] = recorded.exchanges) => {
  const r = replayTransport(exchanges);
  return connectKalien(config, { transport: r.transport }).then((client) => ({ client, calls: r.calls }));
};

describe("constants", () => {
  test("gas limit covers the measured gas with margin", () => {
    // Measured on RV32 / devnet.
    const measured: [number, number][] = [
      [700, 1_504_343],
      [5_000, 9_750_461],
      [6_643, 14_266_307],
      [36_000, 74_293_437],
    ];
    for (const [frames, gas] of measured) {
      const limit = submitGasLimit(frames);
      expect(limit > BigInt(gas)).toBe(true);
      expect(Number(limit) / gas < 3.1).toBe(true);
    }
    expect(submitGasLimit(36_000)).toBe(82_200_000n);
    expect(() => submitGasLimit(-1)).toThrow();
  });

  test("seed ids", () => {
    expect(seedIdAt(1_800_000_000)).toBe(3_000_000);
    expect(seedIdAt(599)).toBe(0);
    expect(KALIEN_DECIMALS).toBe(7);
    expect(SCORE_ERRORS[8]).toBe("AlreadyClaimed");
  });
});

describe("connectKalien", () => {
  test("accepts the recorded network", async () => {
    const { client } = await connect();
    expect(client.network.networkHash.length).toBe(32);
  });

  test("rejects a different network hash (devnet wipe)", async () => {
    const r = replayTransport(recorded.exchanges);
    const wrong = { ...config, networkHash: "0x" + "11".repeat(32) };
    await expect(connectKalien(wrong, { transport: r.transport })).rejects.toBeInstanceOf(NetworkMismatchError);
  });
});

describe("ScoreSubmitted events", () => {
  test("decodes a page of accepted runs", async () => {
    const { client, calls } = await connect();
    const page = await getScoreSubmittedPage(client, config, { limit: 10 });
    const request = calls.find((c) => c.method === "groundhog_getEvents")!.params as [Record<string, unknown>];
    expect(request[0].order).toBe("ascending");
    expect(request[0].cursor).toBe("0x");
    expect(request[0].limit).toBe(10);
    expect(JSON.stringify(request[0].filters)).toContain(config.scoreContract);

    expect(page.rows.map((r) => r.finalScore).slice(0, 4)).toEqual([1480, 11190, 14870, 911140]);
    const first = page.rows[0]!;
    expect(first.player).toBe(player as `0x${string}`);
    expect(first.frameCount).toBe(700);
    expect(first.previousBest).toBe(0);
    expect(first.newBest).toBe(1480);
    expect(first.mintedDelta).toBe(1480n * 10_000_000n);
    expect(first.seed).toBe(0xdeadbeef);
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.tapeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.playerPubkey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof first.blockHeight).toBe("bigint");
    const second = page.rows[1]!;
    expect(second.previousBest).toBe(1480);
    expect(second.mintedDelta).toBe((11190n - 1480n) * 10_000_000n);
    expect(page.latestBlock >= first.blockHeight).toBe(true);
  });

  test("filters by player and seed id through topics", async () => {
    const { client, calls } = await connect();
    const seedId = 2987989;
    const page = await getScoreSubmittedPage(client, config, { player, seedId, limit: 10 });
    const request = calls.filter((c) => c.method === "groundhog_getEvents").at(-1)!.params as [
      { filters: { topics: Record<string, string[]> }[] },
    ];
    expect(request[0].filters[0]!.topics.topic1).toEqual([player]);
    expect(request[0].filters[0]!.topics.topic2).toEqual(["0x" + seedId.toString(16).padStart(64, "0")]);
    expect(page.rows.every((r) => r.seedId === seedId && r.player === player)).toBe(true);
    expect(page.rows.map((r) => r.finalScore)).toEqual([1480, 11190]);
  });

  test("iterator stops on an exhausted cursor", async () => {
    const empty = { events: [], cursor: "0x", latestBlock: "10", oldestBlock: "0" };
    const exchanges = [
      recorded.exchanges[0],
      {
        method: "groundhog_getEvents",
        params: recorded.exchanges[1].params.map((p: Record<string, unknown>) => ({ ...p, limit: 100, anchor: { kind: "atHeight", height: "5" } })),
        result: empty,
      },
    ];
    const { client } = await connect(exchanges);
    const pages = [];
    for await (const page of iterateScoreSubmitted(client, config, { fromHeight: 5n })) pages.push(page);
    expect(pages.length).toBe(1);
    expect(pages[0]!.exhausted).toBe(true);
    expect(pages[0]!.cursor).toBe("0x");
  });
});

describe("views", () => {
  test("player state from one snapshot", async () => {
    const { client } = await connect();
    const state = await readPlayerState(client, config, player, 2987989);
    expect(state.seed).toBe(0xdeadbeef);
    expect(state.bestScore).toBe(11190);
    expect(state.kalienBalance).toBe(937_200n * 10_000_000n);
    expect(typeof state.active).toBe("boolean");
  });

  test("token metadata", async () => {
    const { client } = await connect();
    const meta = await getTokenMetadata(client, config);
    expect(meta.name).toBe("Kalien");
    expect(meta.symbol).toBe("KALIEN");
    expect(meta.decimals).toBe(7);
    expect(meta.totalSupply >= 937_200n * 10_000_000n).toBe(true);
  });
});

describe("submit results", () => {
  test("recovers a confirmed submission by hash", async () => {
    const { client } = await connect();
    const result = await getSubmitResult(client, config, "0xd1e3acc9e95a667beaac1f47e12a07fb8bdafab3f9b6ffa57cb45c4447834876", 82_200_000n);
    expect(result.status).toBe("confirmed");
    expect(result.execResult).toBe(0);
    expect(result.gasUsed).toBe(67_385_636n);
    expect(result.run?.finalScore).toBe(911_140);
    expect(result.run?.frameCount).toBe(36_000);
    expect(result.run?.player).toBe(player as `0x${string}`);
  });

  test("decodes the recorded devnet submitScore runs", () => {
    const w = recorded.writes;
    expect(w.accepted.status).toBe("confirmed");
    expect(w.accepted.run.finalScore).toBe(92_820);
    expect(w.rejected.status).toBe("rejected");
    expect(w.rejected.errorName).toBe("NotImproved");
    // onSigned saw each hash before broadcast.
    expect(w.signedHashes).toEqual([w.accepted.txHash, w.rejected.txHash]);
  });

  test("decodeSubmitReceipt names the contract error", async () => {
    const exchanges = [
      recorded.exchanges[0],
      { method: "groundhog_getTransactionReceipt", params: [recorded.writes.rejected.txHash], result: recorded.writes.rejectedReceipt },
      { method: "groundhog_getTransactionReceipt", params: [recorded.writes.accepted.txHash], result: recorded.writes.acceptedReceipt },
    ];
    const { client } = await connect(exchanges);
    const rejected = await getSubmitResult(client, config, recorded.writes.rejected.txHash, 82_200_000n);
    expect(rejected.status).toBe("rejected");
    expect(rejected.errorCode).toBe(10);
    expect(rejected.errorName).toBe("NotImproved");
    expect(rejected.execResult).not.toBe(0);
    const accepted = await getSubmitResult(client, config, recorded.writes.accepted.txHash, 82_200_000n);
    expect(accepted.status).toBe("confirmed");
    expect(accepted.gasUsed).toBe(74_293_437n);
    expect(decodeSubmitReceipt).toBeDefined();
  });

  test("unknown abort data is not a ScoreError", () => {
    expect(decodeScoreErrorCode(null)).toBe(null);
    expect(decodeScoreErrorCode(new Uint8Array([1, 2, 3]))).toBe(null);
  });
});

// Live devnet read test. Run with: KALIEN_LIVE=1 bun test shared/thruput/kalien.test.ts
const live = process.env.KALIEN_LIVE === "1" ? describe : describe.skip;
live("live devnet", () => {
  test("reads deployment, seeds, balances and events", async () => {
    const deployment = JSON.parse(readFileSync(join(import.meta.dir, "deployments/devnet.json"), "utf8"));
    const client = await connectKalien(deployment);
    const seedId = await getCurrentSeedId(client, deployment);
    expect(Math.abs(seedId - seedIdAt(Date.now() / 1000))).toBeLessThanOrEqual(1);
    const meta = await getTokenMetadata(client, deployment);
    expect(meta.symbol).toBe("KALIEN");
    expect(await getBestScore(client, deployment, player, 2987989)).toBe(11190);
    expect((await getKalienBalance(client, deployment, player)) >= 937_200n * 10_000_000n).toBe(true);
    let rows = 0;
    for await (const page of iterateScoreSubmitted(client, deployment, { limit: 2 })) rows += page.rows.length;
    expect(rows).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
