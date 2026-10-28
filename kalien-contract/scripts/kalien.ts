#!/usr/bin/env bun
/**
 * Kalien contract operations over JSON-RPC (wire 14, @thruputchain/client 0.23).
 *
 *   bun kalien-contract/scripts/kalien.ts <command> [--flag value ...]
 *
 * Commands
 *   fund         --rpc URL --key NAME [--times N]          faucet_requestAirdrop to a stored key
 *   balance      --rpc URL --key NAME                       free HOG of a stored key (whole HOG, for scripts)
 *   network-hash --rpc URL                                  base58 network hash of the endpoint
 *   deploy       --rpc URL --deployer-key NAME --out FILE [--fund-score HOG] [--fund-token HOG]
 *   ensure-seed  --deployment FILE --key NAME               create the current epoch seed
 *   set-seed     --deployment FILE --key NAME --seed HEX|DEC [--seed-id N]   admin only
 *   submit       --deployment FILE --relay-key NAME --tape FILE
 *                (--player-key NAME | --player-secret-file FILE) [--seed-id N] [--gas N]
 *   fixtures     --deployment FILE --admin-key NAME --relay-key NAME --player-key NAME [--out FILE]
 *                [--epoch-margin N]
 *                fix fixture seeds on free epochs near the end of the active window (they expire
 *                within about an hour), submit the fixture tapes, claim every other repo tape
 *                with a fixture seed (throwaway keys), and record `fixtureSeedIds` in FILE
 *   harden       --deployment FILE --admin-key NAME --relay-keys NAME,NAME,... [--lock-seeding]
 *                allow the relays, turn on relay-only mode, optionally lock set_seed for good
 *   export-secret --key NAME                               print the 32-byte seed as hex (for the Worker secret file)
 *   integration  --rpc URL [--out FILE]                     full local-node test with fresh keys
 *
 * Keys are read from ~/.config/thruput/keys/<NAME>.json (the `thruput keys` store) and
 * are never printed. Pubkey accounts use nonce 0, like the browser wallet. Identifiers in
 * output files are base58, as on the wire.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  Ed25519Signer,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  futurenet,
  prepareContractDeployment,
  rv32Contract,
  toBase58,
} from "@thruputchain/client";
import { gasAmount, type ContractAddress } from "@thruputchain/protocol";
import { KalienScore } from "../../shared/thruput/bindings/kalien-score";
import { ERC20, KalienTokenAdmin } from "../../shared/thruput/bindings/kalien-token";
import { claimMessage, fromHex, pubkeyAccountAddress, tapeHash, toHex } from "../../shared/thruput/claim";
import {
  ACTIVE_EPOCHS,
  EPOCH_SECONDS,
  connectKalien,
  ensureCurrentSeed,
  getCurrentSeedId,
  getKalienBalance,
  getRelays,
  getScoreConfig,
  getScoreSubmittedPage,
  getSeed,
  isTapeClaimed,
  jsonReplacer,
  parseAddress,
  submitScore,
  type KalienClient,
  type KalienConfig,
  type SubmitScoreResult,
} from "../../shared/thruput/kalien";

const REPO = resolve(import.meta.dir, "../..");
const ARTIFACTS = join(REPO, "kalien-contract/target/thruput");
const FIXTURES = join(REPO, "kalien-contract/fixtures");
const HOG = 10_000_000n;
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const json = (value: unknown) => JSON.stringify(value, jsonReplacer, 2);

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

/** Unpinned client (deploy time: the network hash is read from the endpoint). */
async function connectRpc(rpcUrl: string) {
  return createThruputClient({ cluster: futurenet({ rpcUrl }) });
}
type AnyClient = Awaited<ReturnType<typeof connectRpc>> | KalienClient;

function walletFor(client: AnyClient, secret: Uint8Array) {
  return createWalletClient({ client: client as KalienClient, account: createPubkeyAccount({ signer: Ed25519Signer.fromSeed(secret), nonce: 0n }) });
}
type Wallet = ReturnType<typeof walletFor>;

export interface Deployment extends KalienConfig {
  network: string;
  explorerUrl: string | null;
  admin: string;
  deployedAt: string;
  deployTxs: Record<string, string>;
  artifacts: Record<string, { sha256: string; bytes: number }>;
}

