import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toBase58 } from "@thruputchain/client";
import { bytes32, fromHex, pubkeyAccountAddress } from "./claim";
import {
  KALIEN_DECIMALS,
  SCORE_ERRORS,
  connectKalien,
  decodeScoreErrorCode,
  getBestScore,
  getBlockTime,
  getClaimedSeedId,
  getCurrentSeed,
  getCurrentSeedId,
  getKalienBalance,
  getRelays,
  getScoreConfig,
  getScoreSubmittedPage,
  getSubmitResult,
  getTokenMetadata,
  isTapeClaimed,
  parseAddress,
  readPlayerState,
  seedIdAt,
  submitGasLimit,
  tapePaddingOk,
  walkScoreSubmitted,
} from "./kalien";

const fixtures = join(import.meta.dir, "../../kalien-contract/fixtures");
const fixture = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)));

describe("constants and local checks", () => {
  test("gas limit covers the measured gas with margin", () => {
    // Measured on RV32 with thruput-sdk 0.54 (devnet adds ~300).
    const measured: [number, number][] = [
      [700, 1_550_301],
      [3_956, 7_221_954],
      [5_000, 9_817_917],
      [6_643, 14_341_977],
      [10_757, 23_209_327],
      [36_000, 74_515_543],
    ];
    for (const [frames, gas] of measured) {
      const limit = submitGasLimit(frames);
      expect(limit > BigInt(gas)).toBe(true);
    }
    expect(submitGasLimit(36_000)).toBe(82_200_000n);
    expect(() => submitGasLimit(-1)).toThrow();
  });

  test("seed ids and errors", () => {
    expect(seedIdAt(1_800_000_000)).toBe(3_000_000);
    expect(KALIEN_DECIMALS).toBe(7);
    expect(SCORE_ERRORS[14]).toBe("NotRelay");
    expect(SCORE_ERRORS[28]).toBe("TapeBadPadding");
    expect(decodeScoreErrorCode(null)).toBe(null);
    expect(decodeScoreErrorCode(new Uint8Array([1, 2, 3]))).toBe(null);
  });

  test("tape padding check matches the contract rule", () => {
    const real = fixture("test-real-game.tape"); // 6,643 frames: odd
    expect(tapePaddingOk(real)).toBe(true);
    const bad = real.slice();
    bad[bad.length - 9]! |= 0x50;
    expect(tapePaddingOk(bad)).toBe(false);
    expect(tapePaddingOk(fixture("test-short.tape"))).toBe(true);
  });

  test("addresses parse from base58 and hex", () => {
    const b58 = "8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT";
    const parsed = parseAddress(b58);
    expect(toBase58(parsed)).toBe(b58);
    const hex = "0x" + Buffer.from(bytes32(b58)).toString("hex");
    expect(toBase58(parseAddress(hex))).toBe(b58);
  });
});

