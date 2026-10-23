/**
 * Kalien chain helpers for the browser, the Worker and the CLI.
 *
 * Everything here talks JSON-RPC through `@thruputchain/client` (fetch only, no Node APIs),
 * so it runs in a Cloudflare Worker, a browser tab, and Bun. Pass the deployment config
 * (`deployments/devnet.json`) and a connected client from `connectKalien`.
 *
 * - Reads: `readPlayerState`, `getBestScore`, `getCurrentSeed`, `getSeed`, `getCurrentSeedId`,
 *   `isTapeClaimed`, `getKalienBalance`, `getTokenMetadata`.
 * - Events: `getScoreSubmittedPage` (one page, cursor or height range), `iterateScoreSubmitted`.
 * - Writes: `createRelayWallet`, `submitScore` (build, sign, persist hook, send, wait, decode),
 *   `getSubmitResult` (recover a submission by hash), `ensureCurrentSeed` (cron).
 */
import {
  PrivateKeySigner,
  TransactionObservationError,
  addressFromHex,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  devnet,
  hashFromHex,
  hashSignedTransaction,
  serializeSignedTransaction,
  toHex0x,
  type TransactionReceipt,
  type Transport,
} from "@thruputchain/client";
import { fixedBytes } from "@thruputchain/client/contract";
import { ExecResult, gasAmount, networkHash as toNetworkHash, type ContractAddress } from "@thruputchain/protocol";
import { KalienScore, kalien_score } from "./bindings/kalien-score";
import { ERC20, ERC20Metadata } from "./bindings/kalien-token";
import { fromHex, tapeHash, toHex } from "./claim";

export type Hex = `0x${string}`;

/** The fields of `deployments/devnet.json` these helpers need. */
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
 * Wallet root gas limit for one `submit_score`. Measured: about 2,065 gas per frame plus
 * 0.2M fixed (36,000 frames: 67-74M). The sender must hold at least this much free HOG
 * (1 gas = 1 base unit = 10^-7 HOG); gas is not burned.
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
  20: "TapeTooShort",
  21: "TapeBadMagic",
  22: "TapeBadVersion",
  23: "TapeBadRulesTag",
  24: "TapeReservedNonZero",
  25: "TapeFrameCountOutOfRange",
  26: "TapeLengthMismatch",
  27: "TapeCrcMismatch",
  30: "RuleViolation",
  31: "FrameCountMismatch",
  32: "ScoreMismatch",
} as const;
export type ScoreErrorName = (typeof SCORE_ERRORS)[keyof typeof SCORE_ERRORS];

// ---------------------------------------------------------------------------
// Connection.

/**
 * Connect to the deployment's RPC and check that the endpoint serves the expected network
 * (a devnet wipe changes the hash; this then throws `NetworkMismatchError`).
 * Pass `transport` to share one HTTP transport or to use a custom fetch.
 */
export async function connectKalien(config: KalienConfig, options: { transport?: Transport } = {}) {
  return createThruputClient({
    cluster: devnet({ rpcUrl: config.rpcUrl, networkHash: toNetworkHash(hashFromHex(config.networkHash)) }),
    ...(options.transport ? { transport: options.transport } : {}),
  });
}
/** A client from `connectKalien` (network identity verified). */
export type KalienClient = Awaited<ReturnType<typeof connectKalien>>;

const score = (c: KalienConfig) => addressFromHex(c.scoreContract);
const token = (c: KalienConfig) => addressFromHex(c.tokenContract);
const addr = (a: string | ContractAddress) => (typeof a === "string" ? addressFromHex(a) : a);

// ---------------------------------------------------------------------------
// Views.

export interface SeedInfo {
  seedId: number;
  seed: number;
}

export async function getCurrentSeedId(client: KalienClient, config: KalienConfig): Promise<number> {
  const r = await KalienScore.v0_1.currentSeedId.view({ client, contract: score(config) });
  return Number(r.value);
}

/** The current epoch's seed, or `null` until someone calls `ensure_current_seed`. */
export async function getCurrentSeed(client: KalienClient, config: KalienConfig): Promise<SeedInfo | null> {
  const r = await KalienScore.v0_1.currentSeed.view({ client, contract: score(config) });
  return r.value ? { seedId: Number(r.value.seed_id), seed: Number(r.value.seed) } : null;
}

