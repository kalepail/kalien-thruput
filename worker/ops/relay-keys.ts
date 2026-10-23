// Relay lane keys: list, fund, and export them for `wrangler secret put`.
//
//   bun worker/ops/relay-keys.ts                 # lanes, addresses, HOG balances
//   bun worker/ops/relay-keys.ts --fund          # airdrop to lanes under --min HOG (default 50)
//   bun worker/ops/relay-keys.ts --secrets | npx wrangler secret put RELAY_SECRETS
//
// Keys come from KALIEN_RELAY_DIR (default ~/.config/kalien-thruput): relay.secret
// is lane 0, relay-2.secret lane 1, and so on. Each file holds a 32-byte hex seed.
// --secrets refuses to write to a terminal, so the seeds are not shown.
import { PrivateKeySigner, createPubkeyAccount, fromHex0x, toHex0x } from "@thruputchain/client";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
};
const dir = process.env.KALIEN_RELAY_DIR ?? join(homedir(), ".config/kalien-thruput");
const rpcUrl = option("--rpc", process.env.THRUPUT_RPC_URL ?? "https://rpc.thruput.network");
const minHog = Number(option("--min", "50"));

const secrets: string[] = [];
for (let lane = 0; ; lane += 1) {
  const file = join(dir, lane === 0 ? "relay.secret" : `relay-${lane + 1}.secret`);
  if (!existsSync(file)) break;
  const hex = readFileSync(file, "utf8").trim().replace(/^0x/iu, "");
  if (!/^[0-9a-f]{64}$/iu.test(hex)) throw new Error(`${file} is not a 32-byte hex seed`);
  secrets.push(hex);
}
if (secrets.length === 0) throw new Error(`no relay keys in ${dir}`);

if (flag("--secrets")) {
  if (process.stdout.isTTY)
    throw new Error("--secrets writes seeds; pipe it into `wrangler secret put`");
  process.stdout.write(secrets.join(","));
  process.exit(0);
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message: string };
  };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result ?? {};
}

const hog = async (address: string) =>
  Number(BigInt(String((await rpc("groundhog_getBalance", [address])).rawBalance ?? "0"))) / 1e7;

for (const [lane, hex] of secrets.entries()) {
  const address = toHex0x(
    createPubkeyAccount({ signer: new PrivateKeySigner(fromHex0x(`0x${hex}`)) }).address,
  );
  let balance = await hog(address);
  if (flag("--fund") && balance < minHog) {
    const clientNonce = toHex0x(crypto.getRandomValues(new Uint8Array(16)));
    const attempt = await rpc("groundhog_requestAirdrop", [{ recipient: address, clientNonce }]);
    console.log(
      `lane ${lane}: airdrop ${attempt.attemptStatus ?? "sent"} tx ${attempt.txHash ?? "-"}`,
    );
    for (let i = 0; i < 30 && (await hog(address)) <= balance; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    balance = await hog(address);
  }
  console.log(`lane ${lane}: ${address} ${balance.toFixed(4)} HOG`);
}
