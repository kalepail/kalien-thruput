import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { setChainContextFactory } from "../../worker/chain/context";
import { bytesToHex, sha256 } from "../../worker/hex";
import { profileMessage } from "../../worker/profile";
import { currentSeedId } from "../../worker/seed";
import { NETWORK_HASH, signClaim, testPlayer } from "./helpers/fake-chain";
import { testApp } from "./helpers/env";

const FIXTURES = join(import.meta.dir, "../../test-fixtures");
const shortTape = new Uint8Array(readFileSync(join(FIXTURES, "test-short.tape")));
const mediumTape = new Uint8Array(readFileSync(join(FIXTURES, "test-medium.tape")));
const realTape = new Uint8Array(readFileSync(join(FIXTURES, "test-real-game.tape")));

function seedOf(tape: Uint8Array): number {
  return new DataView(tape.buffer, tape.byteOffset).getUint32(8, true);
}

async function submit(
  t: ReturnType<typeof testApp>,
  tape: Uint8Array,
  options: { playerByte?: number; seedId?: number; sig?: string } = {},
) {
  const player = await testPlayer(options.playerByte ?? 7);
  const seedId = options.seedId ?? currentSeedId();
  const sig = options.sig ?? bytesToHex(await signClaim(player, seedId, tape));
  const response = await t.request(
    `/api/runs?pubkey=${bytesToHex(player.pubkey)}&seed_id=${seedId}&sig=${sig}`,
    { method: "POST", body: tape },
  );
  return { response, body: (await response.json()) as Record<string, unknown>, player };
}

afterEach(() => setChainContextFactory(null));

