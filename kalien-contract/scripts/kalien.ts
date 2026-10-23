#!/usr/bin/env bun
/**
 * Kalien contract operations over JSON-RPC with @thruputchain/client.
 *
 *   bun kalien-contract/scripts/kalien.ts <command> [--flag value ...]
 *
 * Commands
 *   fund         --rpc URL --key NAME [--times N]          faucet (groundhog_requestAirdrop) to a stored key
 *   deploy       --rpc URL --deployer-key NAME --out FILE [--fund-score HOG] [--fund-token HOG]
 *   ensure-seed  --deployment FILE --key NAME               create the current epoch seed
 *   set-seed     --deployment FILE --key NAME --seed HEX|DEC [--seed-id N]   admin only
 *   submit       --deployment FILE --relay-key NAME --tape FILE
 *                (--player-key NAME | --player-secret-file FILE) [--seed-id N] [--gas N]
 *   fixtures     --deployment FILE --admin-key NAME --relay-key NAME --player-key NAME [--out FILE]
 *                fix fixture seeds on free epochs and submit the fixture tapes
 *   export-secret --key NAME                               print the 32-byte seed as hex (for the Worker secret file)
 *   integration  --rpc URL [--out FILE]                     full local-node test with fresh keys
 *
 * Keys are read from ~/.config/thruput/keys/<NAME>.json (the `thruput keys` store) and
 * are never printed. Pubkey accounts use nonce 0, like the browser wallet.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  addressFromHex,
  PrivateKeySigner,
  TransactionExecutionError,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  devnet,
  prepareContractDeployment,
  rv32Contract,
  toHex0x,
} from "@thruputchain/client";
import { gasAmount, type ContractAddress } from "@thruputchain/protocol";
import { fixedBytes } from "@thruputchain/client/contract";
import { KalienScore, kalien_score } from "../../shared/thruput/bindings/kalien-score";
import { ERC20, KalienTokenAdmin } from "../../shared/thruput/bindings/kalien-token";
import { claimMessage, fromHex, pubkeyAccountAddress, tapeHash, toHex } from "../../shared/thruput/claim";

const REPO = resolve(import.meta.dir, "../..");
const ARTIFACTS = join(REPO, "kalien-contract/target/thruput");
const HOG = 10_000_000n;

/** Gas budget for one submit_score wallet root: measured ~2,065 gas/frame + ~0.2M fixed. */
export function submitGasLimit(frameCount: number): bigint {
  return 3_000_000n + 2_200n * BigInt(frameCount);
}

// ---------------------------------------------------------------------------
// Arguments, keys, clients.

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "true";
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

function need(args: Record<string, string>, name: string): string {
  const v = args[name];
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

/** 32-byte Ed25519 seed of a stored `thruput keys` key. Never logged. */
function loadKeySecret(name: string): Uint8Array {
  const dir = process.env.THRUPUT_KEYS_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "thruput/keys");
  const file = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  if (file.scheme !== "ed25519") throw new Error(`key ${name}: unsupported scheme ${file.scheme}`);
  const secret = fromHex(String(file.keypair_hex).slice(0, 64));
  const pub = toHex(ed25519.getPublicKey(secret)).slice(2);
  if (pub !== String(file.public_key_hex).toLowerCase()) throw new Error(`key ${name}: keypair does not match public key`);
  return secret;
}

function loadSecretFile(path: string): Uint8Array {
  const secret = fromHex(readFileSync(path, "utf8").trim());
  if (secret.length !== 32) throw new Error(`${path}: expected 32-byte hex secret`);
  return secret;
}

async function connect(rpcUrl: string) {
  // `devnet()` is unpinned (`localnet()` pins the all-zero hash); the network
  // hash is read from the endpoint and checked again on every signature.
  return createThruputClient({ cluster: devnet({ rpcUrl }) });
}
type Client = Awaited<ReturnType<typeof connect>>;

