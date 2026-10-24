import {
  addressFromBase58,
  fixedBytes,
  gasAmount,
  toBase58,
  type Invocation,
  type RpcTransactionReceipt,
} from "@thruputchain/client";
import { KalienScore, kalien_score } from "../../shared/thruput/bindings/kalien-score";
import { bytesToHex, hexToBytes } from "../hex";
import { parseId32 } from "../ids";
import type { ChainClient } from "./network";
import type { ChainReceipt } from "./types";

export interface SubmitScoreArgs {
  playerPubkey: Uint8Array;
  seedId: number;
  tape: Uint8Array;
  signature: Uint8Array;
}

/** Decoded `ScoreSubmitted` event. Addresses are base58; the tape hash is hex (no 0x). */
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
  /** Block time from the event, unix seconds. */
  submittedAt: number;
}

export interface FailureInfo {
  reason: string;
  relayFault: boolean;
}

export interface IndexedScoreSubmitted extends ScoreSubmitted {
  txHash: string;
  blockHeight: bigint;
  sequenceNumber: number;
}

export interface ScoreEventPage {
  events: IndexedScoreSubmitted[];
  /** Null ends the walk; empty pages can still have a cursor. */
  nextCursor: string | null;
  latestIndexedBlockHeight: bigint;
  oldestIndexedBlockHeight: bigint;
}

/**
 * The parts of the `kalien_score` contract that the Worker uses. The real
 * implementation wraps the generated bindings; tests use a fake.
 */
export interface ScoreContract {
  /** Base58. */
  readonly address: string;
  submitScoreInvocation(args: SubmitScoreArgs, gas: bigint): Invocation;
  currentSeedInvocation(gas: bigint): Invocation;
  /** Stored seed for an epoch, or null when nothing has touched it yet. */
  seedFor(seedId: number): Promise<number | null>;
  bestScore(playerAddress: string, seedId: number): Promise<number>;
  /** `minStateBlockHeight` makes the read see at least that block. */
  isClaimed(tapeHash: string, minStateBlockHeight?: bigint): Promise<boolean>;
  /** Whether a relay address is on the contract's allowlist. */
  isRelay(address: string): Promise<boolean>;
  /** The `ScoreSubmitted` event this contract emitted in a receipt, if any. */
  scoreSubmittedFromReceipt(receipt: ChainReceipt): ScoreSubmitted | null;
  /**
   * Why a receipt failed, and whose fault it is. A relay fault (allowlist,
   * pause, gas, storage conflict) can be retried with a new transaction; a
   * player fault (bad tape, seed, score) cannot.
   */
  classifyFailure(receipt: ChainReceipt): FailureInfo;
  /**
   * One ascending page of `ScoreSubmitted` events: a new walk from
   * `fromHeight` (inclusive) when `cursor` is null, else its continuation.
   */
  scoreEvents(query: {
    fromHeight: bigint;
    cursor: string | null;
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
  NotRelay: "this relay key is not on the contract's relay allowlist",
  TapeBadPadding: "the tape's unused padding nibble is not zero",
  RuleViolation: "the tape breaks the game rules",
  FrameCountMismatch: "the replayed frame count does not match the tape",
  ScoreMismatch: "the replayed score does not match the tape",
};

// Contract errors that say nothing about the run itself.
const RELAY_FAULTS = new Set(["Paused", "NotRelay", "NotAdmin", "AlreadyInitialized"]);

function address(value: string) {
  const bytes = parseId32(value);
  if (!bytes) {
    throw new Error(`not a 32-byte address: ${value}`);
  }
  return addressFromBase58(toBase58(bytes));
}

function toScoreSubmitted(event: kalien_score.v0_1.implementation.ScoreSubmitted): ScoreSubmitted {
  const { fields, topics } = event;
  return {
    player: toBase58(topics.player),
    seedId: Number(topics.seed_id),
    seed: Number(fields.seed) >>> 0,
    frameCount: Number(fields.frame_count),
    finalScore: Number(fields.final_score),
    previousBest: Number(fields.previous_best),
    newBest: Number(fields.new_best),
    mintedDelta: fields.minted_delta,
    tapeHash: bytesToHex(fields.tape_hash),
    submittedAt: Number(fields.submitted_at),
  };
}

/** A failed receipt: the contract error name when the abort data has one. */
export function classifyScoreFailure(receipt: ChainReceipt): FailureInfo {
  if (receipt.outcome === "abort" && receipt.abortData && receipt.abortData.length > 0) {
    try {
      const exception = methods.submitScore.decodeException(receipt.abortData);
      if (exception.kind === "declared") {
        const name =
          exception.variant ?? errorNames.get(exception.value) ?? `ScoreError ${exception.value}`;
        return {
          reason: ERROR_REASONS[name] ? `${name}: ${ERROR_REASONS[name]}` : name,
          relayFault: RELAY_FAULTS.has(name),
        };
      }
    } catch {
      // Not a ScoreError payload; fall through.
    }
  }
  // Anything else (wallet abort, fault, storage conflict, gas sponsorship) is
  // not the player's fault.
  return {
    reason:
      receipt.outcome === "abort" ? "aborted without a ScoreError" : `execution ${receipt.outcome}`,
    relayFault: true,
  };
}

export const createScoreContract: ScoreContractFactory = (client, contractId) => {
  const contract = address(contractId);
  return {
    address: toBase58(contract),
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
        address: contract,
        args: { seedId: BigInt(seedId) },
      });
      return result.value === null ? null : Number(result.value) >>> 0;
    },
    async bestScore(playerAddress, seedId) {
      const result = await methods.bestScore.view({
        client,
        address: contract,
        args: { player: address(playerAddress), seedId: BigInt(seedId) },
      });
      return Number(result.value);
    },
    async isClaimed(tapeHash, minStateBlockHeight) {
      const result = await methods.isClaimed.view({
        client,
        address: contract,
        args: { tapeHash: fixedBytes(hexToBytes(tapeHash), 32) },
        ...(minStateBlockHeight === undefined ? {} : { minStateBlockHeight }),
      });
      return result.value;
    },
    async isRelay(relay) {
      const result = await methods.isRelay.view({
        client,
        address: contract,
        args: { relay: address(relay) },
      });
      return result.value;
    },
    scoreSubmittedFromReceipt(receipt) {
      const raw = receipt.raw as RpcTransactionReceipt | null;
      if (!raw) {
        return null;
      }
      const [event] = events.ScoreSubmitted.allFromReceipt(raw, { address: contract });
      return event ? toScoreSubmitted(event) : null;
    },
    classifyFailure: classifyScoreFailure,
    async scoreEvents({ fromHeight, cursor, limit }) {
      const page = await client.getContractEvents({
        event: events.ScoreSubmitted,
        addresses: [contract],
        limit,
        ...(cursor
          ? { cursor }
          : {
              start: { order: "ascending", anchor: { kind: "atHeight", blockHeight: fromHeight } },
            }),
      });
      return {
        events: page.events.map((event) => ({
          ...toScoreSubmitted(event),
          txHash: toBase58(event.transactionHash),
          blockHeight: event.blockHeight,
          sequenceNumber: event.sequenceNumber,
        })),
        nextCursor: page.nextCursor,
        latestIndexedBlockHeight: page.latestIndexedBlockHeight,
        oldestIndexedBlockHeight: page.oldestIndexedBlockHeight,
      };
    },
  };
};
