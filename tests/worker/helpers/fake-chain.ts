import { ExecResult, type TransactionReceipt, type TransactionStatus } from "@thruputchain/client";
import type { Invocation } from "@thruputchain/client";
import { claimMessage, pubkeyAccountAddress, verifyEd25519 } from "../../../worker/claim";
import type {
  IndexedScoreSubmitted,
  ScoreContract,
  ScoreSubmitted,
  SubmitScoreArgs,
} from "../../../worker/chain/score-contract";
import { bytesToHex, sha256 } from "../../../worker/hex";
import type { BroadcastResult, RelayChain } from "../../../worker/relay/engine";
import { replayTape } from "../../../worker/replay";

export const NETWORK_HASH = `0x${"11".repeat(32)}`;
export const SCORE_ADDRESS = `0x${"22".repeat(32)}`;
export const RELAY_ADDRESS = `0x${"33".repeat(32)}`;
export const BLOCK_MS = 1_000;
export const GENESIS_MS = Date.UTC(2026, 9, 1);

type FakeInvocation =
  | { kind: "submit"; args: SubmitScoreArgs; gas: bigint }
  | { kind: "seed"; gas: bigint };

interface PendingTx {
  txHash: string;
  invocation: FakeInvocation;
  expiry: bigint;
}

/** In-memory `kalien_score` contract plus a chain that mines on demand. */
export class FakeChain {
  height = 100n;
  seeds = new Map<number, number>();
  best = new Map<string, number>();
  claimed = new Set<string>();
  events: IndexedScoreSubmitted[] = [];
  receipts = new Map<string, TransactionReceipt>();
  eventsByTx = new Map<string, ScoreSubmitted>();
  signed = new Map<string, PendingTx>();
  mempool = new Map<string, PendingTx>();
  broadcasts: string[] = [];
  /** Next broadcast results to return, then "accepted". */
  broadcastPlan: BroadcastResult[] = [];
  /** When true, broadcasts are lost (not admitted) but reported as accepted. */
  dropBroadcasts = false;
  failures = new Map<string, string>();
  private counter = 0;
  readonly gasSeen: bigint[] = [];

  blockTimeMs(height: bigint): number {
    return GENESIS_MS + Number(height) * BLOCK_MS;
  }

