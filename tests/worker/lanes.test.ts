import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { deserializeTape, serializeTape } from "../../src/game/tape";
import { setChainContextFactory } from "../../worker/chain/context";
import { bytesToHex, sha256 } from "../../worker/hex";
import { laneCount, laneForRun, relaySecrets } from "../../worker/relay/lanes";
import { replayTape } from "../../worker/replay";
import { currentSeedId } from "../../worker/seed";
import { signClaim, testPlayer } from "./helpers/fake-chain";
import { testApp } from "./helpers/env";

const medium = new Uint8Array(
  readFileSync(join(import.meta.dir, "../../test-fixtures/test-medium.tape")),
);

/** A real tape: the first `frames` inputs of test-medium, with its replayed score. */
function prefixTape(frames: number): Uint8Array {
  const tape = deserializeTape(medium);
  const inputs = tape.inputs.slice(0, frames);
  const draft = serializeTape(tape.header.seed, inputs, 1);
  return serializeTape(tape.header.seed, inputs, replayTape(draft).replayedScore);
}

afterEach(() => setChainContextFactory(null));

describe("relay lanes", () => {
  it("parses RELAY_SECRETS and maps runs to a stable lane", () => {
    const a = "ab".repeat(32);
    const b = `0x${"cd".repeat(32)}`;
    expect(relaySecrets({ RELAY_SECRETS: `${a}, ${b}\n` })).toHaveLength(2);
    expect(() => relaySecrets({ RELAY_SECRETS: "" })).toThrow("not configured");
    expect(() => relaySecrets({ RELAY_SECRETS: `${a},zz` })).toThrow("entry 1");
    expect(laneCount({ RELAY_SECRETS: undefined })).toBe(1);
    const id = "f".repeat(64);
    expect(laneForRun(id, 4)).toBe(laneForRun(id, 4));
    expect(laneForRun("00000003" + "0".repeat(56), 4)).toBe(3);
  });

  it("spreads runs over lanes, confirms them all, and pages the player's list", async () => {
    const t = testApp({ lanes: 4 });
    const player = await testPlayer(5);
    const base = currentSeedId();
    const frames = [900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600];
    const runIds: string[] = [];
    for (const [index, count] of frames.entries()) {
      const seedId = base - index;
      t.chain.seeds.set(seedId, 0xdeadbeef);
      const tape = prefixTape(count);
      const sig = bytesToHex(await signClaim(player, seedId, tape));
      // eslint-disable-next-line no-await-in-loop
      const response = await t.request(
        `/api/runs?pubkey=${bytesToHex(player.pubkey)}&seed_id=${seedId}&sig=${sig}`,
        { method: "POST", body: tape },
      );
      expect(response.status).toBe(202);
      runIds.push(bytesToHex(await sha256(tape)));
      // Distinct created_at values make the order checks exact.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const used = new Set(runIds.map((id) => laneForRun(id, 4)));
    expect(used.size).toBeGreaterThan(1);
    for (const [lane, service] of t.lanes.entries()) {
      for (const id of runIds) {
        expect(service.getRun(id) !== null).toBe(laneForRun(id, 4) === lane);
      }
    }

    await t.settle();
    for (const id of runIds) {
      // eslint-disable-next-line no-await-in-loop
      const run = (await (await t.request(`/api/runs/${id}`)).json()) as { status: string };
      expect(run.status).toBe("confirmed");
    }

    const newestFirst = [...runIds].reverse();
    type Page = {
      runs: Array<{ runId: string }>;
      total: number;
      nextOffset: number | null;
      nextCursor: string | null;
    };
    const page1 = (await (
      await t.request(`/api/runs?player=${player.address}&limit=4`)
    ).json()) as Page;
    expect(page1.total).toBe(10);
    expect(page1.runs.map((r) => r.runId)).toEqual(newestFirst.slice(0, 4));
    expect(page1.nextOffset).toBe(4);

    const page2 = (await (
      await t.request(`/api/runs?player=${player.address}&limit=4&offset=4`)
    ).json()) as Page;
    expect(page2.runs.map((r) => r.runId)).toEqual(newestFirst.slice(4, 8));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = (await (
        await t.request(
          `/api/runs?player=${player.address}&limit=3${cursor ? `&cursor=${cursor}` : ""}`,
        )
      ).json()) as Page;
      seen.push(...page.runs.map((r) => r.runId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(newestFirst);

    expect((await t.request(`/api/runs?player=${player.address}&cursor=nope`)).status).toBe(400);
  });
});

describe("allowlist routing", () => {
  it("sends new runs only to lanes whose key is an allowed relay", async () => {
    const { relayAddress } = await import("../../worker/chain/relay-wallet");
    const { relaySecrets } = await import("../../worker/relay/lanes");
    const { resetAllowlistCache } = await import("../../worker/relay/stub");
    resetAllowlistCache();
    const t = testApp({ lanes: 4 });
    const secrets = relaySecrets(t.env);
    // Lanes 1 and 3 are not on the allowlist.
    t.chain.blockedRelays.add(relayAddress(secrets[1] ?? new Uint8Array()));
    t.chain.blockedRelays.add(relayAddress(secrets[3] ?? new Uint8Array()));
    const player = await testPlayer(6);
    const base = currentSeedId();
    for (const [index, count] of [900, 1300, 1700, 2100, 2500, 2900].entries()) {
      const seedId = base - index;
      t.chain.seeds.set(seedId, 0xdeadbeef);
      const tape = prefixTape(count);
      const sig = bytesToHex(await signClaim(player, seedId, tape));
      // eslint-disable-next-line no-await-in-loop
      const response = await t.request(
        `/api/runs?pubkey=${bytesToHex(player.pubkey)}&seed_id=${seedId}&sig=${sig}`,
        { method: "POST", body: tape },
      );
      expect(response.status).toBe(202);
    }
    const counts = t.lanes.map((lane) => lane.store.countByPlayer(player.address));
    expect(counts[1]).toBe(0);
    expect(counts[3]).toBe(0);
    expect((counts[0] ?? 0) + (counts[2] ?? 0)).toBe(6);
    const health = (await (
      await t.request("/api/health", { headers: { authorization: "Bearer test-key" } })
    ).json()) as {
      lanes: Array<{ lane: number; allowed: boolean | null }>;
    };
    expect(health.lanes.map((lane) => lane.allowed)).toEqual([true, false, true, false]);
  });
});

describe("RelayService.kick", () => {
  it("re-arms a lost alarm only when work is pending", async () => {
    const { RelayService } = await import("../../worker/relay/service");
    const { sqlLike } = await import("./helpers/sqlite");
    const scheduled: number[] = [];
    const service = new RelayService(
      sqlLike(),
      async () => Promise.reject(new Error("not needed")),
      async (at) => {
        scheduled.push(at);
      },
      () => 1_000,
    );
    expect(await service.kick()).toBe(false);
    service.store.enqueue(
      {
        runId: "a".repeat(64),
        playerPubkey: "b".repeat(64),
        playerAddress: `0x${"c".repeat(64)}`,
        seedId: 1,
        seed: 1,
        frameCount: 10,
        claimedScore: 10,
        signature: "d".repeat(128),
      },
      1_000,
    );
    expect(await service.kick()).toBe(true);
    expect(scheduled).toEqual([1_000]);
  });
});