export async function getSeed(client: KalienClient, config: KalienConfig, seedId: number): Promise<number | null> {
  const r = await KalienScore.v0_1.seed.view({ client, contract: score(config), args: { seedId: BigInt(seedId) } });
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
    contract: score(config),
    args: { player: addr(player), seedId: BigInt(seedId) },
  });
  return Number(r.value);
}

/** Whether a tape (or its `sha256`) was already accepted by any player. */
export async function isTapeClaimed(
  client: KalienClient,
  config: KalienConfig,
  tapeOrHash: Uint8Array | { hash: Uint8Array },
): Promise<boolean> {
  const hash = tapeOrHash instanceof Uint8Array ? tapeHash(tapeOrHash) : tapeOrHash.hash;
  const r = await KalienScore.v0_1.isClaimed.view({ client, contract: score(config), args: { tapeHash: fixedBytes(hash, 32) } });
  return r.value;
}

/** KALIEN balance in base units (divide by 10^7 for display). */
export async function getKalienBalance(client: KalienClient, config: KalienConfig, owner: string | ContractAddress): Promise<bigint> {
  const r = await ERC20.v0_1.getBalanceOf.view({ client, contract: token(config), args: { addr: addr(owner) } });
  return r.value;
}

export interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint;
}

export async function getTokenMetadata(client: KalienClient, config: KalienConfig): Promise<TokenMetadata> {
  const contract = token(config);
  const r = await client.readViews({
    calls: [
      ERC20Metadata.v0_1.name.viewRequest({ contract }),
      ERC20Metadata.v0_1.symbol.viewRequest({ contract }),
      ERC20Metadata.v0_1.decimals.viewRequest({ contract }),
      ERC20.v0_1.totalSupply.viewRequest({ contract }),
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
  height: bigint;
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
): Promise<PlayerState> {
  const id = seedId ?? (await getCurrentSeedId(client, config));
  const contract = score(config);
  const r = await client.readViews({
    calls: [
      KalienScore.v0_1.seed.viewRequest({ contract, args: { seedId: BigInt(id) } }),
      KalienScore.v0_1.isSeedActive.viewRequest({ contract, args: { seedId: BigInt(id) } }),
      KalienScore.v0_1.bestScore.viewRequest({ contract, args: { player: addr(player), seedId: BigInt(id) } }),
      ERC20.v0_1.getBalanceOf.viewRequest({ contract: token(config), args: { addr: addr(player) } }),
    ] as const,
  });
  const [seed, active, best, balance] = r.results.map(unwrapView) as [bigint | null | undefined, boolean, bigint, bigint];
  return {
    height: r.height,
    seedId: id,
    seed: seed === null || seed === undefined ? null : Number(seed),
    active,
    bestScore: Number(best),
    kalienBalance: balance,
  };
}

function unwrapView(outcome: { kind: string; value?: unknown }): unknown {
  if (outcome.kind !== "return") throw new Error(`view failed: ${JSON.stringify(outcome, jsonReplacer)}`);
  return outcome.value;
}

// ---------------------------------------------------------------------------
// ScoreSubmitted events.

/** One accepted run, as the Worker stores it. Identity: `(txHash, sequenceNumber)`. */
export interface ScoreSubmittedRow {
  txHash: Hex;
  blockHeight: bigint;
  sequenceNumber: number;
  player: Hex;
  playerPubkey: Hex;
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
  /** Opaque continuation, `0x` hex. `"0x"` means this walk is exhausted. */
  cursor: Hex;
  exhausted: boolean;
  /** Indexer head at response time (not a coverage checkpoint). */
  latestBlock: bigint;
  /** Oldest retained block: if your checkpoint is older, history has a gap. */
  oldestBlock: bigint;
}

export interface ScoreSubmittedQuery {
  /** Continue a previous walk (same order and filters). `"0x"`/omitted starts a new walk. */
  cursor?: string;
  /**
   * Start of a new walk. Ascending: start at this height (inclusive; dedupe by identity).
   * Default: the beginning (ascending) or the end (descending).
   */
  fromHeight?: bigint;
  order?: "ascending" | "descending";
  /** 1..200, default 100. */
  limit?: number;
  /** Only this player's events (topic filter). */
  player?: string;
  /** Only this epoch's events (topic filter). */
  seedId?: number;
}

const ScoreSubmitted = kalien_score.v0_1.implementation.ScoreSubmitted;

/** One page of `ScoreSubmitted` events (`groundhog_getEvents`). */
export async function getScoreSubmittedPage(
  client: KalienClient,
  config: KalienConfig,
  query: ScoreSubmittedQuery = {},
): Promise<ScoreSubmittedPage> {
  const order = query.order ?? "ascending";
  const topics: Record<string, unknown> = {};
  if (query.player) topics.player = addressFromHex(query.player);
  if (query.seedId !== undefined) topics.seed_id = BigInt(query.seedId);
  const page = await client.getContractEvents({
    event: ScoreSubmitted,
    contractAddresses: [score(config)],
    ...(Object.keys(topics).length ? { topics: topics as never } : {}),
    order,
    anchor: query.fromHeight !== undefined ? { height: query.fromHeight } : order === "ascending" ? "beginning" : "end",
    cursor: query.cursor ? fromHex(query.cursor) : new Uint8Array(),
    limit: query.limit ?? 100,
  });
  const rows = page.events.map((e): ScoreSubmittedRow => {
    const t = e.topics as { player: ContractAddress; seed_id: bigint };
    const f = e.fields as {
      player_pubkey: Uint8Array;
      seed: bigint;
      frame_count: bigint;
      final_score: bigint;
      previous_best: bigint;
      new_best: bigint;
      minted_delta: bigint;
      tape_hash: Uint8Array;
    };
    return {
      txHash: toHex0x(e.txHash) as Hex,
      blockHeight: e.blockHeight,
      sequenceNumber: e.sequenceNumber,
      player: toHex0x(t.player) as Hex,
      playerPubkey: toHex(f.player_pubkey),
      seedId: Number(t.seed_id),
      seed: Number(f.seed),
      frameCount: Number(f.frame_count),
      finalScore: Number(f.final_score),
      previousBest: Number(f.previous_best),
      newBest: Number(f.new_best),
      mintedDelta: f.minted_delta,
      tapeHash: toHex(f.tape_hash),
    };
  });
  const cursor = toHex(page.cursor);
  return { rows, cursor, exhausted: page.cursor.length === 0, latestBlock: page.latestBlock, oldestBlock: page.oldestBlock };
}

/** Walk pages until the cursor is exhausted. Persist rows and the cursor together per page. */
export async function* iterateScoreSubmitted(
  client: KalienClient,
  config: KalienConfig,
  query: ScoreSubmittedQuery = {},
): AsyncGenerator<ScoreSubmittedPage, void, unknown> {
  let cursor = query.cursor;
  for (;;) {
    const page = await getScoreSubmittedPage(client, config, { ...query, cursor });
    yield page;
    if (page.exhausted) return;
    if (page.cursor === cursor) throw new Error("event cursor did not advance");
    cursor = page.cursor;
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
  return createWalletClient({ client, account: createPubkeyAccount({ signer: new PrivateKeySigner(secret), nonce: 0n }) });
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
  /** Blocks until the signed transaction expires (client default otherwise). */
  expiryBlocks?: bigint;
  /**
   * Called after signing and before broadcast. Persist `txHash` (and `signedTx` if you want to
   * rebroadcast the same bytes) so a timeout can be recovered with `getSubmitResult`.
   * A throw here stops the submission.
   */
  onSigned?: (signed: { txHash: Hex; signedTx: Hex }) => void | Promise<void>;
  /** Receipt wait timeout in ms (default 60 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type SubmitStatus = "confirmed" | "rejected" | "failed" | "unknown";

export interface SubmitScoreResult {
  /** confirmed: committed and accepted. rejected: committed, contract threw `errorName`.
   *  failed: committed with another failure. unknown: not observed yet (poll `getSubmitResult`). */
  status: SubmitStatus;
  txHash: Hex;
  gasLimit: bigint;
  gasUsed: bigint | null;
  height: bigint | null;
  /** Protocol `ExecResult` code (0 = ok), or null when not observed. */
  execResult: number | null;
  errorCode: number | null;
  errorName: ScoreErrorName | null;
  /** Decoded `ScoreSubmitted` event when confirmed. */
  run: Omit<ScoreSubmittedRow, "txHash" | "blockHeight" | "sequenceNumber"> | null;
  /** Free-text detail for unexpected failures. */
  detail?: string;
}

/** Build, sign, (persist via `onSigned`), send and wait for one `submit_score`. */
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
  const frames = input.tape.length >= 16 ? new DataView(input.tape.buffer, input.tape.byteOffset, input.tape.byteLength).getUint32(12, true) : 0;
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
  const hash = hashSignedTransaction(signed);
  const txHash = toHex0x(hash) as Hex;
  await options.onSigned?.({ txHash, signedTx: toHex0x(serializeSignedTransaction(signed)) as Hex });

  try {
    await wallet.sendTransaction(signed);
  } catch (error) {
    // The node may still have it: observe before reporting.
    const receipt = await wallet.getTransactionReceipt(hash).catch(() => null);
    if (receipt) return decodeSubmitReceipt(config, receipt, gasLimit);
    return { ...unknownResult(txHash, gasLimit), detail: `send failed: ${errorText(error)}` };
  }
  try {
    const receipt = await wallet.waitForTransactionReceipt(hash, {
      timeoutMs: options.timeoutMs ?? 60_000,
      ...(options.signal ? { signal: options.signal } : {}),
    } as never);
    return decodeSubmitReceipt(config, receipt, gasLimit);
  } catch (error) {
    if (error instanceof TransactionObservationError || /timeout|timed out|abort/i.test(errorText(error))) {
      return { ...unknownResult(txHash, gasLimit), detail: errorText(error) };
    }
    throw error;
  }
}

/** Look up a submission by hash later (after `status: "unknown"`). */
export async function getSubmitResult(
  client: KalienClient,
  config: KalienConfig,
  txHash: string,
  gasLimit: bigint = 0n,
): Promise<SubmitScoreResult> {
  const receipt = await client.getTransactionReceipt(hashFromHex(txHash));
  if (!receipt) return unknownResult(txHash as Hex, gasLimit);
  return decodeSubmitReceipt(config, receipt, gasLimit);
}

/** Decode a committed `submit_score` receipt (wallet root around the score call). */
export function decodeSubmitReceipt(config: KalienConfig, receipt: TransactionReceipt, gasLimit: bigint): SubmitScoreResult {
  const base = {
    txHash: toHex0x(receipt.txHash) as Hex,
    gasLimit,
    gasUsed: receipt.gasUsed,
    height: receipt.height,
    execResult: Number(receipt.execResult),
  };
  if (Number(receipt.execResult) === Number(ExecResult.ExecResultOK)) {
    const events = ScoreSubmitted.allFromReceipt(receipt, { contractAddress: score(config) });
    if (events.length !== 1) {
      return { ...base, status: "failed", errorCode: null, errorName: null, run: null, detail: `expected 1 ScoreSubmitted event, got ${events.length}` };
    }
    const e = events[0]!;
    const t = e.topics as { player: ContractAddress; seed_id: bigint };
    const f = e.fields as Record<string, bigint | Uint8Array>;
    return {
      ...base,
      status: "confirmed",
      errorCode: null,
      errorName: null,
      run: {
        player: toHex0x(t.player) as Hex,
        playerPubkey: toHex(f.player_pubkey as Uint8Array),
        seedId: Number(t.seed_id),
        seed: Number(f.seed),
        frameCount: Number(f.frame_count),
        finalScore: Number(f.final_score),
        previousBest: Number(f.previous_best),
        newBest: Number(f.new_best),
        mintedDelta: f.minted_delta as bigint,
        tapeHash: toHex(f.tape_hash as Uint8Array),
      },
    };
  }
  const code = decodeScoreErrorCode(receipt.abortData);
  const name = code === null ? null : ((SCORE_ERRORS as Record<number, ScoreErrorName>)[code] ?? null);
  return {
    ...base,
    status: name ? "rejected" : "failed",
    errorCode: code,
    errorName: name,
    run: null,
    ...(name ? {} : { detail: receipt.abortData ? `abort ${toHex(receipt.abortData)}` : `execResult ${String(receipt.execResult)}` }),
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
export async function ensureCurrentSeed(wallet: RelayWallet, config: KalienConfig): Promise<SeedInfo & { txHash: Hex }> {
  const res = await wallet.executeCallsAndWait({
    calls: [KalienScore.v0_1.ensureCurrentSeed.call({ contract: score(config), gasLimit: gasAmount(5_000_000n) })] as const,
    gasLimit: gasAmount(10_000_000n),
  });
  const info = res.values[0];
  return { seedId: Number(info.seed_id), seed: Number(info.seed), txHash: toHex0x(res.txHash) as Hex };
}

function unknownResult(txHash: Hex, gasLimit: bigint): SubmitScoreResult {
  return { status: "unknown", txHash, gasLimit, gasUsed: null, height: null, execResult: null, errorCode: null, errorName: null, run: null };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `JSON.stringify` replacer for bigint and bytes. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? toHex(value) : value;
}