function loadDeployment(path: string): Deployment {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function balanceHog(client: AnyClient, address: ContractAddress): Promise<string> {
  const raw = (await client.getBalance({ address })).rawBalance;
  return `${raw / HOG}.${(raw % HOG).toString().padStart(7, "0")}`;
}

async function fund(client: AnyClient, address: ContractAddress, times = 1) {
  for (let i = 0; i < times; i++) {
    const res = await (client as KalienClient).requestAirdrop({ recipient: address, timeoutMs: 120_000 });
    console.log(`  airdrop ${i + 1}/${times} -> ${toBase58(address)}: ${res.rawAmount / HOG} HOG tx ${toBase58(res.transactionHash)}`);
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
  console.log(`token deployed ${toBase58(tokenRes.address)} tx ${toBase58(tokenRes.transactionHash)}`);

  const scoreDep = prepareContractDeployment({ deployer: admin, contract: rv32Contract(scoreBytes) });
  const scoreRes = await deployer.deployContractAndWait(scoreDep, {
    gasLimit: gasAmount(30_000_000n),
    amount: opts.fundScoreHog * HOG,
    initializer: KalienScore.v0_1.initialize.invocation(scoreDep.address, gasAmount(20_000_000n), { admin, token: tokenRes.address }),
  });
  console.log(`score deployed ${toBase58(scoreRes.address)} tx ${toBase58(scoreRes.transactionHash)}`);

  const link = await deployer.executeAndWait({
    invocation: KalienTokenAdmin.v0_1.setAdministrator.invocation(tokenRes.address, gasAmount(5_000_000n), { administrator: scoreRes.address }),
    gasLimit: gasAmount(10_000_000n),
  });
  console.log(`token administrator -> score, tx ${toBase58(link.transactionHash)}`);

  const sha = (b: Uint8Array) => toHex(tapeHash(b)); // plain sha256
  return {
    score: scoreRes.address,
    token: tokenRes.address,
    txs: {
      deployToken: toBase58(tokenRes.transactionHash),
      deployScore: toBase58(scoreRes.transactionHash),
      setTokenAdministrator: toBase58(link.transactionHash),
    },
    artifacts: {
      kalien_token: { sha256: sha(tokenBytes), bytes: tokenBytes.length },
      kalien_score: { sha256: sha(scoreBytes), bytes: scoreBytes.length },
    },
  };
}

async function setSeed(wallet: Wallet, config: KalienConfig, seedId: number, seed: number) {
  const res = await wallet.executeAndWait({
    invocation: KalienScore.v0_1.setSeed.invocation(parseAddress(config.scoreContract), gasAmount(5_000_000n), { seedId: BigInt(seedId), seed: BigInt(seed) }),
    gasLimit: gasAmount(10_000_000n),
  });
  return toBase58(res.transactionHash);
}

/** Sign the claim with the player key and submit it through the relay (shared helper). */
async function submitSigned(relay: Wallet, config: KalienConfig, playerSecret: Uint8Array, seedId: number, tape: Uint8Array, gasLimit?: bigint) {
  const signature = ed25519.sign(claimMessage({ networkHash: config.networkHash, scoreContract: config.scoreContract, seedId, tape }), playerSecret);
  return submitScore(relay, config, { playerPubkey: ed25519.getPublicKey(playerSecret), seedId, tape, signature }, gasLimit ? { gasLimit } : {});
}

// ---------------------------------------------------------------------------
// Commands.

async function cmdFund(args: Record<string, string>) {
  const client = await connectRpc(need(args, "rpc"));
  const wallet = walletFor(client, loadKeySecret(need(args, "key")));
  await fund(client, wallet.account.address, Number(args.times ?? 1));
  console.log(`${args.key} ${toBase58(wallet.account.address)} balance ${await balanceHog(client, wallet.account.address)} HOG`);
}

async function cmdNetworkHash(args: Record<string, string>) {
  console.log(toBase58((await connectRpc(need(args, "rpc"))).network.networkHash));
}

async function cmdBalance(args: Record<string, string>) {
  const client = await connectRpc(need(args, "rpc"));
  const address = walletFor(client, loadKeySecret(need(args, "key"))).account.address;
  console.log(((await client.getBalance({ address })).rawBalance / HOG).toString());
}

async function cmdDeploy(args: Record<string, string>) {
  const rpcUrl = need(args, "rpc");
  const client = await connectRpc(rpcUrl);
  const deployer = walletFor(client, loadKeySecret(need(args, "deployer-key")));
  console.log(`deployer ${toBase58(deployer.account.address)} balance ${await balanceHog(client, deployer.account.address)} HOG`);
  const d = await deploy(deployer, {
    fundScoreHog: BigInt(args["fund-score"] ?? "50"),
    fundTokenHog: BigInt(args["fund-token"] ?? "50"),
  });
  const local = /127\.0\.0\.1|localhost/.test(rpcUrl);
  const out: Deployment = {
    network: local ? "local" : "futurenet",
    networkHash: toBase58(client.network.networkHash),
    rpcUrl,
    explorerUrl: local ? null : "https://explorer.thruput.network/",
    scoreContract: toBase58(d.score),
    tokenContract: toBase58(d.token),
    admin: toBase58(deployer.account.address),
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
  const client = await connectKalien(dep);
  console.log(json(await ensureCurrentSeed(walletFor(client, loadKeySecret(need(args, "key"))), dep)));
}

async function cmdSetSeed(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connectKalien(dep);
  const wallet = walletFor(client, loadKeySecret(need(args, "key")));
  const seedId = args["seed-id"] ? Number(args["seed-id"]) : await getCurrentSeedId(client, dep);
  const seedArg = need(args, "seed");
  const seed = seedArg.startsWith("0x") ? parseInt(seedArg, 16) : Number(seedArg);
  console.log(json({ seedId, seed, transactionHash: await setSeed(wallet, dep, seedId, seed) }));
}

async function cmdSubmit(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connectKalien(dep);
  const relay = walletFor(client, loadKeySecret(need(args, "relay-key")));
  const player = args["player-key"] ? loadKeySecret(args["player-key"]) : loadSecretFile(need(args, "player-secret-file"));
  const seedId = args["seed-id"] ? Number(args["seed-id"]) : await getCurrentSeedId(client, dep);
  const tape = new Uint8Array(readFileSync(need(args, "tape")));
  const outcome = await submitSigned(relay, dep, player, seedId, tape, args.gas ? BigInt(args.gas) : undefined);
  const playerAddress = pubkeyAccountAddress(ed25519.getPublicKey(player));
  console.log(json({ ...outcome, seedId, player: playerAddress, kalienBalance: await getKalienBalance(client, dep, playerAddress) }));
  if (outcome.status !== "confirmed") process.exitCode = 1;
}

/** Every `.tape` file in the repo (git-tracked plus kalien-contract/fixtures), deduped by sha256. */
function repoTapes(): { path: string; bytes: Uint8Array; seed: number }[] {
  const listed = execFileSync("git", ["-C", REPO, "ls-files", "*.tape"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const seen = new Set<string>();
  const out: { path: string; bytes: Uint8Array; seed: number }[] = [];
  for (const rel of listed) {
    const bytes = new Uint8Array(readFileSync(join(REPO, rel)));
    if (bytes.length < 24) continue;
    const key = toHex(tapeHash(bytes));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: rel, bytes, seed: new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true) });
  }
  return out;
}

async function cmdFixtures(args: Record<string, string>) {
  const depPath = need(args, "deployment");
  const dep = loadDeployment(depPath);
  const client = await connectKalien(dep);
  const admin = walletFor(client, loadKeySecret(need(args, "admin-key")));
  const relay = walletFor(client, loadKeySecret(need(args, "relay-key")));
  const player = loadKeySecret(need(args, "player-key"));

  // Fixture seeds are public (their tapes are in the repo), so use unseeded epochs near the old
  // end of the active window: they expire soon. `--epoch-margin` epochs (10 min each) are kept
  // in hand so the epochs stay active for the whole run.
  const margin = Number(args["epoch-margin"] ?? 4);
  const now = await getCurrentSeedId(client, dep);
  const free: number[] = [];
  for (let id = now - (ACTIVE_EPOCHS - 1) + margin; id < now && free.length < 3; id++) {
    if ((await getSeed(client, dep, id)) === null) free.push(id);
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
    const tx = await setSeed(admin, dep, p.seedId, p.seed);
    console.log(`set_seed(${p.seedId}, 0x${p.seed.toString(16)}) tx ${tx}`);
    for (const name of p.tapes) {
      const outcome = await submitSigned(relay, dep, player, p.seedId, fixture(name));
      console.log(`${name}: ${outcome.status} ${outcome.errorName ?? ""} score ${outcome.run?.finalScore} gas ${outcome.gasUsed}/${outcome.gasLimit} tx ${outcome.transactionHash}`);
      runs.push({ tape: name, seedId: p.seedId, seed: p.seed, setSeedTx: tx, ...outcome, explorer: explorer(outcome.transactionHash) });
      if (outcome.status !== "confirmed") throw new Error(`${name} failed: ${json(outcome)}`);
    }
  }

  // Claim every other public tape for a fixture seed, so nobody can mint with it. Each gets a
  // throwaway key (a lower score than the test player's best would be NotImproved for that key).
  const seedToEpoch = new Map(plan.map((p) => [p.seed, p.seedId]));
  const claims: Record<string, unknown>[] = [];
  for (const tape of repoTapes()) {
    const seedId = seedToEpoch.get(tape.seed);
    if (seedId === undefined || (await isTapeClaimed(client, dep, tape.bytes))) continue;
    const outcome = await submitSigned(relay, dep, crypto.getRandomValues(new Uint8Array(32)), seedId, tape.bytes);
    console.log(`claim ${tape.path}: ${outcome.status} ${outcome.errorName ?? ""} score ${outcome.run?.finalScore ?? "-"} tx ${outcome.transactionHash}`);
    claims.push({ tape: tape.path, seedId, seed: tape.seed, status: outcome.status, errorName: outcome.errorName, finalScore: outcome.run?.finalScore ?? null, transactionHash: outcome.transactionHash });
  }

  // Record the fixture epochs: the Worker refuses them by default.
  const epochs = plan.map((p) => ({ seedId: p.seedId, seed: p.seed, activeUntil: new Date((p.seedId + ACTIVE_EPOCHS) * EPOCH_SECONDS * 1000).toISOString() }));
  const updated = { ...loadDeployment(depPath), fixtureSeedIds: epochs.map((e) => e.seedId), fixtureEpochs: epochs };
  writeFileSync(resolve(depPath), JSON.stringify(updated, null, 2) + "\n");
  console.log(`recorded fixtureSeedIds ${updated.fixtureSeedIds.join(", ")} in ${depPath}`);

  const playerAddress = pubkeyAccountAddress(ed25519.getPublicKey(player));
  const balance = await getKalienBalance(client, dep, playerAddress);
  const result = { network: dep.networkHash, scoreContract: dep.scoreContract, tokenContract: dep.tokenContract, player: playerAddress, kalienBalance: balance, fixtureEpochs: epochs, runs, claims, at: new Date().toISOString() };
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), json(result) + "\n");
    console.log(`wrote ${args.out}`);
  }
  console.log(`player ${playerAddress} holds ${balance} KALIEN base units`);
}

