import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { bytesToHex, sha256 } from "../../worker/hex";
import {
  DEFAULT_RELAY_POLICY,
  RelayEngine,
  scoreGas,
  type ConfirmedRun,
} from "../../worker/relay/engine";
import { RelayStore, type NewRun } from "../../worker/relay/store";
import { currentSeedId } from "../../worker/seed";
import { FakeChain, signClaim, testPlayer } from "./helpers/fake-chain";
import { sqlLike } from "./helpers/sqlite";

const FIXTURES = join(import.meta.dir, "../../test-fixtures");
const shortTape = new Uint8Array(readFileSync(join(FIXTURES, "test-short.tape")));
const mediumTape = new Uint8Array(readFileSync(join(FIXTURES, "test-medium.tape")));

function seedOf(tape: Uint8Array): number {
  return new DataView(tape.buffer, tape.byteOffset).getUint32(8, true);
}

function scoreOf(tape: Uint8Array): number {
  const view = new DataView(tape.buffer, tape.byteOffset, tape.byteLength);
  return view.getUint32(tape.length - 8, true);
}

type RelayChainLike = { status: (txHash: string) => Promise<unknown> };

describe("RelayEngine", () => {
  let chain: FakeChain;
  let store: RelayStore;
  let engine: RelayEngine;
  let confirmed: ConfirmedRun[];
  let seeds: Array<[number, number]>;
  let now: number;
  const tapes = new Map<string, Uint8Array>();
  const seedId = currentSeedId();

  async function newRun(tape: Uint8Array, playerByte = 7): Promise<NewRun> {
    const player = await testPlayer(playerByte);
    const runId = bytesToHex(await sha256(tape));
    tapes.set(runId, tape);
    return {
      runId,
      playerPubkey: bytesToHex(player.pubkey),
      playerAddress: player.address,
      seedId,
      seed: seedOf(tape),
      frameCount: new DataView(tape.buffer, tape.byteOffset).getUint32(12, true),
      claimedScore: scoreOf(tape),
      signature: bytesToHex(await signClaim(player, seedId, tape)),
    };
  }

  beforeEach(() => {
    chain = new FakeChain();
    // Both fixtures use seed 0xDEADBEEF.
    chain.seeds.set(seedId, seedOf(shortTape));
    store = new RelayStore(sqlLike());
    confirmed = [];
    seeds = [];
    now = 1_000_000;
    engine = new RelayEngine({
      store,
      chain: chain.relayChain(),
      score: chain.scoreContract(),
      policy: {
        ...DEFAULT_RELAY_POLICY,
        expiryBlocks: 5n,
        expiryMarginBlocks: 2n,
        retryDelayMs: 0,
      },
      loadTape: async (runId) => tapes.get(runId) ?? null,
      onConfirmed: async (run) => {
        confirmed.push(run);
      },
      onSeed: async (id, seed) => {
        seeds.push([id, seed]);
      },
      now: () => now,
    });
  });

  it("submits, observes, and confirms a run", async () => {
    const run = await newRun(shortTape);
    expect(engine.enqueue(run).created).toBe(true);

    await engine.tick();
    const submitting = store.requireRun(run.runId);
    expect(submitting.status).toBe("submitting");
    expect(submitting.txHash).not.toBeNull();
    expect(submitting.attempts).toBe(1);

    await chain.mine();
    const { nextAt } = await engine.tick();
    const done = store.requireRun(run.runId);
    expect(done.status).toBe("confirmed");
    expect(done.score).toBe(1480);
    expect(done.previousBest).toBe(0);
    expect(done.minted).toBe("14800000000");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.closedAtMs).toBe(chain.blockTimeMs(chain.height));
    expect(nextAt).toBeNull();
  });

  it("sets the gas limit from the frame count", async () => {
    const run = await newRun(mediumTape);
    engine.enqueue(run);
    await engine.tick();
    expect(chain.gasSeen[0]).toBe(
      scoreGas(DEFAULT_RELAY_POLICY, 5000) + DEFAULT_RELAY_POLICY.walletGasOverhead,
    );
  });

  it("does not create a second run for the same tape", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    expect(engine.enqueue(run).created).toBe(false);
    await engine.tick();
    await chain.mine();
    await engine.tick();
    expect(chain.signed.size).toBe(1);
  });

  it("maps a failed receipt to rejected with the contract reason", async () => {
    const run = await newRun(shortTape);
    chain.best.set(`${run.playerAddress}:${seedId}`, 5_000);
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    await engine.tick();
    const done = store.requireRun(run.runId);
    expect(done.status).toBe("rejected");
    expect(done.error).toBe("NotImproved");
    expect(confirmed).toHaveLength(0);
  });

  it("retries a relay fault (NotRelay) with new transactions, then fails", async () => {
    const run = await newRun(shortTape);
    chain.forceFailure = "NotRelay";
    engine.enqueue(run);
    for (let i = 0; i < DEFAULT_RELAY_POLICY.maxAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await engine.tick();
      // eslint-disable-next-line no-await-in-loop
      await chain.mine();
      // eslint-disable-next-line no-await-in-loop
      await engine.tick();
    }
    const done = store.requireRun(run.runId);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("NotRelay");
    expect(chain.signed.size).toBe(DEFAULT_RELAY_POLICY.maxAttempts);
    // Once the relay is allowed, a new POST queues the failed run again and it confirms.
    chain.forceFailure = null;
    expect(engine.enqueue(run).run.status).toBe("queued");
    await engine.tick();
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
  });

  it("moves a committed run without a receipt to unknown, frees the slot, and reconciles it", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    const txHash = store.requireRun(run.runId).txHash ?? "";
    const receipt = chain.receipts.get(txHash);
    chain.receipts.delete(txHash);
    chain.claimed.clear(); // as if the claim read cannot see it either
    const relay = (engine as unknown as { deps: { chain: RelayChainLike } }).deps.chain;
    const committedAt = chain.height;
    relay.status = async () => ({ status: "committed", blockHeight: committedAt });
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("submitting");
    await chain.mine(DEFAULT_RELAY_POLICY.receiptGraceBlocks + 1n);
    await engine.tick();
    const stuck = store.requireRun(run.runId);
    expect(stuck.status).toBe("unknown");
    expect(stuck.error).toContain("no receipt");
    expect(store.submitting()).toHaveLength(0);
    expect(chain.signed.size).toBe(1);
    // A later check finds the receipt and settles the run; it never re-sent.
    if (receipt) chain.receipts.set(txHash, receipt);
    now += DEFAULT_RELAY_POLICY.reconcileBaseMs;
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
    expect(chain.signed.size).toBe(1);
  });

  it("moves a long-pending transaction to unknown and backs off its checks", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    const relay = (engine as unknown as { deps: { chain: RelayChainLike } }).deps.chain;
    relay.status = async () => ({ status: "pending" });
    now += DEFAULT_RELAY_POLICY.attentionAfterMs + 1;
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("unknown");
    const first = store.requireRun(run.runId).nextAttemptAt;
    now = first;
    await engine.tick();
    const second = store.requireRun(run.runId);
    expect(second.checks).toBe(1);
    expect(second.nextAttemptAt - now).toBe(DEFAULT_RELAY_POLICY.reconcileBaseMs * 2);
    // Ops may re-dispatch only once the transaction is provably dead.
    expect((await engine.canRedispatch(second)).ok).toBe(false);
  });

  it("keeps a deterministic fault final: a re-POST does not queue it", async () => {
    chain.forceFault = true;
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId)).toMatchObject({ status: "failed", final: true });
    expect(engine.enqueue(run).run.status).toBe("failed");
  });

  it("never replaces a transaction once its commitment is known", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    // Commitment is visible, but the receipt lags (indexer).
    const txHash = store.requireRun(run.runId).txHash ?? "";
    const receipt = chain.receipts.get(txHash);
    chain.receipts.delete(txHash);
    const status = chain.relayChain().status;
    const relay = (engine as unknown as { deps: { chain: { status: typeof status } } }).deps.chain;
    relay.status = async () => ({ status: "committed", blockHeight: chain.height });
    await engine.tick();
    expect(store.requireRun(run.runId).committedHeight).toBe(chain.height.toString());
    // Now status says unknown and expiry passes: still no replacement.
    relay.status = async () => ({ status: "unknown" });
    await chain.mine(20n);
    await engine.tick();
    await engine.tick();
    expect(chain.signed.size).toBe(1);
    expect(store.requireRun(run.runId).status).toBe("submitting");
    // The receipt shows up and settles the run.
    if (receipt) chain.receipts.set(txHash, receipt);
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
  });

  it("does not treat a refused re-send as proof of non-admission", async () => {
    chain.dropBroadcasts = true;
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    now += DEFAULT_RELAY_POLICY.rebroadcastAfterMs;
    chain.broadcastPlan.push({ kind: "rejected", reason: "transactionRejected" });
    await engine.tick();
    const after = store.requireRun(run.runId);
    expect(after.status).toBe("submitting");
    expect(after.attempts).toBe(1);
  });

  it("retries an out-of-gas fault once with 1.5x gas, then confirms", async () => {
    const run = await newRun(mediumTape);
    const first = scoreGas(DEFAULT_RELAY_POLICY, 5000) + DEFAULT_RELAY_POLICY.walletGasOverhead;
    chain.minGasToSucceed = first + 1n;
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    // Out of gas: the same tick queues the run again and signs one new
    // transaction with 1.5x child gas.
    await engine.tick();
    const after = store.requireRun(run.runId);
    expect(after).toMatchObject({ status: "submitting", oogRetries: 1, attempts: 2 });
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
    expect(chain.gasSeen).toEqual([
      first,
      (scoreGas(DEFAULT_RELAY_POLICY, 5000) * 25n) / 10n + DEFAULT_RELAY_POLICY.walletGasOverhead,
    ]);
  });

  it("treats a wallet abort that used the whole child budget as out of gas (devnet case)", async () => {
    const run = await newRun(mediumTape);
    const first = scoreGas(DEFAULT_RELAY_POLICY, 5000) + DEFAULT_RELAY_POLICY.walletGasOverhead;
    chain.minGasToSucceed = first + 1n;
    chain.childOutOfGasAborts = true;
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId)).toMatchObject({ status: "submitting", oogRetries: 1 });
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
    expect(chain.signed.size).toBe(2);
  });

  it("fails after a second out-of-gas fault, and at once on any other fault", async () => {
    const run = await newRun(mediumTape);
    chain.minGasToSucceed = 10n ** 12n;
    engine.enqueue(run);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await engine.tick();
      // eslint-disable-next-line no-await-in-loop
      await chain.mine();
    }
    await engine.tick();
    const done = store.requireRun(run.runId);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("out of gas");
    expect(chain.signed.size).toBe(2);

    chain.minGasToSucceed = null;
    chain.forceFault = true;
    const other = await newRun(shortTape);
    engine.enqueue(other);
    await engine.tick();
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(other.runId)).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("re-broadcasts the same bytes while the transaction can still commit", async () => {
    chain.dropBroadcasts = true;
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    now += DEFAULT_RELAY_POLICY.rebroadcastAfterMs;
    chain.dropBroadcasts = false;
    await engine.tick();
    expect(chain.broadcasts).toHaveLength(2);
    expect(chain.broadcasts[0]).toBe(chain.broadcasts[1]);
    expect(chain.signed.size).toBe(1);
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
  });

  it("signs a new transaction only after the old one expired", async () => {
    chain.dropBroadcasts = true;
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    const first = store.requireRun(run.runId).txHash;

    // Still inside expiry + margin: no new transaction.
    await chain.mine(5n);
    await engine.tick();
    expect(chain.signed.size).toBe(1);

    chain.dropBroadcasts = false;
    await chain.mine(3n); // tip > expiry + margin
    await engine.tick(); // requeue
    await engine.tick(); // new attempt
    const second = store.requireRun(run.runId);
    expect(second.attempts).toBe(2);
    expect(second.txHash).not.toBe(first);
    await chain.mine();
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
  });

  it("confirms instead of re-submitting when an old attempt committed unseen", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    await engine.tick();
    await chain.mine();
    // Lose the receipt and the status, as if the RPC forgot them.
    const txHash = store.requireRun(run.runId).txHash ?? "";
    chain.receipts.delete(txHash);
    await chain.mine(8n);
    await engine.tick();
    expect(store.requireRun(run.runId).status).toBe("confirmed");
    expect(chain.signed.size).toBe(1);
  });

  it("retries a refused broadcast and fails after max attempts", async () => {
    const run = await newRun(shortTape);
    engine.enqueue(run);
    for (let attempt = 0; attempt < DEFAULT_RELAY_POLICY.maxAttempts; attempt += 1) {
      chain.broadcastPlan.push({ kind: "rejected", reason: "insufficient free HOG" });
      // eslint-disable-next-line no-await-in-loop
      await engine.tick();
    }
    const done = store.requireRun(run.runId);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("insufficient free HOG");
    // A failed run can be queued again.
    expect(engine.enqueue(run).run.status).toBe("queued");
  });

  it("keeps at most maxInFlight transactions in flight", async () => {
    for (const byte of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      engine.enqueue({ ...(await newRun(shortTape, byte)), runId: `${byte}`.repeat(64) });
      tapes.set(`${byte}`.repeat(64), shortTape);
    }
    await engine.tick();
    expect(store.submitting()).toHaveLength(DEFAULT_RELAY_POLICY.maxInFlight);
  });

  it("touches a missing seed and records it after the receipt", async () => {
    const next = seedId + 7;
    chain.seeds.clear();
    const touch = await engine.touchSeed(next);
    expect(touch.seed).toBeNull();
    expect(touch.txHash).not.toBeNull();
    // A second touch for the same epoch reuses the pending transaction.
    expect((await engine.touchSeed(next)).txHash).toBe(touch.txHash);
    await chain.mine();
    // The fake creates the seed for the block's epoch; make it the one asked for.
    const created = [...chain.seeds.values()][0] ?? 0;
    chain.seeds.set(next, created);
    await engine.tick();
    expect(seeds).toEqual([[next, created]]);
    expect(store.getSeedTouch()).toBeNull();
  });
});