// Live devnet tests. Run with: KALIEN_LIVE=1 bun test shared/thruput/kalien.test.ts
const live = process.env.KALIEN_LIVE === "1" ? describe : describe.skip;
live("live devnet (wire 14)", () => {
  const deployment = JSON.parse(readFileSync(join(import.meta.dir, "deployments/devnet.json"), "utf8"));
  // Written by kalien-contract/scripts/deploy-devnet.sh for the same deployment.
  const runs = JSON.parse(readFileSync(join(import.meta.dir, "../../kalien-contract/deployments/devnet-fixture-runs.json"), "utf8"));

  test("reads config, seeds, balances and token metadata", async () => {
    expect(runs.scoreContract).toBe(deployment.scoreContract);
    const client = await connectKalien(deployment);
    const seedId = await getCurrentSeedId(client, deployment);
    expect(Math.abs(seedId - seedIdAt(Date.now() / 1000))).toBeLessThanOrEqual(1);
    const seed = await getCurrentSeed(client, deployment);
    if (seed) expect(seed.seedId).toBe(seedId);

    const cfg = await getScoreConfig(client, deployment);
    expect(cfg.admin).toBe(deployment.admin);
    expect(cfg.token).toBe(deployment.tokenContract);
    expect(cfg.relayOnly).toBe(true);
    expect(cfg.seedingLocked).toBe(true);
    expect((await getRelays(client, deployment)).length).toBe(4);

    const meta = await getTokenMetadata(client, deployment);
    expect(meta).toMatchObject({ name: "Kalien", symbol: "KALIEN", decimals: 7 });
    expect(meta.totalSupply >= 937_200n * 10_000_000n).toBe(true);

    const short = runs.runs[0];
    expect(await getBestScore(client, deployment, runs.player, short.seedId)).toBe(11190);
    expect(await getKalienBalance(client, deployment, runs.player)).toBe(937_200n * 10_000_000n);
    expect(await isTapeClaimed(client, deployment, fixture("test-short.tape"))).toBe(true);
    expect(await getClaimedSeedId(client, deployment, fixture("test-short.tape"))).toBe(short.seedId);

    const state = await readPlayerState(client, deployment, runs.player, short.seedId);
    expect(state).toMatchObject({ seedId: short.seedId, seed: 0xdeadbeef, active: true, bestScore: 11190 });
    expect(state.kalienBalance).toBe(937_200n * 10_000_000n);
  }, 60_000);

  test("pages ScoreSubmitted with start and cursor, and walks to completion", async () => {
    const client = await connectKalien(deployment);
    const first = await getScoreSubmittedPage(client, deployment, { start: { order: "ascending" }, limit: 2 });
    expect(first.rows.map((r) => r.finalScore)).toEqual([1480, 11190]);
    expect(first.rows[0]!.player).toBe(runs.player);
    expect(first.rows[0]!.relay).toBe((await getRelays(client, deployment))[0]);
    expect(first.rows[0]!.submittedAt).toBeGreaterThan(1_700_000_000);
    expect(first.nextCursor).not.toBe(null);
    const rest = [];
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await getScoreSubmittedPage(client, deployment, { cursor, limit: 2 });
      rest.push(...page.rows);
      cursor = page.nextCursor;
    }
    expect([...first.rows, ...rest].map((r) => r.finalScore)).toEqual([1480, 11190, 14870, 911140]);

    // Topic filters.
    const mine = await getScoreSubmittedPage(client, deployment, { start: { order: "descending" }, player: runs.player, seedId: runs.runs[0].seedId });
    expect(mine.rows.map((r) => r.finalScore)).toEqual([11190, 1480]);

    // A fixed ascending walk returns a completion checkpoint.
    const seen: number[] = [];
    const completion = await walkScoreSubmitted(client, deployment, { limit: 3 }, (page) => {
      for (const r of page.rows) seen.push(r.finalScore);
    });
    expect(seen.slice(0, 4)).toEqual([1480, 11190, 14870, 911140]);
    expect(completion.completedThroughBlockHeight).toBeDefined();

    // Block times exist on wire 14.
    const t = await getBlockTime(client, first.rows[0]!.blockHeight);
    expect(t).toBe(first.rows[0]!.submittedAt);
  }, 120_000);

  test("decodes a confirmed fixture submission by hash", async () => {
    const client = await connectKalien(deployment);
    const max = runs.runs[3];
    const result = await getSubmitResult(client, deployment, max.transactionHash, BigInt(max.gasLimit));
    expect(result.status).toBe("confirmed");
    expect(result.executionResult).toBe("return");
    expect(result.run?.finalScore).toBe(911_140);
    expect(result.run?.frameCount).toBe(36_000);
    expect(result.run?.player).toBe(runs.player);
    expect(Number(result.gasUsed)).toBeGreaterThan(60_000_000);
    // The player address the contract minted to is the browser wallet address.
    expect(pubkeyAccountAddress(fromHex(result.run!.playerPubkey))).toBe(runs.player);
  }, 60_000);
});