function walletFor(client: Client, secret: Uint8Array) {
  return createWalletClient({
    client,
    account: createPubkeyAccount({ signer: new PrivateKeySigner(secret), nonce: 0n }),
  });
}
type Wallet = ReturnType<typeof walletFor>;

export interface Deployment {
  network: string;
  networkHash: string;
  rpcUrl: string;
  explorerUrl: string | null;
  scoreContract: string;
  tokenContract: string;
  admin: string;
  deployedAt: string;
  deployTxs: Record<string, string>;
  artifacts: Record<string, { sha256: string; bytes: number }>;
}

function loadDeployment(path: string): Deployment {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function balanceHog(client: Client, address: ContractAddress): Promise<string> {
  const b = await client.getBalance(address);
  const raw = b.rawBalance;
  return `${raw / HOG}.${(raw % HOG).toString().padStart(7, "0")}`;
}

async function fund(client: Client, address: ContractAddress, times = 1) {
  for (let i = 0; i < times; i++) {
    const res = await client.requestAirdrop({ recipient: address, timeoutMs: 120_000 });
    console.log(`  airdrop ${i + 1}/${times} -> ${toHex0x(address)}: ${JSON.stringify(res, (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? toHex(v) : v))}`);
  }
}

// ---------------------------------------------------------------------------
// Contract operations.

async function deploy(deployer: Wallet, opts: { fundScoreHog: bigint; fundTokenHog: bigint }) {
  const read = (name: string) => new Uint8Array(readFileSync(join(ARTIFACTS, `${name}.rv32a`)));
  const tokenBytes = read("kalien_token");
  const scoreBytes = read("kalien_score");
  const admin = deployer.account.address;

  const tokenDep = prepareContractDeployment({ deployer: admin, contract: rv32Contract(tokenBytes) });
  const tokenRes = await deployer.deployContractAndWait(tokenDep, {
    gasLimit: gasAmount(30_000_000n),
    amount: opts.fundTokenHog * HOG,
    initializer: ERC20.v0_1.initialize.invocation(tokenDep.address, gasAmount(20_000_000n), { administrator: admin }),
  });
  console.log(`token deployed ${toHex0x(tokenRes.address)} tx ${toHex0x(tokenRes.txHash)}`);

  const scoreDep = prepareContractDeployment({ deployer: admin, contract: rv32Contract(scoreBytes) });
  const scoreRes = await deployer.deployContractAndWait(scoreDep, {
    gasLimit: gasAmount(30_000_000n),
    amount: opts.fundScoreHog * HOG,
    initializer: KalienScore.v0_1.initialize.invocation(scoreDep.address, gasAmount(20_000_000n), {
      admin,
      token: tokenRes.address,
    }),
  });
  console.log(`score deployed ${toHex0x(scoreRes.address)} tx ${toHex0x(scoreRes.txHash)}`);

  const link = await deployer.executeAndWait({
    invocation: KalienTokenAdmin.v0_1.setAdministrator.invocation(tokenRes.address, gasAmount(5_000_000n), {
      administrator: scoreRes.address,
    }),
    gasLimit: gasAmount(10_000_000n),
  });
  console.log(`token administrator -> score, tx ${toHex0x(link.txHash)}`);

  const sha = (b: Uint8Array) => toHex(tapeHash(b)); // plain sha256
  return {
    score: scoreRes.address,
    token: tokenRes.address,
    txs: {
      deployToken: toHex0x(tokenRes.txHash),
      deployScore: toHex0x(scoreRes.txHash),
      setTokenAdministrator: toHex0x(link.txHash),
    },
    artifacts: {
      kalien_token: { sha256: sha(tokenBytes), bytes: tokenBytes.length },
      kalien_score: { sha256: sha(scoreBytes), bytes: scoreBytes.length },
    },
  };
}

async function viewCurrentSeedId(client: Client, score: ContractAddress): Promise<number> {
  const r = await KalienScore.v0_1.currentSeedId.view({ client, contract: score });
  return Number(r.value);
}

async function ensureSeed(wallet: Wallet, score: ContractAddress) {
  const res = await wallet.executeCallsAndWait({
    calls: [KalienScore.v0_1.ensureCurrentSeed.call({ contract: score, gasLimit: gasAmount(5_000_000n) })] as const,
    gasLimit: gasAmount(10_000_000n),
  });
  const info = res.values[0];
  return { seedId: Number(info.seed_id), seed: Number(info.seed), txHash: toHex0x(res.txHash) };
}

async function setSeed(wallet: Wallet, score: ContractAddress, seedId: number, seed: number) {
  const res = await wallet.executeAndWait({
    invocation: KalienScore.v0_1.setSeed.invocation(score, gasAmount(5_000_000n), { seedId: BigInt(seedId), seed: BigInt(seed) }),
    gasLimit: gasAmount(10_000_000n),
  });
  return toHex0x(res.txHash);
}

export interface SubmitOutcome {
  ok: boolean;
  txHash: string;
  gasLimit: string;
  gasUsed: string | null;
  receipt?: Record<string, string>;
  error?: string;
}

const jsonable = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? toHex(v) : v;

async function submit(
  relay: Wallet,
  score: ContractAddress,
  networkHash: Uint8Array,
  playerSecret: Uint8Array,
  seedId: number,
  tape: Uint8Array,
  gasOverride?: bigint,
): Promise<SubmitOutcome> {
  const pubkey = ed25519.getPublicKey(playerSecret);
  const digest = claimMessage({ networkHash, scoreContract: score, seedId, tape });
  const signature = ed25519.sign(digest, playerSecret);
  const frames = new DataView(tape.buffer, tape.byteOffset).getUint32(12, true);
  const gasLimit = gasOverride ?? submitGasLimit(frames);
  const call = KalienScore.v0_1.submitScore.call({
    contract: score,
    gasLimit: gasAmount(gasLimit - 100_000n),
    args: { playerPubkey: fixedBytes(pubkey, 32), seedId: BigInt(seedId), tape, signature: fixedBytes(signature, 64) },
  });
  try {
    const res = await relay.executeCallsAndWait({ calls: [call] as const, gasLimit: gasAmount(gasLimit) });
    const r = res.values[0];
    const events = kalien_score.v0_1.implementation.ScoreSubmitted.allFromReceipt(res.receipt, { contractAddress: score });
    if (events.length !== 1) throw new Error(`expected 1 ScoreSubmitted event, got ${events.length}`);
    const receipt: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) receipt[k] = String(jsonable(k === "player" ? toHex0x(v as ContractAddress) : v));
    return { ok: true, txHash: toHex0x(res.txHash), gasLimit: gasLimit.toString(), gasUsed: gasUsedOf(res.receipt), receipt };
  } catch (error) {
    if (error instanceof TransactionExecutionError) {
      return {
        ok: false,
        txHash: toHex0x(error.receipt.txHash),
        gasLimit: gasLimit.toString(),
        gasUsed: gasUsedOf(error.receipt),
        error: describeFailure(error.receipt),
      };
    }
    throw error;
  }
}