async function cmdHarden(args: Record<string, string>) {
  const dep = loadDeployment(need(args, "deployment"));
  const client = await connectKalien(dep);
  const admin = walletFor(client, loadKeySecret(need(args, "admin-key")));
  const relayKeys = need(args, "relay-keys").split(",").filter(Boolean);
  const relays = relayKeys.map((k) => walletFor(client, loadKeySecret(k)).account.address);
  const score = parseAddress(dep.scoreContract);
  const invocations = relays.map((relay) => KalienScore.v0_1.addRelay.invocation(score, gasAmount(5_000_000n), { relay }));
  invocations.push(KalienScore.v0_1.setRelayOnly.invocation(score, gasAmount(5_000_000n), { relayOnly: true }));
  if (args["lock-seeding"] === "true") invocations.push(KalienScore.v0_1.lockSeeding.invocation(score, gasAmount(5_000_000n)));
  const txs: string[] = [];
  for (const invocation of invocations) {
    const res = await admin.executeAndWait({ invocation, gasLimit: gasAmount(10_000_000n) });
    txs.push(toBase58(res.transactionHash));
  }
  const cfg = await getScoreConfig(client, dep);
  const allowed = await getRelays(client, dep);
  console.log(JSON.stringify({ relays: allowed, relayKeys, relayOnly: cfg.relayOnly, seedingLocked: cfg.seedingLocked, txs }));
  for (const r of relays) if (!allowed.includes(toBase58(r))) throw new Error(`relay ${toBase58(r)} not allowed`);
  if (!cfg.relayOnly) throw new Error("relay-only mode is off");
}

