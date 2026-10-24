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
  /** Child gas cap for the one retry after an out-of-gas fault. */
  gasRetryMax: bigint;
  /** Multiplier (in tenths) for that retry: 25 = 2.5x. */
  gasRetryTenths: bigint;
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
  /** A transaction still unsettled this long after signing becomes `unknown`. */
  attentionAfterMs: number;
  /** Blocks after a known commitment to wait for its receipt. */
  receiptGraceBlocks: bigint;
  /** Re-check backoff for `unknown` runs: first wait, then doubling up to the max. */
  reconcileBaseMs: number;
  reconcileMaxMs: number;
}

export const DEFAULT_RELAY_POLICY: RelayPolicy = {
  // Measured up to 110.9M for a searched worst-case 36,000-frame tape
  // (kt-core round 6, asteroids-core/tests/fixtures/gas-worst/); normal games
  // use 1,758–2,501 per frame. Gas is reserved, not burned: 36,000 frames ->
  // 167M (16.7 HOG free per in-flight transaction).
  gasBase: 5_000_000n,
  gasPerFrame: 4_500n,
  gasMax: 167_000_000n,
  gasRetryMax: 400_000_000n,
  gasRetryTenths: 25n,
  walletGasOverhead: 100_000n,
  seedTouchGas: 1_000_000n,
  expiryBlocks: 120n,
  expiryMarginBlocks: 10n,
  maxInFlight: 1,
  maxAttempts: 5,
  rebroadcastAfterMs: 15_000,
  retryDelayMs: 5_000,
  attentionAfterMs: 15 * 60_000,
  receiptGraceBlocks: 30n,
  reconcileBaseMs: 60_000,
  reconcileMaxMs: 60 * 60_000,
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

    for (const run of store.dueUnknown(this.deps.now(), 10)) {
      // eslint-disable-next-line no-await-in-loop -- one relay key; check in order
      await this.reconcile(run).catch((error: unknown) => {
        this.log(`reconcile ${run.runId.slice(0, 12)} failed: ${safeErrorMessage(error)}`);
        this.backoff(run);
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
    const childGas = run.gasOverride ? BigInt(run.gasOverride) : scoreGas(policy, run.frameCount);
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
    const gasLimit = childGas + policy.walletGasOverhead;
    const signed = await chain.sign(invocation, gasLimit, expiry);
    store.recordAttempt(
      run.runId,
      {
        txHash: signed.txHash,
        signedTx: signed.signedTx,
        expiryHeight: expiry.toString(),
        gasLimit: gasLimit.toString(),
      },
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
    }
    const committed =
      status.status === "committed"
        ? status.blockHeight
        : run.committedHeight !== null
          ? BigInt(run.committedHeight)
          : null;
    if (committed !== null) {
      // Known commitment: wait for the receipt, but not forever (an RPC can
      // lose it). Past the grace, a claimed tape proves success; otherwise
      // the run needs attention.
      if ((await getTip()) <= committed + policy.receiptGraceBlocks) {
        return;
      }
      if (await score.isClaimed(run.runId, committed)) {
        this.confirmWithoutEvent(run);
        return;
      }
      this.markUnknown(
        run,
        `committed at block ${committed} but no receipt, and the tape is not claimed`,
      );
      return;
    }
    if (status.status === "pending") {
      if (this.deps.now() - (run.attemptAt ?? this.deps.now()) > policy.attentionAfterMs) {
        this.markUnknown(run, "transaction still pending after the attention timeout");
      }
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
      this.confirmWithoutEvent(run);
      return;
    }
    this.retryOrFail(run.runId, `transaction ${shortHash(txHash)} expired without a receipt`);
  }

  /** The tape is claimed on chain; the indexer fills in the event details. */
  private confirmWithoutEvent(run: RunRecord): void {
    this.deps.store.confirm(
      run.runId,
      { score: run.claimedScore, previousBest: null, minted: null, blockHeight: null },
      this.deps.now(),
    );
  }

  private markUnknown(run: RunRecord, reason: string): void {
    this.log(`run ${run.runId.slice(0, 12)} needs attention: ${reason}`);
    this.deps.store.markUnknown(
      run.runId,
      reason,
      this.deps.now() + this.deps.policy.reconcileBaseMs,
      this.deps.now(),
    );
  }

  private backoff(run: RunRecord): void {
    const { policy } = this.deps;
    const wait = Math.min(
      policy.reconcileBaseMs * 2 ** Math.min(run.checks + 1, 20),
      policy.reconcileMaxMs,
    );
    this.deps.store.scheduleCheck(run.runId, this.deps.now() + wait, this.deps.now());
  }

  /**
   * Re-checks an `unknown` run: a receipt settles it; a claimed tape confirms
   * it; else check again later. It never signs a new transaction.
   */
  private async reconcile(run: RunRecord): Promise<void> {
    const { chain, score } = this.deps;
    if (run.txHash) {
      const receipt = await chain.receipt(run.txHash);
      if (receipt) {
        await this.settle(run, run.txHash, receipt);
        return;
      }
    }
    const floor = run.committedHeight ? BigInt(run.committedHeight) : undefined;
    if (await score.isClaimed(run.runId, floor)) {
      this.confirmWithoutEvent(run);
      return;
    }
    this.backoff(run);
  }

  /**
   * Ops: may an `unknown` run get a new transaction? Only when its current
   * transaction is provably dead or failed: no receipt, the tape not claimed,
   * and either a known commitment (a committed failure; claim reads at that
   * height) or the tip past its expiry plus the margin with no commitment.
   */
  async canRedispatch(run: RunRecord): Promise<{ ok: boolean; reason: string }> {
    const { chain, score, policy } = this.deps;
    if (run.txHash && (await chain.receipt(run.txHash))) {
      return { ok: false, reason: "a receipt exists; the next check settles the run" };
    }
    const committed = run.committedHeight ? BigInt(run.committedHeight) : null;
    if (await score.isClaimed(run.runId, committed ?? undefined)) {
      return { ok: false, reason: "the tape is claimed; the next check confirms the run" };
    }
    if (committed !== null) {
      return { ok: true, reason: "committed without success (tape not claimed at that height)" };
    }
    const status = run.txHash ? await chain.status(run.txHash) : { status: "unknown" as const };
    if (status.status === "committed" || status.status === "pending") {
      return { ok: false, reason: `transaction is ${status.status}` };
    }
    const tip = await chain.tip();
    if (tip <= BigInt(run.expiryHeight ?? "0") + policy.expiryMarginBlocks) {
      return { ok: false, reason: "transaction has not expired yet" };
    }
    return { ok: true, reason: "expired without commitment and the tape is not claimed" };
  }

  /**
   * A committed failure that is not a contract `ScoreError` changed no state.
   * Out of gas gets exactly one new transaction with more child gas
   * (RELAY_GAS_RETRY_TENTHS, default 2.5x, capped at RELAY_GAS_RETRY_MAX):
   * - a root `fault` whose gas used reached the root limit, or
   * - a root `abort` (the wallet re-throws a failed child call) whose gas used
   *   reached the child limit (root limit minus the wallet overhead).
   * A fault without out-of-gas repeats for the same input, so the run fails.
   * Other wallet aborts are relay faults (retried with the normal policy).
   */
  private settleFault(run: RunRecord, receipt: ChainReceipt, reason: string): void {
    const { store, policy } = this.deps;
    const now = this.deps.now();
    const height = receipt.blockHeight.toString();
    const limit = run.gasLimit ? BigInt(run.gasLimit) : null;
    const child = limit === null ? null : limit - policy.walletGasOverhead;
    const outOfGas =
      limit !== null &&
      child !== null &&
      (receipt.outcome === "fault" ? receipt.gasUsed >= limit : receipt.gasUsed >= child);
    if (!outOfGas || child === null) {
      if (receipt.outcome === "fault") {
        store.finish(
          run.runId,
          "failed",
          `execution fault (gas used ${receipt.gasUsed})`,
          height,
          now,
          // Repeats for the same input: final, a re-POST does not queue it again.
          true,
        );
      } else {
        this.log(`run ${run.runId.slice(0, 12)} relay fault: ${reason}`);
        this.retryOrFail(run.runId, reason);
      }
      return;
    }
    const boosted = (child * policy.gasRetryTenths) / 10n;
    const next = boosted > policy.gasRetryMax ? policy.gasRetryMax : boosted;
    if (run.oogRetries >= 1 || next <= child) {
      store.finish(
        run.runId,
        "failed",
        `out of gas: used ${receipt.gasUsed} of ${limit}`,
        height,
        now,
        true,
      );
      return;
    }
    this.log(`run ${run.runId.slice(0, 12)} out of gas at ${limit}; one retry with ${next}`);
    store.requeueWithMoreGas(
      run.runId,
      next.toString(),
      `out of gas: used ${receipt.gasUsed} of ${limit}; retrying with more gas`,
      now,
    );
  }

  private async settle(run: RunRecord, txHash: string, receipt: ChainReceipt): Promise<void> {
    const { store, score } = this.deps;
    const now = this.deps.now();
    if (receiptFailed(receipt)) {
      const failure = score.classifyFailure(receipt);
      if (receipt.outcome === "fault" || (receipt.outcome === "abort" && !failure.declared)) {
        this.settleFault(run, receipt, failure.reason);
        return;
      }
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