describe("POST /api/runs", () => {
  it("accepts a valid run, confirms it, and lists it on the leaderboard", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    const { response, body, player } = await submit(t, shortTape);
    expect(response.status).toBe(202);
    expect(body.status).toBe("queued");
    const runId = bytesToHex(await sha256(shortTape));
    expect(body.runId).toBe(runId);
    expect(t.alarmAt()).not.toBeNull();

    // The tape is not public before confirmation.
    expect((await t.request(`/api/runs/${runId}/tape`)).status).toBe(404);

    await t.settle();
    const status = (await (await t.request(`/api/runs/${runId}`)).json()) as Record<
      string,
      unknown
    >;
    expect(status.status).toBe("confirmed");
    expect(status.score).toBe(1480);
    expect(status.previousBest).toBe(0);
    expect(status.minted).toBe("14800000000");
    expect(typeof status.txHash).toBe("string");

    const tape = await t.request(`/api/runs/${runId}/tape`);
    expect(tape.status).toBe(200);
    expect(new Uint8Array(await tape.arrayBuffer())).toEqual(shortTape);

    const list = (await (await t.request(`/api/runs?player=${player.address}`)).json()) as {
      runs: Array<{ runId: string }>;
    };
    expect(list.runs.map((run) => run.runId)).toEqual([runId]);

    const board = (await (await t.request(`/api/leaderboard?window=all`)).json()) as {
      entries: Array<{ playerAddress: string; score: number; runId: string; rank: number }>;
    };
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({
      playerAddress: player.address,
      score: 1480,
      runId,
      rank: 1,
    });

    const page = (await (await t.request(`/api/leaderboard/player/${player.address}`)).json()) as {
      player: { stats: { bestScore: number; totalMinted: string }; ranks: { all: number } };
    };
    expect(page.player.stats).toMatchObject({ bestScore: 1480, totalMinted: "14800000000" });
    expect(page.player.ranks.all).toBe(1);
  });

  it("returns the existing run for a duplicate tape", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    await submit(t, shortTape);
    const again = await submit(t, shortTape);
    expect(again.response.status).toBe(200);
    expect(again.body.status).toBe("queued");
  });

  it("refuses a tape that another player already submitted", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    await submit(t, shortTape, { playerByte: 1 });
    const other = await submit(t, shortTape, { playerByte: 2 });
    expect(other.response.status).toBe(409);
    expect(other.body.code).toBe("already_claimed");
  });

  it("refuses a blocked (fixture) seed epoch before any chain call", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, seedOf(shortTape));
    (t.env as { BLOCKED_SEED_IDS?: string }).BLOCKED_SEED_IDS = `1,${seedId}`;
    const { response, body } = await submit(t, shortTape);
    expect(response.status).toBe(403);
    expect(body.code).toBe("seed_blocked");
    expect(t.chain.signed.size).toBe(0);
    expect(t.relay.store.countByStatus().queued).toBe(0);
  });

  it("rejects a bad signature", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    const { response, body } = await submit(t, shortTape, { sig: "ab".repeat(64) });
    expect(response.status).toBe(400);
    expect(body.code).toBe("bad_signature");
  });

  it("rejects a signature for another seed id", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, seedOf(shortTape));
    const player = await testPlayer(7);
    const sig = bytesToHex(await signClaim(player, seedId - 1, shortTape));
    const { body } = await submit(t, shortTape, { sig });
    expect(body.code).toBe("bad_signature");
  });

  it("rejects a tape whose footer score does not replay", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    // Change the claimed score and fix the CRC so only the replay can catch it.
    const { serializeTape, deserializeTape } = await import("../../src/game/tape");
    const parsed = deserializeTape(shortTape);
    const forged = serializeTape(parsed.header.seed, parsed.inputs, 99_999);
    const { response, body } = await submit(t, forged);
    expect(response.status).toBe(400);
    expect(body.code).toBe("replay_mismatch");
  });

  it("rejects a corrupt tape", async () => {
    const t = testApp();
    const broken = shortTape.slice();
    broken[20] ^= 0xff;
    const { response, body } = await submit(t, broken);
    expect(response.status).toBe(400);
    expect(body.code).toBe("bad_tape");
  });

  it("rejects a seed mismatch, an inactive seed, and a missing seed", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, 12345);
    expect((await submit(t, shortTape)).body.code).toBe("seed_mismatch");
    expect((await submit(t, shortTape, { seedId: seedId - 200 })).body.code).toBe("seed_inactive");
    expect((await submit(t, shortTape, { seedId: seedId - 1 })).body.code).toBe("seed_missing");
  });

  it("rejects a score that does not beat the player's best", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, seedOf(shortTape));
    const player = await testPlayer(7);
    t.chain.best.set(`${player.address}:${seedId}`, 2_000);
    const { response, body } = await submit(t, shortTape);
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "not_improved", bestScore: 2000 });
  });

  it("ranks the best run per player", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, seedOf(shortTape)); // short and medium share seed 0xDEADBEEF
    await submit(t, shortTape, { playerByte: 1 });
    await t.settle();
    await submit(t, mediumTape, { playerByte: 1 });
    await t.settle();
    t.chain.seeds.set(seedId - 1, seedOf(realTape));
    await submit(t, realTape, { playerByte: 2, seedId: seedId - 1 });
    await t.settle();
    const board = (await (await t.request(`/api/leaderboard?window=all`)).json()) as {
      entries: Array<{ score: number }>;
      pagination: { total: number };
    };
    expect(board.pagination.total).toBe(2);
    expect(board.entries.map((entry) => entry.score)).toEqual([14870, 11190]);
  });
});

describe("contract redeploy", () => {
  it("starts an empty leaderboard and seed cache for a new score contract", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    await submit(t, shortTape);
    await t.settle();
    await t.request("/api/seed/current");
    const all = async () =>
      (
        (await (await t.request("/api/leaderboard?window=all")).json()) as {
          pagination: { total: number };
        }
      ).pagination.total;
    expect(await all()).toBe(1);

    const env = t.env as { SCORE_CONTRACT?: string };
    const old = env.SCORE_CONTRACT;
    env.SCORE_CONTRACT = `0x${"77".repeat(32)}`;
    expect(await all()).toBe(0);
    const { getSeed } = await import("../../worker/leaderboard/store");
    expect(await getSeed(t.env, currentSeedId())).toBeNull();
    env.SCORE_CONTRACT = old;
    expect(await all()).toBe(1);
  });
});

