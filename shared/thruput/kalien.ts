/**
 * Kalien chain helpers for the browser, the Worker and the CLI (wire format 14,
 * `@thruputchain/client` 0.23).
 *
 * Everything here talks JSON-RPC through the client (fetch only, no Node APIs), so it runs in
 * a Cloudflare Worker, a browser tab, and Bun. Pass the deployment config
 * (`deployments/devnet.json`) and a client from `connectKalien`.
 *
 * Identifiers (addresses, transaction hashes, network hash) are base58 strings in this API,
 * as on the wire. Payload bytes (player pubkey, tape hash, signatures) are `0x` hex.
 *
 * - Reads: `readPlayerState`, `getBestScore`, `getCurrentSeed`, `getSeed`, `getCurrentSeedId`,
 *   `isTapeClaimed`, `getClaimedSeedId`, `getKalienBalance`, `getTokenMetadata`,
 *   `getScoreConfig`, `isRelay`, `getRelays`, `getBlockTime`.
 * - Events: `getScoreSubmittedPage` (one page: `start` or `cursor`), `walkScoreSubmitted`
 *   (a fixed ascending range with a completion checkpoint).
 * - Writes: `createRelayWallet`, `submitScore` (build, sign, persist hook, send, observe,
 *   decode), `getSubmitResult` (observe a saved hash), `ensureCurrentSeed` (cron).
 *
 * Rules from the wire-14 guide: admission is not commitment; commitment is not success
 * (read `receipt.execution.result`); an uncertain send is never resubmitted here; a page
 * walk ends only at `nextCursor: null`.
 */
import {
  Ed25519Signer,
  NativeRpcError,
  TransactionReceiptObservationError,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  devnet,
  hashSignedTransaction,
  serializeSignedTransaction,
  toBase58,
  type TransactionReceipt,
  type TransactionStatus,
  type Transport,
} from "@thruputchain/client";
import { fixedBytes } from "@thruputchain/client/contract";
import { contractAddress, gasAmount, networkHash as toNetworkHash, sha256Hash, type ContractAddress } from "@thruputchain/protocol";
import { KalienScore, kalien_score } from "./bindings/kalien-score";
import { ERC20, ERC20Metadata } from "./bindings/kalien-token";
import { bytes32, fromHex, tapeHash, toHex } from "./claim";

export type Hex = `0x${string}`;

/** The fields of `deployments/devnet.json` these helpers need (base58 identifiers). */
export interface KalienConfig {
  networkHash: string;
  rpcUrl: string;
  scoreContract: string;
  tokenContract: string;
}

/** KALIEN has 7 decimals: 1 point of score improvement mints 10^7 base units. */
export const KALIEN_DECIMALS = 7;
export const UNITS_PER_POINT = 10_000_000n;
/** Seconds per seed epoch; `seed_id = floor(unix_seconds / 600)`. */
export const EPOCH_SECONDS = 600;
/** The current epoch and the previous 143 accept submissions. */
export const ACTIVE_EPOCHS = 144;
/** Longest tape the contract accepts. */
export const MAX_FRAMES = 36_000;

/**
 * Wallet root gas limit for one `submit_score`. Measured on RV32 (thruput-sdk 0.54): about
 * 2,070 gas per frame plus 0.2M fixed (36,000 frames: 67.6-74.5M). The sender must hold at
 * least this much free HOG (1 gas = 1 base unit = 10^-7 HOG); gas is not burned.
 */
export function submitGasLimit(frameCount: number): bigint {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new Error(`bad frame count ${frameCount}`);
  return 3_000_000n + 2_200n * BigInt(frameCount);
}

/** `seed_id` of a unix time in seconds (the contract uses the block time). */
export function seedIdAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / EPOCH_SECONDS);
}

