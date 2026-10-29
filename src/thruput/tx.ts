// In-app transaction view. The browser reads the transaction itself, so the page
// can show Kalien details the explorer does not: lifecycle status, receipt, and the
// decoded `ScoreSubmitted` event when it is a Kalien run.
//
// Wire-14 rules: a committed receipt can still describe failed execution
// (read `execution.result`); a missing receipt after commitment can be indexer
// lag; `unknown` or `dropped` status does not prove that nothing executed.

import { hashFromBase58, toBase58 } from "@thruputchain/client";
import { decodeSubmitReceipt, getBlockTime } from "../../shared/thruput/kalien";
import { getThruputClient } from "./client";
import { idBytes } from "./ids";

export interface TxRunEvent {
  player: string;
  relay: string;
  seedId: number;
  seed: number;
  frameCount: number;
  finalScore: number;
  previousBest: number;
  newBest: number;
  /** KALIEN minted, base units (7 decimals). */
  mintedDelta: bigint;
  /** `sha256(tape)`, lowercase hex without `0x`; equals the Worker run id. */
  runId: string;
}

export interface TxView {
  /** Transaction hash, base58. */
  hash: string;
  /** `getTransactionStatus().status`: pending, committed, retry, dropped, recentFailure, unknown. */
  status: string;
  /** Commitment height (receipt or status), else null. */
  blockHeight: bigint | null;
  /** Unix seconds of the block, when the node has it. */
  blockTime: number | null;
  receiptFound: boolean;
  /** `receipt.execution.result`: return, abort, fault, ... */
  executionResult: string | null;
  gasUsed: bigint | null;
  eventCount: number;
  /** confirmed | rejected | failed for a score submission; null for other transactions. */
  scoreOutcome: "confirmed" | "rejected" | "failed" | null;
  /** Contract error name for a rejected run (for example `NotImproved`). */
  errorName: string | null;
  run: TxRunEvent | null;
  /** Status diagnostics (scheduler error, failure cause), as text. */
  note: string | null;
}

function describe(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}

/** Read one transaction from the network. Throws on a bad hash or an RPC failure. */
export async function readTransaction(hashText: string): Promise<TxView> {
  const hash = hashFromBase58(toBase58(idBytes(hashText)));
  const { client, config } = await getThruputClient();
  const [status, receipt] = await Promise.all([
    client.getTransactionStatus({ transactionHash: hash }),
    client.getTransactionReceipt({ transactionHash: hash }),
  ]);
  const statusRecord = status as {
    status?: string;
    blockHeight?: bigint;
    attemptBlockHeight?: bigint;
    error?: unknown;
    cause?: unknown;
    recentFailure?: unknown;
  };
  const view: TxView = {
    hash: toBase58(hash),
    status: statusRecord.status ?? "unsupported",
    blockHeight: receipt?.blockHeight ?? statusRecord.blockHeight ?? null,
    blockTime: null,
    receiptFound: receipt !== null,
    executionResult: null,
    gasUsed: null,
    eventCount: 0,
    scoreOutcome: null,
    errorName: null,
    run: null,
    note: describe(statusRecord.error ?? statusRecord.cause ?? statusRecord.recentFailure),
  };

  if (receipt) {
    view.executionResult = (receipt.execution as { result?: string }).result ?? "unsupported";
    view.gasUsed = BigInt(receipt.gasUsed);
    view.eventCount = receipt.events.length;
    const decoded = decodeSubmitReceipt(config, receipt, 0n);
    if (decoded.status === "confirmed" && decoded.run) {
      view.scoreOutcome = "confirmed";
      const run = decoded.run;
      view.run = {
        player: run.player,
        relay: run.relay,
        seedId: run.seedId,
        seed: run.seed,
        frameCount: run.frameCount,
        finalScore: run.finalScore,
        previousBest: run.previousBest,
        newBest: run.newBest,
        mintedDelta: run.mintedDelta,
        runId: run.tapeHash.replace(/^0x/u, "").toLowerCase(),
      };
    } else if (decoded.errorName) {
      view.scoreOutcome = "rejected";
      view.errorName = decoded.errorName;
    } else if (view.executionResult !== "return") {
      view.note = view.note ?? decoded.detail ?? null;
    }
  }

  if (view.blockHeight !== null) {
    try {
      view.blockTime = await getBlockTime(client, view.blockHeight);
    } catch {
      view.blockTime = null;
    }
  }
  return view;
}