function gasUsedOf(receipt: { gasUsed?: bigint } | undefined): string | null {
  return receipt?.gasUsed === undefined ? null : String(receipt.gasUsed);
}

/** `ScoreError` discriminants (kalien_score implementation.rs). */
export const SCORE_ERRORS: Record<number, string> = {
  1: "AlreadyInitialized", 2: "NotAdmin", 3: "Paused", 4: "UnknownSeed", 5: "SeedInactive",
  6: "SeedMismatch", 7: "BadSignature", 8: "AlreadyClaimed", 9: "ZeroScore", 10: "NotImproved",
  11: "SeedAlreadySet", 12: "ZeroSeed", 20: "TapeTooShort", 21: "TapeBadMagic", 22: "TapeBadVersion",
  23: "TapeBadRulesTag", 24: "TapeReservedNonZero", 25: "TapeFrameCountOutOfRange",
  26: "TapeLengthMismatch", 27: "TapeCrcMismatch", 30: "RuleViolation", 31: "FrameCountMismatch",
  32: "ScoreMismatch",
};

/** Name the contract error in a failed submit receipt (the wallet root re-throws it). */
function describeFailure(receipt: { abortData: Uint8Array | null; execResult: unknown }): string {
  if (receipt.abortData) {
    try {
      const exn = KalienScore.v0_1.submitScore.decodeException(receipt.abortData) as unknown as { kind?: string; value?: unknown };
      const code = typeof exn?.value === "bigint" ? Number(exn.value) : NaN;
      if (SCORE_ERRORS[code]) return `ScoreError::${SCORE_ERRORS[code]}`;
      return JSON.stringify(exn, (_, v) => jsonable(v));
    } catch {
      return `abort ${toHex(receipt.abortData)}`;
    }
  }
  return `execResult ${String(receipt.execResult)}`;
}

