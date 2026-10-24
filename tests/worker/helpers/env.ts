import { Hono } from "hono";
import { createApiRouter } from "../../../worker/api/routes";
import { setChainContextFactory } from "../../../worker/chain/context";
import type { WorkerEnv } from "../../../worker/env";
import { scoreEventRow } from "../../../worker/leaderboard/indexer";
import { recordSeed, upsertScoreEvent } from "../../../worker/leaderboard/store";
import { DEFAULT_RELAY_POLICY } from "../../../worker/relay/engine";
import { RelayService } from "../../../worker/relay/service";
import type { NewRun } from "../../../worker/relay/store";
import { getTape } from "../../../worker/tapes";
import { FakeChain, NETWORK_HASH, SCORE_ADDRESS } from "./fake-chain";
import { d1, sqlLike } from "./sqlite";

function fakeR2(): R2Bucket {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key: string, value: Uint8Array) {
      objects.set(key, new Uint8Array(value));
      return {} as R2Object;
    },
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes
        ? ({ arrayBuffer: async () => bytes.slice().buffer } as unknown as R2ObjectBody)
        : null;
    },
  } as unknown as R2Bucket;
}

/** API router with a fake chain, D1 over bun:sqlite, and an in-process relay. */
export function testApp(options: { lanes?: number } = {}) {
  const chain = new FakeChain();
  const db = d1();
  const env = {
    LEADERBOARD_DB: db,
    TAPES: fakeR2(),
    SCORE_CONTRACT: SCORE_ADDRESS,
    THRUPUT_RPC_URL: "http://127.0.0.1:1",
    DEV_API_KEY: "test-key",
  } as unknown as WorkerEnv;
  let alarmAt: number | null = null;
  const lanes = Array.from(
    { length: options.lanes ?? 1 },
    () =>
      new RelayService(
        sqlLike(),
        async () => ({
          chain: chain.relayChain(),
          score: chain.scoreContract(),
          policy: { ...DEFAULT_RELAY_POLICY, expiryBlocks: 5n },
          loadTape: (runId) => getTape(env, runId),
          onConfirmed: async (confirmed) => {
            await upsertScoreEvent(
              env,
              scoreEventRow(confirmed.event, {
                txHash: confirmed.txHash,
                blockHeight: confirmed.blockHeight,
                closedAtMs: confirmed.closedAtMs,
                source: "relay",
              }),
            );
          },
          onSeed: (seedId, seed) => recordSeed(env, seedId, seed),
          now: Date.now,
        }),
        async (at) => {
          alarmAt = alarmAt === null ? at : Math.min(alarmAt, at);
        },
      ),
  );
  // Same call shapes as RelayDO: every method names its lane first.
  const stubs = lanes.map((service, index) => {
    const check = (lane: number) => {
      if (lane !== index) {
        throw new Error(`lane ${index} called as lane ${lane}`);
      }
    };
    return {
      submitRun: async (lane: number, run: NewRun) => (check(lane), service.submitRun(run)),
      getRun: async (lane: number, runId: string) => (check(lane), service.getRun(runId)),
      listRuns: async (
        lane: number,
        player: string,
        opts: Parameters<RelayService["listRuns"]>[1],
      ) => (check(lane), service.listRuns(player, opts)),
      touchSeed: async (lane: number, seedId: number) => (check(lane), service.touchSeed(seedId)),
      status: async (lane: number) => (check(lane), await service.kick(), service.status()),
      kick: async (lane: number) => (check(lane), service.kick()),
      runsByStatus: async (lane: number, statuses: never[], limit: number) => (
        check(lane), service.runsByStatus(statuses, limit)
      ),
    };
  });
  (env as { RELAY: unknown }).RELAY = {
    idFromName: (name: string) => Number(name.split("-").at(-1)),
    get: (lane: number) => stubs[lane],
  };
  (env as { RELAY_SECRETS?: string }).RELAY_SECRETS = lanes
    .map((_, i) => `${i + 1}`.repeat(64))
    .join(",");
  setChainContextFactory(async () => ({
    settings: {
      rpcUrl: "http://127.0.0.1:1",
      networkHash: NETWORK_HASH,
      scoreContract: SCORE_ADDRESS,
      tokenContract: null,
      explorerUrl: "https://explorer.thruput.network",
    },
    client: null as never,
    networkHash: NETWORK_HASH,
    score: chain.scoreContract(),
    blockTimeMs: async (height) => chain.blockTimeMs(height),
  }));

  const app = new Hono<{ Bindings: WorkerEnv }>();
  app.route("/api", createApiRouter());
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  return {
    chain,
    db,
    env,
    relay: lanes[0] as RelayService,
    lanes,
    alarmAt: () => alarmAt,
    async request(path: string, init?: RequestInit) {
      const response = await app.fetch(new Request(`http://localhost${path}`, init), env, ctx);
      await Promise.all(waits.splice(0));
      return response;
    },
    /** Runs relay ticks and mines blocks until no run is in flight. */
    async settle(rounds = 5) {
      for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(lanes.map((lane) => lane.tick()));
        // eslint-disable-next-line no-await-in-loop
        await chain.mine();
      }
      await Promise.all(lanes.map((lane) => lane.tick()));
    },
  };
}