/** `ScoreError` discriminants of the score contract. */
export const SCORE_ERRORS = {
  1: "AlreadyInitialized",
  2: "NotAdmin",
  3: "Paused",
  4: "UnknownSeed",
  5: "SeedInactive",
  6: "SeedMismatch",
  7: "BadSignature",
  8: "AlreadyClaimed",
  9: "ZeroScore",
  10: "NotImproved",
  11: "SeedAlreadySet",
  12: "ZeroSeed",
  13: "SeedingLocked",
  14: "NotRelay",
  15: "RelaySetFull",
  16: "SeedNotExpired",
  20: "TapeTooShort",
  21: "TapeBadMagic",
  22: "TapeBadVersion",
  23: "TapeBadRulesTag",
  24: "TapeReservedNonZero",
  25: "TapeFrameCountOutOfRange",
  26: "TapeLengthMismatch",
  27: "TapeCrcMismatch",
  28: "TapeBadPadding",
  30: "RuleViolation",
  31: "FrameCountMismatch",
  32: "ScoreMismatch",
} as const;
export type ScoreErrorName = (typeof SCORE_ERRORS)[keyof typeof SCORE_ERRORS];

// ---------------------------------------------------------------------------
// Connection and identifiers.

/** A contract address from base58 (or 0x hex) text. */
export function parseAddress(text: string | ContractAddress): ContractAddress {
  return typeof text === "string" ? contractAddress(bytes32(text, "address")) : text;
}

/**
 * Connect to the deployment's RPC. The client checks wire format 14, the methods it needs,
 * and that the endpoint serves `config.networkHash` (a devnet wipe changes the hash; this
 * then throws `NetworkMismatchError`). Pass `transport` to share one HTTP transport.
 */
export async function connectKalien(config: KalienConfig, options: { transport?: Transport } = {}) {
  return createThruputClient({
    cluster: devnet({ rpcUrl: config.rpcUrl, networkHash: toNetworkHash(sha256Hash(bytes32(config.networkHash, "networkHash"))) }),
    ...(options.transport ? { transport: options.transport } : {}),
  });
}
/** A client from `connectKalien` (network identity verified). */
export type KalienClient = Awaited<ReturnType<typeof connectKalien>>;
/** The read-only methods that observe a submitted transaction (a client or a relay wallet). */
export type SubmitObserver = Pick<KalienClient, "getTransactionReceipt" | "getTransactionStatus" | "waitForTransactionReceipt">;

const score = (c: KalienConfig) => parseAddress(c.scoreContract);
const token = (c: KalienConfig) => parseAddress(c.tokenContract);

// ---------------------------------------------------------------------------
// Views.

export interface SeedInfo {
  seedId: number;
  seed: number;
}

export async function getCurrentSeedId(client: KalienClient, config: KalienConfig): Promise<number> {
  const r = await KalienScore.v0_1.currentSeedId.view({ client, address: score(config) });
  return Number(r.value);
}

/** The current epoch's seed, or `null` until someone calls `ensure_current_seed`. */
export async function getCurrentSeed(client: KalienClient, config: KalienConfig): Promise<SeedInfo | null> {
  const r = await KalienScore.v0_1.currentSeed.view({ client, address: score(config) });
  return r.value ? { seedId: Number(r.value.seed_id), seed: Number(r.value.seed) } : null;
}

export async function getSeed(client: KalienClient, config: KalienConfig, seedId: number): Promise<number | null> {
  const r = await KalienScore.v0_1.seed.view({ client, address: score(config), args: { seedId: BigInt(seedId) } });
  return r.value === null || r.value === undefined ? null : Number(r.value);
}

export async function getBestScore(
  client: KalienClient,
  config: KalienConfig,
  player: string | ContractAddress,
  seedId: number,
): Promise<number> {
  const r = await KalienScore.v0_1.bestScore.view({
    client,
    address: score(config),
    args: { player: parseAddress(player), seedId: BigInt(seedId) },
  });
  return Number(r.value);
}

const hashArg = (tapeOrHash: Uint8Array | { hash: Uint8Array }) =>
  fixedBytes(tapeOrHash instanceof Uint8Array ? tapeHash(tapeOrHash) : tapeOrHash.hash, 32);