  /** Mines one block with every admitted transaction. */
  async mine(blocks = 1n): Promise<void> {
    for (let i = 0n; i < blocks; i += 1n) {
      this.height += 1n;
      for (const tx of [...this.mempool.values()]) {
        this.mempool.delete(tx.txHash);
        if (tx.expiry < this.height) {
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await this.execute(tx);
      }
    }
  }

  private receipt(txHash: string, ok: boolean, message: string | null): TransactionReceipt {
    return {
      txHash: txHash as never,
      height: this.height,
      execResult: ok ? ExecResult.ExecResultOK : ExecResult.ExecResultTxRootFrameReverted,
      executionStatus: ok ? { result: "ok" } : { result: "reverted", message },
      events: [],
      returnData: null,
      abortData: null,
      gasUsed: 1n,
    };
  }

  private async execute(tx: PendingTx): Promise<void> {
    if (tx.invocation.kind === "seed") {
      const seedId = Math.floor(this.blockTimeMs(this.height) / 600_000);
      if (!this.seeds.has(seedId)) {
        this.seeds.set(seedId, (seedId * 2654435761) >>> 0 || 0xdeadbeef);
      }
      this.receipts.set(tx.txHash, this.receipt(tx.txHash, true, null));
      return;
    }
    const fail = (reason: string) => {
      this.failures.set(tx.txHash, reason);
      this.receipts.set(tx.txHash, this.receipt(tx.txHash, false, reason));
    };
    const { args } = tx.invocation;
    const tapeHash = bytesToHex(await sha256(args.tape));
    const seed = this.seeds.get(args.seedId);
    const replay = replayTape(args.tape);
    if (seed === undefined || seed !== replay.seed) {
      return fail("SeedMismatch");
    }
    const message = await claimMessage({
      networkHash: NETWORK_HASH,
      scoreContract: SCORE_ADDRESS,
      seedId: args.seedId,
      tape: args.tape,
    });
    if (!(await verifyEd25519(args.playerPubkey, message, args.signature))) {
      return fail("BadSignature");
    }
    if (this.claimed.has(tapeHash)) {
      return fail("AlreadyClaimed");
    }
    if (replay.replayedScore !== replay.claimedScore) {
      return fail("ScoreMismatch");
    }
    const player = pubkeyAccountAddress(args.playerPubkey);
    const key = `${player}:${args.seedId}`;
    const previousBest = this.best.get(key) ?? 0;
    if (replay.replayedScore <= previousBest) {
      return fail("NotImproved");
    }
    this.best.set(key, replay.replayedScore);
    this.claimed.add(tapeHash);
    const event: ScoreSubmitted = {
      player,
      seedId: args.seedId,
      seed,
      frameCount: replay.frameCount,
      finalScore: replay.replayedScore,
      previousBest,
      newBest: replay.replayedScore,
      mintedDelta: BigInt(replay.replayedScore - previousBest) * 10_000_000n,
      tapeHash: `0x${tapeHash}`,
    };
    this.eventsByTx.set(tx.txHash, event);
    this.events.push({
      ...event,
      txHash: tx.txHash,
      blockHeight: this.height,
      sequenceNumber: this.events.length,
    });
    this.receipts.set(tx.txHash, this.receipt(tx.txHash, true, null));
  }

  relayChain(): RelayChain {
    return {
      address: RELAY_ADDRESS,
      tip: async () => this.height,
      sign: async (invocation, gasLimit, expiryHeight) => {
        this.counter += 1;
        const txHash = `0x${this.counter.toString(16).padStart(64, "0")}`;
        this.gasSeen.push(gasLimit);
        this.signed.set(txHash, {
          txHash,
          invocation: invocation as unknown as FakeInvocation,
          expiry: expiryHeight,
        });
        return { txHash, signedTx: `signed:${txHash}` };
      },
      broadcast: async (signedTx) => {
        const txHash = signedTx.slice("signed:".length);
        this.broadcasts.push(txHash);
        const planned = this.broadcastPlan.shift();
        if (planned && planned.kind === "rejected") {
          return planned;
        }
        const tx = this.signed.get(txHash);
        if (tx && !this.dropBroadcasts && !this.receipts.has(txHash) && tx.expiry >= this.height) {
          this.mempool.set(txHash, tx);
        }
        return planned ?? { kind: "accepted" };
      },
      receipt: async (txHash) => this.receipts.get(txHash) ?? null,
      status: async (txHash): Promise<TransactionStatus> => {
        if (this.receipts.has(txHash)) {
          return { status: "committed", height: this.receipts.get(txHash)?.height };
        }
        return this.mempool.has(txHash) ? { status: "pending" } : { status: "unknown" };
      },
      blockTimeMs: async (height) => this.blockTimeMs(height),
    };
  }

  scoreContract(): ScoreContract {
    return {
      address: SCORE_ADDRESS,
      submitScoreInvocation: (args, gas) =>
        ({ kind: "submit", args, gas }) as unknown as Invocation,
      currentSeedInvocation: (gas) => ({ kind: "seed", gas }) as unknown as Invocation,
      seedFor: async (seedId) => this.seeds.get(seedId) ?? null,
      bestScore: async (player, seedId) => this.best.get(`${player}:${seedId}`) ?? 0,
      isClaimed: async (tapeHash) => this.claimed.has(tapeHash.replace(/^0x/u, "")),
      scoreSubmittedFromReceipt: (receipt) =>
        this.eventsByTx.get(receipt.txHash as unknown as string) ?? null,
      describeFailure: (receipt) =>
        this.failures.get(receipt.txHash as unknown as string) ?? "failed",
      scoreEvents: async ({ fromHeight, cursor, limit }) => {
        const start = cursor.length > 0 ? Number(new DataView(cursor.buffer).getUint32(0)) : 0;
        const matching = this.events.filter((event) => event.blockHeight >= fromHeight);
        const page = matching.slice(start, start + limit);
        const next = start + limit < matching.length ? start + limit : -1;
        const nextCursor = new Uint8Array(next < 0 ? 0 : 4);
        if (next >= 0) {
          new DataView(nextCursor.buffer).setUint32(0, next);
        }
        return { events: page, cursor: nextCursor, latestBlock: this.height, oldestBlock: 0n };
      },
    };
  }
}

/** A deterministic Ed25519 key pair for tests. */
export async function testPlayer(seedByte = 7) {
  const secret = new Uint8Array(32).fill(seedByte);
  const pkcs8 = new Uint8Array([
    ...[
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
      0x20,
    ],
    ...secret,
  ]);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  const pubkey = Uint8Array.from(
    atob((jwk.x ?? "").replace(/-/gu, "+").replace(/_/gu, "/")),
    (ch) => ch.charCodeAt(0),
  );
  return {
    pubkey,
    address: pubkeyAccountAddress(pubkey),
    sign: async (message: Uint8Array) =>
      new Uint8Array(await crypto.subtle.sign("Ed25519", key, message as Uint8Array<ArrayBuffer>)),
  };
}

export async function signClaim(
  player: Awaited<ReturnType<typeof testPlayer>>,
  seedId: number,
  tape: Uint8Array,
): Promise<Uint8Array> {
  return player.sign(
    await claimMessage({ networkHash: NETWORK_HASH, scoreContract: SCORE_ADDRESS, seedId, tape }),
  );
}