// ---------------------------------------------------------------------------
// Commands.

async function cmdFund(args: Record<string, string>) {
  const client = await connect(need(args, "rpc"));
  const wallet = walletFor(client, loadKeySecret(need(args, "key")));
  await fund(client, wallet.account.address, Number(args.times ?? 1));
  console.log(`${args.key} ${toHex0x(wallet.account.address)} balance ${await balanceHog(client, wallet.account.address)} HOG`);
}

async function cmdDeploy(args: Record<string, string>) {
  const rpcUrl = need(args, "rpc");
  const client = await connect(rpcUrl);
  const deployer = walletFor(client, loadKeySecret(need(args, "deployer-key")));
  console.log(`deployer ${toHex0x(deployer.account.address)} balance ${await balanceHog(client, deployer.account.address)} HOG`);
  const d = await deploy(deployer, {
    fundScoreHog: BigInt(args["fund-score"] ?? "20"),
    fundTokenHog: BigInt(args["fund-token"] ?? "20"),
  });
  const local = /127\.0\.0\.1|localhost/.test(rpcUrl);
  const out: Deployment = {
    network: local ? "local" : "devnet",
    networkHash: toHex0x(client.network.networkHash),
    rpcUrl,
    explorerUrl: local ? null : "https://explorer.thruput.network/",
    scoreContract: toHex0x(d.score),
    tokenContract: toHex0x(d.token),
    admin: toHex0x(deployer.account.address),
    deployedAt: new Date().toISOString(),
    deployTxs: d.txs,
    artifacts: d.artifacts,
  };
  const path = resolve(need(args, "out"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path}`);
}

async function cmdEnsureSeed(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connect(dep.rpcUrl);
  const wallet = walletFor(client, loadKeySecret(need(args, "key")));
  console.log(JSON.stringify(await ensureSeed(wallet, addressFromHex(dep.scoreContract))));
}

async function cmdSetSeed(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connect(dep.rpcUrl);
  const wallet = walletFor(client, loadKeySecret(need(args, "key")));
  const score = addressFromHex(dep.scoreContract);
  const seedId = args["seed-id"] ? Number(args["seed-id"]) : await viewCurrentSeedId(client, score);
  const seedArg = need(args, "seed");
  const seed = seedArg.startsWith("0x") ? parseInt(seedArg, 16) : Number(seedArg);
  const tx = await setSeed(wallet, score, seedId, seed);
  console.log(JSON.stringify({ seedId, seed, txHash: tx }));
}

async function cmdSubmit(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connect(dep.rpcUrl);
  const relay = walletFor(client, loadKeySecret(need(args, "relay-key")));
  const player = args["player-key"] ? loadKeySecret(args["player-key"]) : loadSecretFile(need(args, "player-secret-file"));
  const score = addressFromHex(dep.scoreContract);
  const seedId = args["seed-id"] ? Number(args["seed-id"]) : await viewCurrentSeedId(client, score);
  const tape = new Uint8Array(readFileSync(need(args, "tape")));
  const outcome = await submit(relay, score, client.network.networkHash, player, seedId, tape, args.gas ? BigInt(args.gas) : undefined);
  const playerAddress = pubkeyAccountAddress(ed25519.getPublicKey(player));
  const bal = await ERC20.v0_1.getBalanceOf.view({ client, contract: addressFromHex(dep.tokenContract), args: { addr: addressFromHex(playerAddress) } });
  console.log(JSON.stringify({ ...outcome, seedId, player: playerAddress, kalienBalance: bal.value.toString() }, null, 2));
  if (!outcome.ok) process.exitCode = 1;
}


async function cmdFixtures(args: Record<string, string>) {
  const depPath = need(args, "deployment");
  const dep = loadDeployment(depPath);
  const client = await connect(dep.rpcUrl);
  const admin = walletFor(client, loadKeySecret(need(args, "admin-key")));
  const relay = walletFor(client, loadKeySecret(need(args, "relay-key")));
  const player = loadKeySecret(need(args, "player-key"));
  const score = addressFromHex(dep.scoreContract);
  const token = addressFromHex(dep.tokenContract);
  const networkHash = client.network.networkHash;

  // Free epochs inside the active window, newest first (the current one is left to the cron).
  const now = await viewCurrentSeedId(client, score);
  const free: number[] = [];
  for (let id = now - 1; id > now - 144 && free.length < 3; id--) {
    const s = await KalienScore.v0_1.seed.view({ client, contract: score, args: { seedId: BigInt(id) } });
    if (s.value === null || s.value === undefined) free.push(id);
  }
  if (free.length < 3) throw new Error("fewer than 3 unseeded epochs in the active window");
  const plan = [
    { seedId: free[0]!, seed: 0xdeadbeef, tapes: ["test-short.tape", "test-medium.tape"] },
    { seedId: free[1]!, seed: 0x43c9c6cd, tapes: ["test-real-game.tape"] },
    { seedId: free[2]!, seed: 1_598_125_870, tapes: ["kalien-911140-seed1598125870.tape"] },
  ];
  const explorer = (hash: string) => `https://explorer.thruput.network/tx/${hash}`;
  const runs: Record<string, unknown>[] = [];
  for (const p of plan) {
    const tx = await setSeed(admin, score, p.seedId, p.seed);
    console.log(`set_seed(${p.seedId}, 0x${p.seed.toString(16)}) tx ${tx}`);
    for (const name of p.tapes) {
      const outcome = await submit(relay, score, networkHash, player, p.seedId, fixture(name));
      console.log(`${name}: ${outcome.ok ? "ok" : outcome.error} score ${outcome.receipt?.final_score} gas ${outcome.gasUsed}/${outcome.gasLimit} tx ${outcome.txHash}`);
      runs.push({ tape: name, seedId: p.seedId, seed: p.seed, setSeedTx: tx, ...outcome, explorer: explorer(outcome.txHash) });
      if (!outcome.ok) throw new Error(`${name} failed: ${outcome.error}`);
    }
  }
  const playerAddress = pubkeyAccountAddress(ed25519.getPublicKey(player));
  const bal = await ERC20.v0_1.getBalanceOf.view({ client, contract: token, args: { addr: addressFromHex(playerAddress) } });
  const result = { network: dep.networkHash, scoreContract: dep.scoreContract, tokenContract: dep.tokenContract, player: playerAddress, kalienBalance: bal.value.toString(), runs, at: new Date().toISOString() };
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), JSON.stringify(result, (_, v) => jsonable(v), 2) + "\n");
    console.log(`wrote ${args.out}`);
  }
  console.log(`player ${playerAddress} holds ${bal.value} KALIEN base units`);
}