/** Whether a tape (or its `sha256`) was already accepted by any player. */
export async function isTapeClaimed(client: KalienClient, config: KalienConfig, tapeOrHash: Uint8Array | { hash: Uint8Array }): Promise<boolean> {
  const r = await KalienScore.v0_1.isClaimed.view({ client, address: score(config), args: { tapeHash: hashArg(tapeOrHash) } });
  return r.value;
}

/** The `seed_id` a tape was accepted for, or null. */
export async function getClaimedSeedId(
  client: KalienClient,
  config: KalienConfig,
  tapeOrHash: Uint8Array | { hash: Uint8Array },
): Promise<number | null> {
  const r = await KalienScore.v0_1.claimedSeedId.view({ client, address: score(config), args: { tapeHash: hashArg(tapeOrHash) } });
  return r.value === null || r.value === undefined ? null : Number(r.value);
}

/** KALIEN balance in base units (divide by 10^7 for display). */
export async function getKalienBalance(client: KalienClient, config: KalienConfig, owner: string | ContractAddress): Promise<bigint> {
  const r = await ERC20.v0_1.getBalanceOf.view({ client, address: token(config), args: { addr: parseAddress(owner) } });
  return r.value;
}

export interface ScoreConfig {
  admin: string;
  token: string;
  paused: boolean;
  /** Only allowed relays may call `submit_score`. */
  relayOnly: boolean;
  /** `set_seed` is disabled for good. */
  seedingLocked: boolean;
}

export async function getScoreConfig(client: KalienClient, config: KalienConfig): Promise<ScoreConfig> {
  const r = await KalienScore.v0_1.config.view({ client, address: score(config) });
  const c = r.value;
  return { admin: toBase58(c.admin), token: toBase58(c.token), paused: c.paused, relayOnly: c.relay_only, seedingLocked: c.seeding_locked };
}

/** Whether `relay` may call `submit_score` while relay-only mode is on. */
export async function isRelay(client: KalienClient, config: KalienConfig, relay: string | ContractAddress): Promise<boolean> {
  const r = await KalienScore.v0_1.isRelay.view({ client, address: score(config), args: { relay: parseAddress(relay) } });
  return r.value;
}

/** The relay allowlist, base58. */
export async function getRelays(client: KalienClient, config: KalienConfig): Promise<string[]> {
  const r = await KalienScore.v0_1.relays.view({ client, address: score(config) });
  const set = r.value as unknown as { count: bigint | number; relays: ContractAddress[] };
  return set.relays.slice(0, Number(set.count)).map((a) => toBase58(a));
}

/**
 * The contract rejects an odd-frame tape whose unused last high nibble is not zero
 * (`TapeBadPadding`). Check it before you spend a submission.
 */
export function tapePaddingOk(tape: Uint8Array): boolean {
  if (tape.length < 24) return false;
  const frames = new DataView(tape.buffer, tape.byteOffset, tape.byteLength).getUint32(12, true);
  if (frames % 2 === 0) return true;
  const lastBody = 16 + Math.ceil(frames / 2) - 1;
  return lastBody < tape.length && tape[lastBody]! >> 4 === 0;
}

export interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint;
}

export async function getTokenMetadata(client: KalienClient, config: KalienConfig): Promise<TokenMetadata> {
  const address = token(config);
  const r = await client.readViews({
    calls: [
      ERC20Metadata.v0_1.name.viewRequest({ address }),
      ERC20Metadata.v0_1.symbol.viewRequest({ address }),
      ERC20Metadata.v0_1.decimals.viewRequest({ address }),
      ERC20.v0_1.totalSupply.viewRequest({ address }),
    ] as const,
  });
  const [name, symbol, decimals, supply] = r.results.map(unwrapView) as [
    string | null | undefined,
    string | null | undefined,
    number | bigint | null | undefined,
    bigint,
  ];
  return {
    name: name ?? null,
    symbol: symbol ?? null,
    decimals: decimals === null || decimals === undefined ? null : Number(decimals),
    totalSupply: supply,
  };
}

