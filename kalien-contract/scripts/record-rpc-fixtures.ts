// Record real devnet JSON-RPC responses that shared/thruput/kalien.test.ts replays offline.
// Usage (repo root): bun kalien-contract/scripts/record-rpc-fixtures.ts [--write]
// --write also runs submitScore on devnet once (a fixture tape that is no longer an
// improvement: rejected NotImproved) with kalien-relay / kalien-test-player, and records it
// with the accepted 36,000-frame fixture receipt. It needs ~/.config/kalien-thruput/relay.secret.
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
  getClaimedSeedId,
  getRelays,
  getScoreSubmittedPage,
  getSubmitResult,
  getTokenMetadata,
  jsonReplacer,
  readPlayerState,
  submitScore,
} from "../../shared/thruput/kalien";
import { claimMessage, fromHex } from "../../shared/thruput/claim";

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
await getClaimedSeedId(client, deployment, new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/test-short.tape"))));
await getRelays(client, deployment);
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
  // Accepted: the deploy's 36,000-frame fixture run. Rejected: submit the short fixture
  // again for the same player and epoch (medium beat it), through submitScore.
  const live = await connectKalien(deployment);
  const relay = createRelayWallet(live, readFileSync(join(homedir(), ".config/kalien-thruput/relay.secret"), "utf8"));
  const player = fromHex(JSON.parse(readFileSync(join(homedir(), ".config/thruput/keys/kalien-test-player.json"), "utf8")).keypair_hex.slice(0, 64));
  const short = runs.runs[0]!;
  const tape = new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures", short.tape)));
  const signature = ed25519.sign(claimMessage({ networkHash: deployment.networkHash, scoreContract: deployment.scoreContract, seedId: short.seedId, tape }), player);
  const signedHashes: string[] = [];
  const rejected = await submitScore(relay, deployment, { playerPubkey: ed25519.getPublicKey(player), seedId: short.seedId, tape, signature }, { onSigned: ({ txHash }) => void signedHashes.push(txHash) });
  const accepted = await getSubmitResult(live, deployment, runs.runs[3]!.txHash, BigInt(runs.runs[3]!.gasLimit));
  console.log("accepted", JSON.stringify(accepted, jsonReplacer));
  console.log("rejected", JSON.stringify(rejected, jsonReplacer));
  const receipt = (h: string) => http.request("groundhog_getTransactionReceipt", [h]);
  writes = {
    signedHashes,
    accepted: JSON.parse(JSON.stringify(accepted, jsonReplacer)),
    rejected: JSON.parse(JSON.stringify(rejected, jsonReplacer)),
    acceptedReceipt: await receipt(accepted.txHash),
    rejectedReceipt: await receipt(rejected.txHash),
  };
}

writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), deployment, player: runs.player, exchanges: log, writes }, null, 2) + "\n");
console.log(`recorded ${log.length} exchanges -> ${out}`);
