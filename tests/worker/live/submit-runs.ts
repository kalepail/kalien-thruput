// Live end-to-end check against a running Worker (local or deployed).
//
//   bun tests/worker/live/submit-runs.ts --api http://127.0.0.1:5174 \
//     test-fixtures/test-short.tape:2987988 [more tape:seedId ...]
//
// Makes a throwaway player key (or reads PLAYER_SEED_HEX), signs each claim,
// submits it, polls until the run is final, then checks the tape download,
// the player's run list, and the leaderboard.
import { readFileSync } from "fs";
import { claimMessage, pubkeyAccountAddress } from "../../../worker/claim";
import { bytesToHex, hexToBytes } from "../../../worker/hex";

const args = process.argv.slice(2);
const apiIndex = args.indexOf("--api");
const api = apiIndex >= 0 ? args[apiIndex + 1] : "http://127.0.0.1:5174";
const runs = args.filter((arg, index) => arg !== "--api" && index !== apiIndex + 1);

const PKCS8_PREFIX = hexToBytes("302e020100300506032b657004220420");
const seed = process.env.PLAYER_SEED_HEX
  ? hexToBytes(process.env.PLAYER_SEED_HEX)
  : crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey(
  "pkcs8",
  new Uint8Array([...PKCS8_PREFIX, ...seed]),
  { name: "Ed25519" },
  true,
  ["sign"],
);
const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
const pubkey = Uint8Array.from(atob((jwk.x ?? "").replace(/-/gu, "+").replace(/_/gu, "/")), (c) =>
  c.charCodeAt(0),
);
const address = pubkeyAccountAddress(pubkey);

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const config = (await json("/api/config")).body as { networkHash: string; scoreContract: string };
console.log(`api ${api}\nplayer ${address}\nscore contract ${config.scoreContract}`);

// Phase 1: submit every run. Phase 2: poll them all. Runs for the same
// player and seed then race, which exercises the contract's own checks.
let failures = 0;
const expectRejected = new Set(
  (process.env.EXPECT_REJECTED ?? "").split(",").filter((value) => value.length > 0),
);
const submitted: Array<{ file: string; tape: Uint8Array; runId: string; started: number }> = [];
for (const spec of runs) {
  const [file = "", seedIdRaw] = spec.split(":");
  const tape = new Uint8Array(readFileSync(file));
  const seedId = Number(seedIdRaw);
  const sig = await crypto.subtle.sign(
    "Ed25519",
    key,
    claimMessage({ ...config, seedId, tape }) as Uint8Array<ArrayBuffer>,
  );
  const submit = await json(
    `/api/runs?pubkey=0x${bytesToHex(pubkey)}&seed_id=${seedId}&sig=${bytesToHex(new Uint8Array(sig))}`,
    { method: "POST", body: tape },
  );
  console.log(
    `${file} seed_id=${seedId}: POST ${submit.status} ${submit.body.status ?? ""} ${submit.body.error ?? ""}`,
  );
  const runId = submit.body.runId as string | undefined;
  if (submit.status >= 400 || !runId) {
    failures += expectRejected.has(file) ? 0 : 1;
    continue;
  }
  submitted.push({ file, tape, runId, started: Date.now() });
}

for (const { file, tape, runId, started } of submitted) {
  let run: Record<string, unknown> = { status: "queued" };
  while (!["confirmed", "rejected", "failed"].includes(String(run.status))) {
    if (Date.now() - started > 180_000) {
      console.log("  timed out");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = (await json(`/api/runs/${runId}`)).body;
  }
  console.log(
    `${file}: ${run.status} after ${((Date.now() - started) / 1000).toFixed(1)}s score=${run.score} prev=${run.previousBest} minted=${run.minted} tx=${run.txHash} attempts=${run.attempts} error=${run.error}`,
  );
  if (run.status !== "confirmed") {
    failures += expectRejected.has(file) && run.status === "rejected" ? 0 : 1;
    continue;
  }
  const tapeResponse = await fetch(`${api}/api/runs/0x${runId}/tape`);
  const fetched = new Uint8Array(await tapeResponse.arrayBuffer());
  const same = fetched.length === tape.length && fetched.every((byte, i) => byte === tape[i]);
  console.log(`  tape download ${tapeResponse.status} identical=${same}`);
  if (!same) failures += 1;
}

const list = (await json(`/api/runs?player=${address}`)).body as {
  runs: Array<Record<string, unknown>>;
};
console.log(
  `\nruns for player: ${list.runs.map((r) => `${r.seedId}:${r.status}:${r.score}`).join(", ")}`,
);
console.log(failures === 0 ? "\nRESULT: PASS" : `\nRESULT: ${failures} unexpected outcome(s)`);
const board = (await json(`/api/leaderboard?window=all&address=${address}`)).body as {
  me: Record<string, unknown> | null;
  pagination: { total: number };
};
console.log(`leaderboard total=${board.pagination.total} me=${JSON.stringify(board.me)}`);
const player = (await json(`/api/leaderboard/player/${address}`)).body as {
  player: { stats: unknown };
};
console.log(`player stats ${JSON.stringify(player.player.stats)}`);
process.exit(failures === 0 ? 0 : 1);