export interface PlayerState {
  stateBlockHeight: bigint;
  seedId: number;
  seed: number | null;
  active: boolean;
  bestScore: number;
  kalienBalance: bigint;
}

/** One-snapshot read of what a player screen needs for one epoch (default: current). */
export async function readPlayerState(
  client: KalienClient,
  config: KalienConfig,
  player: string | ContractAddress,
  seedId?: number,
  options: { minStateBlockHeight?: bigint } = {},
): Promise<PlayerState> {
  const id = seedId ?? (await getCurrentSeedId(client, config));
  const address = score(config);
  const who = parseAddress(player);
  const r = await client.readViews({
    calls: [
      KalienScore.v0_1.seed.viewRequest({ address, args: { seedId: BigInt(id) } }),
      KalienScore.v0_1.isSeedActive.viewRequest({ address, args: { seedId: BigInt(id) } }),
      KalienScore.v0_1.bestScore.viewRequest({ address, args: { player: who, seedId: BigInt(id) } }),
      ERC20.v0_1.getBalanceOf.viewRequest({ address: token(config), args: { addr: who } }),
    ] as const,
    ...(options.minStateBlockHeight !== undefined ? { minStateBlockHeight: options.minStateBlockHeight } : {}),
  });
  const [seed, active, best, balance] = r.results.map(unwrapView) as [bigint | null | undefined, boolean, bigint, bigint];
  return {
    stateBlockHeight: r.stateBlockHeight,
    seedId: id,
    seed: seed === null || seed === undefined ? null : Number(seed),
    active,
    bestScore: Number(best),
    kalienBalance: balance,
  };
}

/** Block time in unix seconds, or null outside indexed coverage (`getBlockByHeight`). */
export async function getBlockTime(client: KalienClient, blockHeight: bigint): Promise<number | null> {
  const block = await client.getBlockByHeight({ blockHeight });
  return block === null ? null : Number(block.blockTimepoint / 1_000_000_000n);
}

function unwrapView(outcome: { kind: string; value?: unknown }): unknown {
  if (outcome.kind !== "return") throw new Error(`view failed: ${JSON.stringify(outcome, jsonReplacer)}`);
  return outcome.value;
}

// ---------------------------------------------------------------------------
// ScoreSubmitted events.

/** One accepted run, as the Worker stores it. Identity: `(transactionHash, sequenceNumber)`. */
export interface ScoreSubmittedRow {
  transactionHash: string;
  blockHeight: bigint;
  sequenceNumber: number;
  player: string;
  playerPubkey: Hex;
  /** The submitting account (one of the relays in relay-only mode). */
  relay: string;
  /** Block time of the run, unix seconds. */
  submittedAt: number;
  seedId: number;
  seed: number;
  frameCount: number;
  finalScore: number;
  previousBest: number;
  newBest: number;
  mintedDelta: bigint;
  tapeHash: Hex;
}

export interface ScoreSubmittedPage {
  rows: ScoreSubmittedRow[];
  /** Opaque continuation. Only `null` ends the walk (an empty page can continue). */
  nextCursor: string | null;
  oldestIndexedBlockHeight: bigint;
  latestIndexedBlockHeight: bigint;
}

export interface ScoreSubmittedFilter {
  /** Only this player's events (base58 address). */
  player?: string;
  /** Only this epoch's events. */
  seedId?: number;
}

export type ScoreSubmittedQuery = ScoreSubmittedFilter & {
  limit?: number;
} & (
    | {
        /** Start a walk: ascending from the beginning or an inclusive height; descending from the end or a height. */
        start: { order: "ascending" | "descending"; fromHeight?: bigint };
        cursor?: never;
      }
    | {
        /** Continue a walk with the same filters. */
        cursor: string;
        start?: never;
      }
  );

const ScoreSubmitted = kalien_score.v0_1.implementation.ScoreSubmitted;

