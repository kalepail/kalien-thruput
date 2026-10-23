import {
  addressFromHex,
  ExecResult,
  fixedBytes,
  gasAmount,
  toHex0x,
  type FixedBytes,
  type Invocation,
  type TransactionReceipt,
} from "@thruputchain/client";
import { hexToBytes } from "../hex";
import { KalienScore, kalien_score } from "../../shared/thruput/bindings/kalien-score";
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
 * implementation wraps the generated bindings; tests use a fake.
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

const methods = KalienScore.v0_1;
const events = kalien_score.v0_1.implementation;
const errorNames = new Map<bigint, string>(
  Object.entries(events.ScoreError).map(([name, code]) => [code, name]),
);

// Short, player-facing reasons for contract errors.
const ERROR_REASONS: Record<string, string> = {
  Paused: "score submissions are paused",
  UnknownSeed: "the seed for this epoch does not exist yet",
  SeedInactive: "this seed is no longer active",
  SeedMismatch: "the tape seed does not match the epoch seed",
  BadSignature: "the claim signature does not verify",
  AlreadyClaimed: "this tape was already claimed",
  ZeroScore: "a score of 0 cannot be claimed",
  NotImproved: "the score does not beat your best for this seed",
  RuleViolation: "the tape breaks the game rules",
  FrameCountMismatch: "the replayed frame count does not match the tape",
  ScoreMismatch: "the replayed score does not match the tape",
};

function hex(bytes: Uint8Array): string {
  return toHex0x(bytes);
}

function bytes32(value: string): FixedBytes<32> {
  return fixedBytes(hexToBytes(value), 32);
}

function toScoreSubmitted(event: kalien_score.v0_1.implementation.ScoreSubmitted): ScoreSubmitted {
  const { fields, topics } = event;
  return {
    player: hex(topics.player),
    seedId: Number(topics.seed_id),
    seed: Number(fields.seed) >>> 0,
    frameCount: Number(fields.frame_count),
    finalScore: Number(fields.final_score),
    previousBest: Number(fields.previous_best),
    newBest: Number(fields.new_best),
    mintedDelta: fields.minted_delta,
    tapeHash: hex(fields.tape_hash),
  };
}

/** A failed receipt as text: the contract error name when the abort data has one. */
export function describeScoreFailure(receipt: TransactionReceipt): string {
  if (receipt.abortData && receipt.abortData.length > 0) {
    try {
      const exception = methods.submitScore.decodeException(receipt.abortData);
      if (exception.kind === "declared") {
        const name =
          exception.variant ?? errorNames.get(exception.value) ?? `ScoreError ${exception.value}`;
        return ERROR_REASONS[name] ? `${name}: ${ERROR_REASONS[name]}` : name;
      }
    } catch {
      // Not a ScoreError payload; fall through.
    }
  }
  const status = receipt.executionStatus;
  if (status?.result === "reverted") {
    return status.message ? `reverted: ${status.message}` : "reverted";
  }
  if (status?.result === "deterministicError") {
    return `execution fault: ${status.kind}`;
  }
  return `execution failed (${ExecResult[receipt.execResult] ?? receipt.execResult})`;
}

export const createScoreContract: ScoreContractFactory = (client, address) => {
  const contract = addressFromHex(address);
  return {
    address: hex(contract),
    submitScoreInvocation(args, gas) {
      return methods.submitScore.invocation(contract, gasAmount(gas), {
        playerPubkey: fixedBytes(args.playerPubkey, 32),
        seedId: BigInt(args.seedId),
        tape: args.tape,
        signature: fixedBytes(args.signature, 64),
      });
    },
    currentSeedInvocation(gas) {
      return methods.ensureCurrentSeed.invocation(contract, gasAmount(gas));
    },
    async seedFor(seedId) {
      const result = await methods.seed.view({
        client,
        contract,
        args: { seedId: BigInt(seedId) },
      });
      return result.value === null ? null : Number(result.value) >>> 0;
    },
    async bestScore(playerAddress, seedId) {
      const result = await methods.bestScore.view({
        client,
        contract,
        args: { player: addressFromHex(playerAddress), seedId: BigInt(seedId) },
      });
      return Number(result.value);
    },
    async isClaimed(tapeHash) {
      const result = await methods.isClaimed.view({
        client,
        contract,
        args: { tapeHash: bytes32(tapeHash) },
      });
      return result.value;
    },
    scoreSubmittedFromReceipt(receipt) {
      const [event] = events.ScoreSubmitted.allFromReceipt(receipt, { contractAddress: contract });
      return event ? toScoreSubmitted(event) : null;
    },
    describeFailure: describeScoreFailure,
    async scoreEvents({ fromHeight, cursor, limit }) {
      const page = await client.getContractEvents({
        event: events.ScoreSubmitted,
        contractAddresses: [contract],
        order: "ascending",
        anchor: { height: fromHeight },
        cursor,
        limit,
      });
      return {
        events: page.events.map((event) => ({
          ...toScoreSubmitted(event),
          txHash: hex(event.txHash),
          blockHeight: event.blockHeight,
          sequenceNumber: event.sequenceNumber,
        })),
        cursor: page.cursor,
        latestBlock: page.latestBlock,
        oldestBlock: page.oldestBlock,
      };
    },
  };
};