describe("GET /api/admin/runs", () => {
  it("lists rejected runs with their error for the admin key only", async () => {
    const t = testApp();
    const seedId = currentSeedId();
    t.chain.seeds.set(seedId, seedOf(shortTape));
    t.chain.forceFailure = "NotImproved";
    await submit(t, shortTape);
    await t.settle();
    expect((await t.request("/api/admin/runs")).status).toBe(404);
    const body = (await (
      await t.request("/api/admin/runs?status=rejected", {
        headers: { authorization: "Bearer test-key" },
      })
    ).json()) as { runs: Array<{ lane: number; status: string; error: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ lane: 0, status: "rejected", error: "NotImproved" });
  });
});

describe("POST /api/admin/runs/:id/retry", () => {
  it("queues a failed run again and it confirms", async () => {
    const t = testApp();
    t.chain.seeds.set(currentSeedId(), seedOf(shortTape));
    t.chain.forceFault = true;
    const { body } = await submit(t, shortTape);
    await t.settle();
    const runId = String(body.runId);
    const failed = (await (await t.request(`/api/runs/${runId}`)).json()) as { status: string };
    expect(failed.status).toBe("failed");
    t.chain.forceFault = false;
    const admin = { method: "POST", headers: { authorization: "Bearer test-key" } };
    const retry = await t.request(`/api/admin/runs/${runId}/retry`, admin);
    expect(retry.status).toBe(200);
    await t.settle();
    const done = (await (await t.request(`/api/runs/${runId}`)).json()) as { status: string };
    expect(done.status).toBe("confirmed");
    expect((await t.request(`/api/admin/runs/${runId}/retry`, admin)).status).toBe(409);
  });
});

describe("GET /api/seed/current", () => {
  it("returns a stored seed and asks the relay to touch a missing one", async () => {
    const t = testApp();
    const missing = (await (await t.request("/api/seed/current")).json()) as Record<
      string,
      unknown
    >;
    expect(missing).toMatchObject({ seedId: currentSeedId(), seed: null, indexed: false });
    expect(t.relay.store.getSeedTouch()?.seedId).toBe(currentSeedId());

    t.chain.seeds.set(currentSeedId(), 0xabcdef);
    const found = (await (await t.request("/api/seed/current")).json()) as Record<string, unknown>;
    expect(found).toMatchObject({ seed: 0xabcdef, indexed: true });
  });
});

describe("GET /api/config", () => {
  it("returns the network and contracts", async () => {
    const t = testApp();
    const body = (await (await t.request("/api/config")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ networkHash: NETWORK_HASH, rpcUrl: "http://127.0.0.1:1" });
  });
});

describe("PUT /api/leaderboard/player/:address/profile", () => {
  async function put(
    t: ReturnType<typeof testApp>,
    overrides: Partial<{
      username: string | null;
      timestamp: number;
      address: string;
      byte: number;
    }> = {},
  ) {
    const player = await testPlayer(overrides.byte ?? 7);
    const address = overrides.address ?? player.address;
    const timestamp = overrides.timestamp ?? Date.now();
    const username = overrides.username === undefined ? "kale" : overrides.username;
    const linkUrl = "https://example.com";
    const signature = await player.sign(
      profileMessage({
        networkHash: NETWORK_HASH,
        playerAddress: address,
        timestamp,
        username,
        linkUrl,
      }),
    );
    return t.request(`/api/leaderboard/player/${address}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: bytesToHex(player.pubkey),
        username,
        linkUrl,
        timestamp,
        signature: bytesToHex(signature),
      }),
    });
  }

  it("stores a signed profile and refuses replays of older updates", async () => {
    const t = testApp();
    const first = await put(t, { timestamp: Date.now() - 1000 });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { profile: { username: string } }).profile.username).toBe(
      "kale",
    );
    expect((await put(t, { timestamp: Date.now() - 2000 })).status).toBe(409);
    expect((await put(t, { username: "kale2" })).status).toBe(200);
  });

  it("refuses a key that does not own the address", async () => {
    const t = testApp();
    const other = await testPlayer(9);
    expect((await put(t, { address: other.address })).status).toBe(403);
  });

  it("refuses a stale timestamp and a bad username", async () => {
    const t = testApp();
    expect((await put(t, { timestamp: Date.now() - 10 * 60_000 })).status).toBe(400);
    expect((await put(t, { username: "<script>" })).status).toBe(400);
  });
});