function eventFilter(config: KalienConfig, filter: ScoreSubmittedFilter) {
  const topics: kalien_score.v0_1.implementation.ScoreSubmittedFilter = {
    ...(filter.player ? { player: parseAddress(filter.player) } : {}),
    ...(filter.seedId !== undefined ? { seed_id: BigInt(filter.seedId) } : {}),
  };
  return {
    addresses: [score(config)],
    ...(Object.keys(topics).length ? { topics } : {}),
  };
}

function rpcStart(start: { order: "ascending" | "descending"; fromHeight?: bigint }) {
  if (start.order === "ascending") {
    return {
      order: "ascending" as const,
      anchor: start.fromHeight === undefined ? { kind: "atBeginning" as const } : { kind: "atHeight" as const, blockHeight: start.fromHeight },
    };
  }
  return {
    order: "descending" as const,
    anchor: start.fromHeight === undefined ? { kind: "atEnd" as const } : { kind: "atHeight" as const, blockHeight: start.fromHeight },
  };
}

interface DecodedScoreSubmitted {
  topics: unknown;
  fields: unknown;
}

function toRow(e: DecodedScoreSubmitted, id: { transactionHash: Uint8Array; blockHeight: bigint; sequenceNumber: number }): ScoreSubmittedRow {
  const t = e.topics as { player: ContractAddress; seed_id: bigint };
  const f = e.fields as {
    player_pubkey: Uint8Array;
    relay: ContractAddress;
    submitted_at: bigint;
    seed: bigint;
    frame_count: bigint;
    final_score: bigint;
    previous_best: bigint;
    new_best: bigint;
    minted_delta: bigint;
    tape_hash: Uint8Array;
  };
  return {
    transactionHash: toBase58(id.transactionHash),
    blockHeight: id.blockHeight,
    sequenceNumber: id.sequenceNumber,
    player: toBase58(t.player),
    playerPubkey: toHex(f.player_pubkey),
    relay: toBase58(f.relay),
    submittedAt: Number(f.submitted_at),
    seedId: Number(t.seed_id),
    seed: Number(f.seed),
    frameCount: Number(f.frame_count),
    finalScore: Number(f.final_score),
    previousBest: Number(f.previous_best),
    newBest: Number(f.new_best),
    mintedDelta: f.minted_delta,
    tapeHash: toHex(f.tape_hash),
  };
}

/** One page of `ScoreSubmitted` events (`getEvents`). Pass `start` for a new walk, or `cursor`. */
export async function getScoreSubmittedPage(
  client: KalienClient,
  config: KalienConfig,
  query: ScoreSubmittedQuery,
): Promise<ScoreSubmittedPage> {
  const base = { event: ScoreSubmitted, ...eventFilter(config, query), limit: query.limit ?? 100 };
  const page = await client.getContractEvents(
    query.cursor !== undefined ? { ...base, cursor: query.cursor } : { ...base, start: rpcStart(query.start!) },
  );
  return {
    rows: page.events.map((e) => toRow(e, e)),
    nextCursor: page.nextCursor,
    oldestIndexedBlockHeight: page.oldestIndexedBlockHeight,
    latestIndexedBlockHeight: page.latestIndexedBlockHeight,
  };
}

/**
 * Walk a fixed ascending range from `fromHeight` (inclusive; default the beginning) to the
 * walk's initial upper watermark. `onPage` must persist each page's rows (dedupe by
 * `(transactionHash, sequenceNumber)`). Resolves with `completedThroughBlockHeight` only after
 * the terminal page: save it with the rows, and start the next walk at that height.
 * Throws on cursor errors or regressed coverage; it never restarts silently.
 */