async function cmdExportSecret(args: Record<string, string>) {
  // Raw 32-byte Ed25519 seed, lowercase hex, no 0x, no newline: the format
  // `Ed25519Signer.fromSeed(fromHex(secret))` expects. Redirect it to a file.
  if (process.stdout.isTTY) throw new Error("refusing to print a secret to a terminal; redirect stdout to a file");
  process.stdout.write(toHex(loadKeySecret(need(args, "key"))).slice(2));
}

// ---------------------------------------------------------------------------
// Local-node integration test.

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function cmdIntegration(args: Record<string, string>) {
  const rpcUrl = need(args, "rpc");
  const raw = await connectRpc(rpcUrl);
  console.log(`network ${toBase58(raw.network.networkHash)} at ${rpcUrl}`);

  // Fresh in-memory keys: the test owns them and they die with the chain.
  const rnd = () => crypto.getRandomValues(new Uint8Array(32));
  const deployer = walletFor(raw, rnd());
  const relaySecret = rnd();
  const alice = rnd();
  const mallory = rnd();
  await fund(raw, deployer.account.address, 3);
  await fund(raw, walletFor(raw, relaySecret).account.address, 2);

  const d = await deploy(deployer, { fundScoreHog: 3n, fundTokenHog: 3n });
  const config: KalienConfig = { networkHash: toBase58(raw.network.networkHash), rpcUrl, scoreContract: toBase58(d.score), tokenContract: toBase58(d.token) };
  const client = await connectKalien(config);
  const relay = walletFor(client, relaySecret);

  const tokenAdmin = await KalienTokenAdmin.v0_1.administrator.view({ client, address: d.token });
  check(toBase58(tokenAdmin.value) === config.scoreContract, "token administrator is the score contract");
  console.log(`  ensure_current_seed -> ${json(await ensureCurrentSeed(relay, config))}`);

  const now = await getCurrentSeedId(client, config);
  const [shortId, realId, maxId] = [now - 1, now - 2, now - 3];
  await setSeed(deployer, config, shortId, 0xdeadbeef);
  await setSeed(deployer, config, realId, 0x43c9c6cd);
  await setSeed(deployer, config, maxId, 1_598_125_870);
  // Relay-only with the test relay allowed, as on Futurenet.
  for (const invocation of [
    KalienScore.v0_1.addRelay.invocation(d.score, gasAmount(5_000_000n), { relay: relay.account.address }),
    KalienScore.v0_1.setRelayOnly.invocation(d.score, gasAmount(5_000_000n), { relayOnly: true }),
  ]) {
    await deployer.executeAndWait({ invocation, gasLimit: gasAmount(10_000_000n) });
  }

  const aliceAddr = pubkeyAccountAddress(ed25519.getPublicKey(alice));
  const runs: Record<string, SubmitScoreResult> = {};
  runs.short = await submitSigned(relay, config, alice, shortId, fixture("test-short.tape"));
  check(runs.short.status === "confirmed" && runs.short.run?.finalScore === 1480, `short tape accepted (gas ${runs.short.gasUsed})`);
  runs.medium = await submitSigned(relay, config, alice, shortId, fixture("test-medium.tape"));
  check(runs.medium.run?.previousBest === 1480 && runs.medium.run?.mintedDelta === (11190n - 1480n) * HOG, "medium improves and mints the delta");
  runs.realGame = await submitSigned(relay, config, alice, realId, fixture("test-real-game.tape"));
  check(runs.realGame.run?.finalScore === 14870, `real-game tape accepted (gas ${runs.realGame.gasUsed})`);
  runs.maxGame = await submitSigned(relay, config, alice, maxId, fixture("kalien-911140-seed1598125870.tape"));
  check(runs.maxGame.run?.finalScore === 911140, `36,000-frame tape accepted (gas ${runs.maxGame.gasUsed})`);
  check((await getKalienBalance(client, config, aliceAddr)) === (11190n + 14870n + 911140n) * HOG, "alice holds the sum of her bests");

  runs.duplicate = await submitSigned(relay, config, mallory, shortId, fixture("test-short.tape"));
  check(runs.duplicate.errorName === "AlreadyClaimed", `duplicate tape rejected: ${runs.duplicate.errorName}`);
  runs.notRelay = await submitSigned(deployer, config, mallory, realId, fixture("test-medium.tape"));
  check(runs.notRelay.errorName === "NotRelay", `non-relay sender rejected: ${runs.notRelay.errorName}`);

  const page = await getScoreSubmittedPage(client, config, { start: { order: "ascending" }, limit: 50 });
  check(page.rows.map((r) => r.finalScore).join(",") === "1480,11190,14870,911140", "indexed events in order");
  check(page.rows.every((r) => r.player === aliceAddr && r.relay === toBase58(relay.account.address)), "events name alice and the relay");

  if (args.out) writeFileSync(resolve(args.out), json({ config, deployTxs: d.txs, runs, aliceAddress: aliceAddr }) + "\n");
  console.log("INTEGRATION PASSED");
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const commands: Record<string, (a: Record<string, string>) => Promise<void>> = {
  fund: cmdFund,
  balance: cmdBalance,
  "network-hash": cmdNetworkHash,
  deploy: cmdDeploy,
  "ensure-seed": cmdEnsureSeed,
  "set-seed": cmdSetSeed,
  submit: cmdSubmit,
  fixtures: cmdFixtures,
  harden: cmdHarden,
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
