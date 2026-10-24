// Chain shapes the relay engine and indexer use. Only worker/chain/ maps
// SDK (wire 14) values into these, so tests can fake the chain simply.
// Identifiers are base58 strings; payloads are bytes.

export type ExecutionOutcome =
  | "return"
  | "abort"
  | "fault"
  | "nonDeterministicError"
  | "failedGasSponsorship"
  | "other";

/** A committed receipt. A committed receipt can describe failed execution. */
export interface ChainReceipt {
  txHash: string;
  blockHeight: bigint;
  outcome: ExecutionOutcome;
  abortData: Uint8Array | null;
  gasUsed: bigint;
  /** The SDK receipt, for event decoding in the score adapter. */
  raw: unknown;
}

/** `getTransactionStatus`. Only `committed` is proof of commitment. */
export type ChainStatus =
  | { status: "pending" }
  | { status: "committed"; blockHeight: bigint }
  | { status: "retry" | "dropped"; error: { source: string; code: number } }
  | { status: "recentFailure" }
  | { status: "unknown" }
  | { status: "other" };