export async function walkScoreSubmitted(
  client: KalienClient,
  config: KalienConfig,
  options: ScoreSubmittedFilter & { fromHeight?: bigint; limit?: number },
  onPage: (page: { rows: ScoreSubmittedRow[]; oldestIndexedBlockHeight: bigint; latestIndexedBlockHeight: bigint }) => void | Promise<void>,
): Promise<{ watermarkBlockHeight: bigint; completedThroughBlockHeight?: bigint }> {
  const pages = client.iterateEventPages({
    filters: [ScoreSubmitted.filter(eventFilter(config, options))],
    start: rpcStart({ order: "ascending", ...(options.fromHeight !== undefined ? { fromHeight: options.fromHeight } : {}) }),
    limit: options.limit ?? 100,
  });
  for (;;) {
    const step = await pages.next();
    if (step.done) return step.value;
    const rows: ScoreSubmittedRow[] = [];
    for (const row of step.value.events) {
      const decoded = ScoreSubmitted.decode(row.event);
      if (decoded) rows.push(toRow(decoded, row));
    }
    await onPage({ rows, oldestIndexedBlockHeight: step.value.oldestIndexedBlockHeight, latestIndexedBlockHeight: step.value.latestIndexedBlockHeight });
  }
}

// ---------------------------------------------------------------------------
// Writes.

/**
 * Relay wallet from a 32-byte Ed25519 seed (hex, as in `RELAY_SECRET`). Nonce-0 pubkey
 * account, the DefaultWallet. Never log the secret.
 */
export function createRelayWallet(client: KalienClient, secretHex: string) {
  const secret = fromHex(secretHex.trim());
  if (secret.length !== 32) throw new Error("relay secret must be 32 bytes of hex");
  return createWalletClient({ client, account: createPubkeyAccount({ signer: Ed25519Signer.fromSeed(secret), nonce: 0n }) });
}
export type RelayWallet = ReturnType<typeof createRelayWallet>;

export interface SubmitScoreInput {
  playerPubkey: Uint8Array | string;
  seedId: number;
  tape: Uint8Array;
  /** Ed25519 signature over `claimMessage(...)`, 64 bytes or hex. */
  signature: Uint8Array | string;
}

