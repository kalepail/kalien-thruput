// Record real devnet JSON-RPC responses that shared/thruput/kalien.test.ts replays offline.
// Usage (repo root): bun kalien-contract/scripts/record-rpc-fixtures.ts [--write]
// --write also runs submitScore on devnet once (test-long.tape on a free epoch: accepted,
// then the same tape again: rejected) with kalien-relay / kalien-test-player, and records
// both receipts. It needs ~/.config/kalien-thruput/relay.secret and the stored keys.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ed25519 } from "@noble/curves/ed25519";
import { join } from "node:path";
import { HttpTransport, type Transport } from "@thruputchain/client";
import deployment from "../../shared/thruput/deployments/devnet.json";
import runs from "../deployments/devnet-fixture-runs.json";
import {
  connectKalien,
  createRelayWallet,
  getCurrentSeedId,
  getScoreSubmittedPage,
  getSeed,
  getSubmitResult,
  getTokenMetadata,
  jsonReplacer,
  readPlayerState,
  submitScore,
} from "../../shared/thruput/kalien";
import { claimMessage, fromHex, toHex } from "../../shared/thruput/claim";
import { KalienScore } from "../../shared/thruput/bindings/kalien-score";
import { gasAmount } from "@thruputchain/protocol";
import { addressFromHex, createPubkeyAccount, createWalletClient, PrivateKeySigner } from "@thruputchain/client";

interface Exchange { method: string; params: unknown; result: unknown }
const log: Exchange[] = [];
const http = new HttpTransport(deployment.rpcUrl);
const recorder: Transport = {
  async request<T>(method: string, params?: unknown[], options?: unknown) {
    const result = await http.request<T>(method, params, options as never);
    log.push({ method, params, result });
    return result;
  },
};

const client = await connectKalien(deployment, { transport: recorder });
await getScoreSubmittedPage(client, deployment, { limit: 10 });
await getScoreSubmittedPage(client, deployment, { player: runs.player, seedId: runs.runs[0]!.seedId, limit: 10 });
await readPlayerState(client, deployment, runs.player, runs.runs[0]!.seedId);
await getTokenMetadata(client, deployment);
await getSubmitResult(client, deployment, runs.runs[3]!.txHash);
const out = join(import.meta.dir, "../../shared/thruput/test-data/devnet-rpc.json");
const previous = (() => {
  try {
    return JSON.parse(readFileSync(out, "utf8"));
  } catch {
    return {};
  }
})();
let writes = previous.writes ?? null;

if (process.argv.includes("--write")) {
  const keySecret = (name: string) =>
    fromHex(JSON.parse(readFileSync(join(homedir(), ".config/thruput/keys", `${name}.json`), "utf8")).keypair_hex.slice(0, 64));
  const live = await connectKalien(deployment);
  const relay = createRelayWallet(live, readFileSync(join(homedir(), ".config/kalien-thruput/relay.secret"), "utf8"));
  const admin = createWalletClient({ client: live, account: createPubkeyAccount({ signer: new PrivateKeySigner(keySecret("kalien-deployer")), nonce: 0n }) });
  const player = keySecret("kalien-test-player");
  const now = await getCurrentSeedId(live, deployment);
  let seedId = now - 4;
  while ((await getSeed(live, deployment, seedId)) !== null) seedId--;
  await admin.executeAndWait({
    invocation: KalienScore.v0_1.setSeed.invocation(addressFromHex(deployment.scoreContract), gasAmount(5_000_000n), { seedId: BigInt(seedId), seed: 0x7f80916en }),
    gasLimit: gasAmount(10_000_000n),
  });
  const tape = new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/test-long.tape")));
  const sign = () => ed25519.sign(claimMessage({ networkHash: deployment.networkHash, scoreContract: deployment.scoreContract, seedId, tape }), player);
  const signedHashes: string[] = [];
  const input = { playerPubkey: ed25519.getPublicKey(player), seedId, tape, signature: sign() };
  const accepted = await submitScore(relay, deployment, input, { onSigned: ({ txHash }) => void signedHashes.push(txHash) });
  const rejected = await submitScore(relay, deployment, input, { onSigned: ({ txHash }) => void signedHashes.push(txHash) });
  console.log("accepted", JSON.stringify(accepted, jsonReplacer));
  console.log("rejected", JSON.stringify(rejected, jsonReplacer));
  const receipt = (h: string) => http.request("groundhog_getTransactionReceipt", [h]);
  writes = {
    seedId,
    signedHashes,
    accepted: JSON.parse(JSON.stringify(accepted, jsonReplacer)),
    rejected: JSON.parse(JSON.stringify(rejected, jsonReplacer)),
    acceptedReceipt: await receipt(accepted.txHash),
    rejectedReceipt: await receipt(rejected.txHash),
  };
  void toHex;
}

writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), deployment, player: runs.player, exchanges: log, writes }, null, 2) + "\n");
console.log(`recorded ${log.length} exchanges -> ${out}`);
