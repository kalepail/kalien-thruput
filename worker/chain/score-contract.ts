import type { Invocation, TransactionReceipt } from "@thruputchain/client";
import type { ChainClient } from "./network";

export interface SubmitScoreArgs {
  playerPubkey: Uint8Array;
  seedId: number;
  tape: Uint8Array;
  signature: Uint8Array;
}

/** Decoded `ScoreSubmitted` event. Addresses and hashes are 0x hex. */
export interface ScoreSubmitted {
  player: string;
  seedId: number;
  seed: number;
  frameCount: number;
  finalScore: number;
  previousBest: number;
  newBest: number;
  /** KALIEN base units (7 decimals). */
  mintedDelta: bigint;
  tapeHash: string;
}

export interface IndexedScoreSubmitted extends ScoreSubmitted {
  txHash: string;
  blockHeight: bigint;
  sequenceNumber: number;
}

export interface ScoreEventPage {
  events: IndexedScoreSubmitted[];
  /** Empty means this walk is exhausted. */
  cursor: Uint8Array;
  latestBlock: bigint;
  oldestBlock: bigint;
}

/**
 * The parts of the `kalien_score` contract that the Worker uses. The real
 * implementation wraps the generated bindings in `shared/thruput/`; tests use
 * a fake.
 */
export interface ScoreContract {
  readonly address: string;
  submitScoreInvocation(args: SubmitScoreArgs, gas: bigint): Invocation;
  currentSeedInvocation(gas: bigint): Invocation;
  /** Stored seed for an epoch, or null when nothing has touched it yet. */
  seedFor(seedId: number): Promise<number | null>;
  bestScore(playerAddress: string, seedId: number): Promise<number>;
  isClaimed(tapeHash: string): Promise<boolean>;
  /** The `ScoreSubmitted` event this contract emitted in a receipt, if any. */
  scoreSubmittedFromReceipt(receipt: TransactionReceipt): ScoreSubmitted | null;
  /** A short reason for a failed receipt, from the contract's error schema. */
  describeFailure(receipt: TransactionReceipt): string;
  /** One ascending page of `ScoreSubmitted` events from `fromHeight`. */
  scoreEvents(query: {
    fromHeight: bigint;
    cursor: Uint8Array;
    limit: number;
  }): Promise<ScoreEventPage>;
}

export type ScoreContractFactory = (client: ChainClient, address: string) => ScoreContract;

/**
 * TODO(kt-contract): build this from the generated `kalien_score` bindings when
 * they land in `shared/thruput/`. Until then the Worker runs with a fake in
 * tests only.
 */
export const createScoreContract: ScoreContractFactory = () => {
  throw new Error("kalien_score bindings are not available yet");
};