export interface SubmitScoreOptions {
  /** Override the computed gas limit. */
  gasLimit?: bigint;
  /** Blocks until the signed transaction expires (client default: 100). */
  expiryBlocks?: bigint;
  /**
   * Called after signing and before `sendTransaction`. Persist `transactionHash` and
   * `signedTransaction` so a lost response can be recovered with `getSubmitResult`.
   * A throw here stops the submission (nothing is sent).
   */
  onSigned?: (signed: { transactionHash: string; signedTransaction: Hex }) => void | Promise<void>;
  /** Observed scheduler statuses (advisory; never retry permission). */
  onStatus?: (status: TransactionStatus) => void;
  /** Receipt wait timeout in ms (default 60 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * - `confirmed`: committed, `execution.result = "return"`, the run is recorded.
 * - `rejected`: committed, the contract aborted with `errorName`.
 * - `failed`: committed with another outcome (fault, unknown abort, ...).
 * - `notAdmitted`: `sendTransaction` refused this attempt (`admission: "notAttempted" | "rejected"`).
 *   This does not prove the bytes can never land; keep the hash and do not re-sign blindly.
 * - `unknown`: admission or commitment not observed yet. Poll `getSubmitResult` with the
 *   saved hash. Never resubmit automatically.
 */
export type SubmitStatus = "confirmed" | "rejected" | "failed" | "notAdmitted" | "unknown";

export interface SubmitScoreResult {
  status: SubmitStatus;
  transactionHash: string;
  gasLimit: bigint;
  gasUsed: bigint | null;
  blockHeight: bigint | null;
  /** `receipt.execution.result` (`return`, `abort`, `fault`, ...), or null when not observed. */
  executionResult: string | null;
  errorCode: number | null;
  errorName: ScoreErrorName | null;
  /** RPC `error.data.kind` / `admission` when the send failed. */
  rpcErrorKind?: string;
  admission?: string;
  /** Commitment height seen when the receipt was not yet available. */
  knownCommitmentHeight?: bigint;
  /** Decoded `ScoreSubmitted` event when confirmed. */
  run: Omit<ScoreSubmittedRow, "transactionHash" | "blockHeight" | "sequenceNumber"> | null;
  detail?: string;
}

/** Build, sign, persist (`onSigned`), send and observe one `submit_score`. Never resubmits. */
export async function submitScore(
  wallet: RelayWallet,
  config: KalienConfig,
  input: SubmitScoreInput,
  options: SubmitScoreOptions = {},
): Promise<SubmitScoreResult> {
  const pubkey = typeof input.playerPubkey === "string" ? fromHex(input.playerPubkey) : input.playerPubkey;
  const signature = typeof input.signature === "string" ? fromHex(input.signature) : input.signature;
  if (pubkey.length !== 32) throw new Error("playerPubkey must be 32 bytes");
  if (signature.length !== 64) throw new Error("signature must be 64 bytes");
  const frames =
    input.tape.length >= 16 ? new DataView(input.tape.buffer, input.tape.byteOffset, input.tape.byteLength).getUint32(12, true) : 0;
  const gasLimit = options.gasLimit ?? submitGasLimit(Math.min(frames, MAX_FRAMES));

  const invocation = KalienScore.v0_1.submitScore.invocation(score(config), gasAmount(gasLimit - 50_000n), {
    playerPubkey: fixedBytes(pubkey, 32),
    seedId: BigInt(input.seedId),
    tape: input.tape,
    signature: fixedBytes(signature, 64),
  });
  const tx = await wallet.prepareExecution({
    invocation,
    gasLimit: gasAmount(gasLimit),
    ...(options.expiryBlocks !== undefined ? { expiryBlocks: options.expiryBlocks } : {}),
  });
  const signed = await wallet.signTransaction(tx);
  const transactionHash = toBase58(hashSignedTransaction(signed));
  const signedTransaction = serializeSignedTransaction(signed);
  await options.onSigned?.({ transactionHash, signedTransaction: toHex(signedTransaction) });

  try {
    await wallet.sendTransaction({ signedTransaction });
  } catch (error) {
    const evidence = rpcErrorEvidence(error);
    if (evidence.admission === "notAttempted" || evidence.admission === "rejected") {
      return { ...unknownResult(transactionHash, gasLimit), status: "notAdmitted", ...evidence, detail: errorText(error) };
    }
    // Admission unknown: observe the saved hash, never re-send.
    return { ...(await getSubmitResult(wallet, config, transactionHash, gasLimit)), ...evidence, detail: `send: ${errorText(error)}` };
  }
  return observe(wallet, config, transactionHash, gasLimit, options);
}

async function observe(
  client: SubmitObserver,
  config: KalienConfig,
  transactionHash: string,
  gasLimit: bigint,
  options: Pick<SubmitScoreOptions, "timeoutMs" | "signal" | "onStatus">,
): Promise<SubmitScoreResult> {
  try {
    const receipt = await client.waitForTransactionReceipt(sha256Hash(bytes32(transactionHash)), {
      timeoutMs: options.timeoutMs ?? 60_000,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    });
    return decodeSubmitReceipt(config, receipt, gasLimit);
  } catch (error) {
    if (error instanceof TransactionReceiptObservationError) {
      const known = error.knownCommitment as { blockHeight?: bigint } | undefined;
      return {
        ...unknownResult(transactionHash, gasLimit),
        ...(known?.blockHeight !== undefined ? { knownCommitmentHeight: known.blockHeight } : {}),
        detail: errorText(error),
      };
    }
    throw error;
  }
}

/** Observe a saved hash once (receipt, else status). Read-only; it never resubmits. */
export async function getSubmitResult(
  client: SubmitObserver,
  config: KalienConfig,
  transactionHash: string,
  gasLimit: bigint = 0n,
): Promise<SubmitScoreResult> {
  const hash = sha256Hash(bytes32(transactionHash));
  const receipt = await client.getTransactionReceipt({ transactionHash: hash });
  if (receipt) return decodeSubmitReceipt(config, receipt, gasLimit);
  const status = await client.getTransactionStatus({ transactionHash: hash });
  const result = unknownResult(transactionHash, gasLimit);
  const known = status as { status?: string; blockHeight?: bigint };
  if (known.status === "committed" && known.blockHeight !== undefined) {
    return { ...result, knownCommitmentHeight: known.blockHeight, detail: "committed; receipt not indexed yet" };
  }
  return { ...result, detail: `status ${known.status ?? "unsupported"}` };
}

/** Decode a committed `submit_score` receipt (wallet root around the score call). */
export function decodeSubmitReceipt(config: KalienConfig, receipt: TransactionReceipt, gasLimit: bigint): SubmitScoreResult {
  const execution = receipt.execution as { result: string; abortData?: Uint8Array };
  const base = {
    transactionHash: toBase58(receipt.transactionHash),
    gasLimit,
    gasUsed: receipt.gasUsed,
    blockHeight: receipt.blockHeight,
    executionResult: execution.result,
  };
  if (execution.result === "return") {
    const events = ScoreSubmitted.allFromReceipt(receipt, { address: score(config) });
    if (events.length !== 1) {
      return { ...base, status: "failed", errorCode: null, errorName: null, run: null, detail: `expected 1 ScoreSubmitted event, got ${events.length}` };
    }
    const { transactionHash: _t, blockHeight: _b, sequenceNumber: _s, ...run } = toRow(events[0]!, {
      transactionHash: receipt.transactionHash,
      blockHeight: receipt.blockHeight,
      sequenceNumber: 0,
    });
    void _t, _b, _s;
    return { ...base, status: "confirmed", errorCode: null, errorName: null, run };
  }
  const code = execution.result === "abort" ? decodeScoreErrorCode(execution.abortData ?? null) : null;
  const name = code === null ? null : ((SCORE_ERRORS as Record<number, ScoreErrorName>)[code] ?? null);
  return {
    ...base,
    status: name ? "rejected" : "failed",
    errorCode: code,
    errorName: name,
    run: null,
    ...(name ? {} : { detail: execution.abortData ? `abort ${toHex(execution.abortData)}` : `execution ${execution.result}` }),
  };
}

/** The `ScoreError` discriminant in abort data, or null if it is another exception. */
export function decodeScoreErrorCode(abortData: Uint8Array | null): number | null {
  if (!abortData || abortData.length === 0) return null;
  try {
    const exn = KalienScore.v0_1.submitScore.decodeException(abortData) as unknown as { value?: unknown };
    return typeof exn?.value === "bigint" || typeof exn?.value === "number" ? Number(exn.value) : null;
  } catch {
    return null;
  }
}

/** Create the current epoch seed if missing (cron). Any funded wallet works. */
export async function ensureCurrentSeed(wallet: RelayWallet, config: KalienConfig): Promise<SeedInfo & { transactionHash: string }> {
  const res = await wallet.executeCallsAndWait({
    calls: [KalienScore.v0_1.ensureCurrentSeed.call({ address: score(config), gasLimit: gasAmount(5_000_000n) })] as const,
    gasLimit: gasAmount(10_000_000n),
  });
  const info = res.values[0];
  return { seedId: Number(info.seed_id), seed: Number(info.seed), transactionHash: toBase58(res.transactionHash) };
}

function rpcErrorEvidence(error: unknown): { rpcErrorKind?: string; admission?: string } {
  if (error instanceof NativeRpcError && error.decoded.classification === "known") {
    const data = error.decoded.data as { kind?: string; admission?: string };
    return { ...(data.kind ? { rpcErrorKind: data.kind } : {}), ...(data.admission ? { admission: data.admission } : {}) };
  }
  return {};
}

function unknownResult(transactionHash: string, gasLimit: bigint): SubmitScoreResult {
  return {
    status: "unknown",
    transactionHash,
    gasLimit,
    gasUsed: null,
    blockHeight: null,
    executionResult: null,
    errorCode: null,
    errorName: null,
    run: null,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `JSON.stringify` replacer for bigint and bytes (bytes as `0x` hex). */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? toHex(value) : value;
}
