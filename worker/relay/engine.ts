import type { Invocation } from "@thruputchain/client";
import type { ChainReceipt, ChainStatus } from "../chain/types";
import { hexToBytes } from "../hex";
import { safeErrorMessage } from "../utils";
import type { ScoreContract, ScoreSubmitted } from "../chain/score-contract";
import type { NewRun, RelayStore, RunRecord } from "./store";

export type BroadcastResult =
  | { kind: "accepted" }
  /** The gateway refused the bytes; the transaction was not admitted. */
  | { kind: "rejected"; reason: string }
  /** No clear answer (timeout, overload). The transaction may be admitted. */
  | { kind: "unknown"; reason: string };

/** Signing and RPC access for one relay key. */
export interface RelayChain {
  readonly address: string;
  tip(): Promise<bigint>;
  sign(
    invocation: Invocation,
    gasLimit: bigint,
    expiryHeight: bigint,
  ): Promise<{ txHash: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<BroadcastResult>;
  receipt(txHash: string): Promise<ChainReceipt | null>;
  status(txHash: string): Promise<ChainStatus>;
  /** Block time in ms since the epoch. */
  blockTimeMs(height: bigint): Promise<number>;
}

export interface RelayPolicy {
  /** Gas for the score contract call: base + perFrame * frames, capped at max. */
  gasBase: bigint;
  gasPerFrame: bigint;
  gasMax: bigint;
  /** Root gas on top of the child call, for the DefaultWallet wrapper. */
  walletGasOverhead: bigint;
  seedTouchGas: bigint;
  /** A signed transaction expires this many blocks after the tip. */
  expiryBlocks: bigint;
  /** Blocks past expiry before an attempt is treated as dead. */
  expiryMarginBlocks: bigint;
  maxInFlight: number;
  maxAttempts: number;
  rebroadcastAfterMs: number;
  retryDelayMs: number;
}

export const DEFAULT_RELAY_POLICY: RelayPolicy = {
  // kt-core measured up to 2,101 gas per frame and 74M for a 36,000-frame
  // tape (docs/thruput/kt-core.md). Base covers signature, storage, and mint.
  gasBase: 3_000_000n,
  gasPerFrame: 2_300n,
  gasMax: 90_000_000n,
  walletGasOverhead: 100_000n,
  seedTouchGas: 1_000_000n,
  expiryBlocks: 120n,
  expiryMarginBlocks: 10n,
  maxInFlight: 1,
  maxAttempts: 5,
  rebroadcastAfterMs: 15_000,
  retryDelayMs: 5_000,
};

export interface ConfirmedRun {
  run: RunRecord;
  event: ScoreSubmitted;
  txHash: string;
  blockHeight: bigint;
  closedAtMs: number;
}

export interface RelayDeps {
  store: RelayStore;
  chain: RelayChain;
  score: ScoreContract;
  policy: RelayPolicy;
  loadTape(runId: string): Promise<Uint8Array | null>;
  onConfirmed(confirmed: ConfirmedRun): Promise<void>;
  onSeed(seedId: number, seed: number): Promise<void>;
  now(): number;
  log?(message: string): void;
}

export interface TickResult {
  /** Next time the relay has work, or null when idle. */
  nextAt: number | null;
}

export function scoreGas(policy: RelayPolicy, frameCount: number): bigint {
  const gas = policy.gasBase + policy.gasPerFrame * BigInt(frameCount);
  return gas > policy.gasMax ? policy.gasMax : gas;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

export function receiptFailed(receipt: ChainReceipt): boolean {
  return receipt.outcome !== "return";
}

/** One poll interval while transactions are in flight. */
const POLL_MS = 2_000;

/**
 * Relay state machine. It signs, journals, broadcasts, and observes
 * `submit_score` transactions for one relay key.
 *
 * Safety rules:
 * - A signed transaction is written to the journal before broadcast.
 * - A run gets a new transaction only after the old one is dead: its expiry
 *   height is behind the tip, it has no receipt, and the tape is not claimed.
 * - The same signed bytes may be broadcast again; they have the same hash.
 * The contract also rejects a claimed tape hash, so a run never mints twice.
 */
export class RelayEngine {
  constructor(private readonly deps: RelayDeps) {}

  enqueue(run: NewRun): { run: RunRecord; created: boolean } {
    return this.deps.store.enqueue(run, this.deps.now());
  }

  async tick(): Promise<TickResult> {
    const { store, policy } = this.deps;
    let tip: bigint | null = null;
    const getTip = async () => (tip ??= await this.deps.chain.tip());

    for (const run of store.submitting()) {
      // eslint-disable-next-line no-await-in-loop -- one relay key; observe in order
      await this.observe(run, getTip).catch((error: unknown) => {
        this.log(`observe ${run.runId.slice(0, 12)} failed: ${safeErrorMessage(error)}`);
      });
    }

    await this.observeSeedTouch(getTip).catch((error: unknown) => {
      this.log(`seed touch observe failed: ${safeErrorMessage(error)}`);
    });

    const free = policy.maxInFlight - store.submitting().length;
    if (free > 0) {
      for (const run of store.dueQueued(this.deps.now(), free)) {
        // eslint-disable-next-line no-await-in-loop -- sign and journal one at a time
        await this.submit(run, getTip).catch((error: unknown) => {
          const reason = safeErrorMessage(error);
          this.log(`submit ${run.runId.slice(0, 12)} failed: ${reason}`);
          this.retryOrFail(run.runId, `relay error: ${reason}`);
        });
      }
    }

    return { nextAt: this.nextAt() };
  }

  /** Submits a `current_seed` transaction unless the epoch already has a seed. */
  async touchSeed(seedId: number): Promise<{ seed: number | null; txHash: string | null }> {
    const existing = await this.deps.score.seedFor(seedId);
    if (existing !== null) {
      await this.deps.onSeed(seedId, existing);
      return { seed: existing, txHash: null };
    }
    const pending = this.deps.store.getSeedTouch();
    if (pending && pending.seedId === seedId) {
      return { seed: null, txHash: pending.txHash };
    }
    const tip = await this.deps.chain.tip();
    const expiry = tip + this.deps.policy.expiryBlocks;
    const gas = this.deps.policy.seedTouchGas;
    const signed = await this.deps.chain.sign(
      this.deps.score.currentSeedInvocation(gas),
      gas + this.deps.policy.walletGasOverhead,
      expiry,
    );
    this.deps.store.setSeedTouch({
      seedId,
      txHash: signed.txHash,
      expiryHeight: expiry.toString(),
      createdAt: this.deps.now(),
    });
    const result = await this.deps.chain.broadcast(signed.signedTx);
    if (result.kind === "rejected") {
      this.deps.store.setSeedTouch(null);
      throw new Error(`seed touch rejected: ${result.reason}`);
    }
    return { seed: null, txHash: signed.txHash };
  }

  private nextAt(): number | null {
    const { store } = this.deps;
    if (store.submitting().length > 0 || store.getSeedTouch()) {
      return this.deps.now() + POLL_MS;
    }
    return store.nextQueuedAt();
  }

  private log(message: string): void {
    this.deps.log?.(`[relay] ${message}`);
  }

  private retryOrFail(runId: string, reason: string): void {
    const { store, policy } = this.deps;
    const run = store.getRun(runId);
    if (!run) {
      return;
    }
    const now = this.deps.now();
    if (run.attempts >= policy.maxAttempts) {
      store.finish(runId, "failed", reason, null, now);
    } else {
      store.requeue(runId, reason, now + policy.retryDelayMs * Math.max(1, run.attempts), now);
    }
  }

  private async submit(run: RunRecord, getTip: () => Promise<bigint>): Promise<void> {
    const { store, chain, score, policy } = this.deps;
    if (run.attempts > 0 && (await score.isClaimed(run.runId))) {
      // An earlier attempt committed after all. The indexer fills in the
      // event details for the leaderboard.
      store.confirm(
        run.runId,
        { score: run.claimedScore, previousBest: null, minted: null, blockHeight: null },
        this.deps.now(),
      );
      return;
    }
    const tape = await this.deps.loadTape(run.runId);
    if (!tape) {
      store.finish(run.runId, "failed", "tape is missing from storage", null, this.deps.now());
      return;
    }
    const childGas = scoreGas(policy, run.frameCount);
    const invocation = score.submitScoreInvocation(
      {
        playerPubkey: hexToBytes(run.playerPubkey),
        seedId: run.seedId,
        tape,
        signature: hexToBytes(run.signature),
      },
      childGas,
    );
    const expiry = (await getTip()) + policy.expiryBlocks;
    const signed = await chain.sign(invocation, childGas + policy.walletGasOverhead, expiry);
    store.recordAttempt(
      run.runId,
      { txHash: signed.txHash, signedTx: signed.signedTx, expiryHeight: expiry.toString() },
      this.deps.now(),
    );
    this.log(
      `run ${run.runId.slice(0, 12)} attempt ${run.attempts + 1} tx ${shortHash(signed.txHash)}`,
    );
    await this.broadcast(run.runId, signed.signedTx, true);
  }

  /**
   * Sends signed bytes. `firstSend` is true for the first send of these bytes:
   * only then does a refusal prove they were never admitted.
   */
  private async broadcast(runId: string, signedTx: string, firstSend: boolean): Promise<void> {
    const { store } = this.deps;
    const result = await this.deps.chain.broadcast(signedTx);
    if (result.kind === "rejected" && firstSend) {
      // Never admitted, so this hash cannot commit. A new attempt is safe.
      this.retryOrFail(runId, `relay transaction refused: ${result.reason}`);
      return;
    }
    // Accepted, unknown, or a refusal of bytes that an earlier send may have
    // admitted: keep the journal entry; observation decides what happened.
    store.markBroadcast(runId, this.deps.now());
    if (result.kind !== "accepted") {
      this.log(`send for ${runId.slice(0, 12)} not accepted: ${result.reason}`);
    }
  }

  /**
   * Follows a submitted transaction (wire-14 rules): a receipt settles it;
   * known commitment means wait for the receipt (indexer lag); `retry`,
   * `dropped`, `unknown` and refusals do not prove non-execution, so the same
   * bytes are re-sent until their expiry height. Only after expiry (plus a
   * margin), with no receipt and the tape not claimed at a snapshot past that
   * height, does the run get a new transaction. The contract rejects a claimed
   * tape hash, so even then a run cannot mint twice.
   */
  private async observe(run: RunRecord, getTip: () => Promise<bigint>): Promise<void> {
    const { store, chain, score, policy } = this.deps;
    const txHash = run.txHash;
    if (!txHash) {
      store.requeue(run.runId, "missing transaction hash", this.deps.now(), this.deps.now());
      return;
    }
    const receipt = await chain.receipt(txHash);
    if (receipt) {
      await this.settle(run, txHash, receipt);
      return;
    }

    const status = await chain.status(txHash);
    if (status.status === "committed") {
      store.markCommitted(run.runId, status.blockHeight.toString(), this.deps.now());
      return;
    }
    if (status.status === "pending" || run.committedHeight !== null) {
      return;
    }
    const expiry = BigInt(run.expiryHeight ?? "0");
    const tip = await getTip();
    if (tip <= expiry + policy.expiryMarginBlocks) {
      const sinceBroadcast = this.deps.now() - (run.lastBroadcastAt ?? 0);
      if (run.signedTx && tip <= expiry && sinceBroadcast >= policy.rebroadcastAfterMs) {
        await this.broadcast(run.runId, run.signedTx, false);
      }
      return;
    }
    if (await score.isClaimed(run.runId, expiry + 1n)) {
      store.confirm(
        run.runId,
        { score: run.claimedScore, previousBest: null, minted: null, blockHeight: null },
        this.deps.now(),
      );
      return;
    }
    this.retryOrFail(run.runId, `transaction ${shortHash(txHash)} expired without a receipt`);
  }

  private async settle(run: RunRecord, txHash: string, receipt: ChainReceipt): Promise<void> {
    const { store, score } = this.deps;
    const now = this.deps.now();
    if (receiptFailed(receipt)) {
      const failure = score.classifyFailure(receipt);
      if (failure.relayFault) {
        // The run itself may be fine: the committed failure changed nothing,
        // so a new attempt is safe (it checks is_claimed first).
        this.log(`run ${run.runId.slice(0, 12)} relay fault: ${failure.reason}`);
        this.retryOrFail(run.runId, failure.reason);
        return;
      }
      store.finish(run.runId, "rejected", failure.reason, receipt.blockHeight.toString(), now);
      return;
    }
    const event = score.scoreSubmittedFromReceipt(receipt);
    if (!event) {
      store.finish(
        run.runId,
        "failed",
        "transaction succeeded but emitted no ScoreSubmitted event",
        receipt.blockHeight.toString(),
        now,
      );
      return;
    }
    store.confirm(
      run.runId,
      {
        score: event.newBest,
        previousBest: event.previousBest,
        minted: event.mintedDelta.toString(),
        blockHeight: receipt.blockHeight.toString(),
      },
      now,
    );
    const closedAtMs = await this.deps.chain.blockTimeMs(receipt.blockHeight).catch(() => now);
    await this.deps
      .onConfirmed({
        run: store.requireRun(run.runId),
        event,
        txHash,
        blockHeight: receipt.blockHeight,
        closedAtMs,
      })
      .catch((error: unknown) => {
        // The indexer writes the same row later.
        this.log(
          `leaderboard write for ${run.runId.slice(0, 12)} failed: ${safeErrorMessage(error)}`,
        );
      });
  }

  private async observeSeedTouch(getTip: () => Promise<bigint>): Promise<void> {
    const { store, chain, score, policy } = this.deps;
    const touch = store.getSeedTouch();
    if (!touch) {
      return;
    }
    const receipt = await chain.receipt(touch.txHash);
    if (receipt) {
      store.setSeedTouch(null);
      if (receiptFailed(receipt)) {
        this.log(`seed touch for ${touch.seedId} failed: ${score.classifyFailure(receipt).reason}`);
      }
      const seed = await score.seedFor(touch.seedId);
      if (seed !== null) {
        await this.deps.onSeed(touch.seedId, seed);
      }
      return;
    }
    if ((await getTip()) > BigInt(touch.expiryHeight) + policy.expiryMarginBlocks) {
      store.setSeedTouch(null);
    }
  }
}