async function cmdExportSecret(args: Record<string, string>) {
  // Raw 32-byte Ed25519 seed, lowercase hex, no 0x, no newline: the format
  // `new PrivateKeySigner(fromHex(secret))` expects. Redirect it to a file.
  if (process.stdout.isTTY) throw new Error("refusing to print a secret to a terminal; redirect stdout to a file");
  process.stdout.write(toHex(loadKeySecret(need(args, "key"))).slice(2));
}

// ---------------------------------------------------------------------------
// Local-node integration test.

const FIXTURES = join(REPO, "kalien-contract/fixtures");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function cmdIntegration(args: Record<string, string>) {
  const rpcUrl = need(args, "rpc");
  const client = await connect(rpcUrl);
  const networkHash = client.network.networkHash;
  console.log(`network ${toHex0x(networkHash)} at ${rpcUrl}`);

  // Fresh in-memory keys: the test owns them and they die with the chain.
  const rnd = () => crypto.getRandomValues(new Uint8Array(32));
  const deployer = walletFor(client, rnd());
  const relay = walletFor(client, rnd());
  const alice = rnd();
  const mallory = rnd();
  await fund(client, deployer.account.address, 3);
  await fund(client, relay.account.address, 2);
  console.log(`deployer ${await balanceHog(client, deployer.account.address)} HOG, relay ${await balanceHog(client, relay.account.address)} HOG`);

  const d = await deploy(deployer, { fundScoreHog: 3n, fundTokenHog: 3n });
  const score = d.score;
  const token = d.token;
  const results: Record<string, unknown> = { network: toHex0x(networkHash), score: toHex0x(score), token: toHex0x(token), deployTxs: d.txs };

  const admin = await KalienTokenAdmin.v0_1.administrator.view({ client, contract: token });
  check(toHex0x(admin.value) === toHex0x(score), "token administrator is the score contract");

  // The Worker cron path: anyone can create the current seed.
  const created = await ensureSeed(relay, score);
  console.log(`  ensure_current_seed -> ${JSON.stringify(created)}`);
  const current = await KalienScore.v0_1.currentSeed.view({ client, contract: score });
  check(current.value && Number(current.value.seed) === created.seed, "current_seed view returns the created seed");

  // Fixture tapes have fixed seeds: the admin fixes them on unseeded epochs in the window.
  const now = await viewCurrentSeedId(client, score);
  const shortId = now - 1;
  const realId = now - 2;
  const maxId = now - 3;
  await setSeed(deployer, score, shortId, 0xdeadbeef);
  await setSeed(deployer, score, realId, 0x43c9c6cd);
  await setSeed(deployer, score, maxId, 1_598_125_870);

  const aliceAddr = pubkeyAccountAddress(ed25519.getPublicKey(alice));
  const balanceOf = async (addr: string) =>
    (await ERC20.v0_1.getBalanceOf.view({ client, contract: token, args: { addr: addressFromHex(addr) } })).value;

  const runs: Record<string, SubmitOutcome> = {};
  runs.short = await submit(relay, score, networkHash, alice, shortId, fixture("test-short.tape"));
  check(runs.short.ok && runs.short.receipt?.final_score === "1480", `short tape accepted, score 1480 (gas ${runs.short.gasUsed})`);
  check((await balanceOf(aliceAddr)) === 1480n * HOG, "alice holds 1480 KALIEN");

  runs.medium = await submit(relay, score, networkHash, alice, shortId, fixture("test-medium.tape"));
  check(runs.medium.ok && runs.medium.receipt?.previous_best === "1480" && runs.medium.receipt?.minted_delta === String((11190n - 1480n) * HOG), `medium tape improves best, mints the delta (gas ${runs.medium.gasUsed})`);
  check((await balanceOf(aliceAddr)) === 11190n * HOG, "alice holds 11190 KALIEN");

  runs.realGame = await submit(relay, score, networkHash, alice, realId, fixture("test-real-game.tape"));
  check(runs.realGame.ok && runs.realGame.receipt?.final_score === "14870", `real-game tape accepted (gas ${runs.realGame.gasUsed})`);

  runs.maxGame = await submit(relay, score, networkHash, alice, maxId, fixture("kalien-911140-seed1598125870.tape"));
  check(runs.maxGame.ok && runs.maxGame.receipt?.final_score === "911140", `36,000-frame tape accepted, score 911140 (gas ${runs.maxGame.gasUsed})`);
  check((await balanceOf(aliceAddr)) === (11190n + 14870n + 911140n) * HOG, "alice holds the sum of her bests");

  const best = await KalienScore.v0_1.bestScore.view({ client, contract: score, args: { player: addressFromHex(aliceAddr), seedId: BigInt(shortId) } });
  check(best.value === 11190n, "best_score view");
  const claimed = await KalienScore.v0_1.isClaimed.view({ client, contract: score, args: { tapeHash: fixedBytes(tapeHash(fixture("test-short.tape")), 32) } });
  check(claimed.value === true, "is_claimed view");

  // Rejections are committed as failed executions with the contract error.
  runs.duplicate = await submit(relay, score, networkHash, mallory, shortId, fixture("test-short.tape"));
  check(!runs.duplicate.ok && runs.duplicate.error === "ScoreError::AlreadyClaimed", `duplicate tape from another player rejected: ${runs.duplicate.error}`);
  runs.notImproved = await submit(relay, score, networkHash, alice, realId, fixture("test-real-game.tape"));
  check(runs.notImproved.error === "ScoreError::NotImproved", `same tape again rejected: ${runs.notImproved.error}`);
  runs.wrongSeed = await submit(relay, score, networkHash, mallory, realId, fixture("test-medium.tape"));
  check(runs.wrongSeed.error === "ScoreError::SeedMismatch", `wrong seed rejected: ${runs.wrongSeed.error}`);
  check((await balanceOf(pubkeyAccountAddress(ed25519.getPublicKey(mallory)))) === 0n, "mallory holds 0 KALIEN");

  // Events through the indexer (what the Worker cron reads into D1).
  const page = await client.getContractEvents({
    event: kalien_score.v0_1.implementation.ScoreSubmitted,
    contractAddresses: [score],
    limit: 50,
  });
  const indexed = page.events.map((e) => ({ player: toHex0x(e.topics.player), seedId: Number(e.topics.seed_id), score: Number(e.fields.final_score), minted: e.fields.minted_delta }));
  console.log(`  indexed ScoreSubmitted: ${JSON.stringify(indexed, (_, v) => jsonable(v))}`);
  check(indexed.length === 4, "indexer returns the 4 accepted runs");
  check(indexed.every((e) => e.player === aliceAddr), "every event names alice's pubkey account");
  check(indexed.map((e) => e.score).join(",") === "1480,11190,14870,911140", "event scores in order");
  results.runs = runs;
  results.aliceAddress = aliceAddr;
  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify(results, (_, v) => jsonable(v), 2) + "\n");
    console.log(`wrote ${args.out}`);
  }
  console.log("INTEGRATION PASSED");
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const commands: Record<string, (a: Record<string, string>) => Promise<void>> = {
  fund: cmdFund,
  deploy: cmdDeploy,
  "ensure-seed": cmdEnsureSeed,
  "set-seed": cmdSetSeed,
  submit: cmdSubmit,
  fixtures: cmdFixtures,
  "export-secret": cmdExportSecret,
  integration: cmdIntegration,
};
if (import.meta.main) {
  const run = commands[command ?? ""];
  if (!run) {
    console.error(`usage: bun kalien-contract/scripts/kalien.ts <${Object.keys(commands).join("|")}> [--flags]`);
    process.exit(2);
  }
  run(args).catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  });
}
