// Smoke test for a deployed (or local) Worker.
//
//   bun worker/ops/smoke.ts [--api https://kalien-thruput.sdf-ecosystem.workers.dev] [--frames 3000]
//
// 1. GET /api/config and check the RPC reports the same network hash.
// 2. GET /api/seed/current (waits for the seed if the epoch just started).
// 3. Plays an autopilot game on that seed (cut at a random length), signs the claim with a throwaway
//    key, POSTs it, and waits until the run is confirmed.
// 4. Checks the tape download, the player's run list, the leaderboard, and health.
/* eslint-disable no-await-in-loop -- operator script: polls and steps in order */
import { AsteroidsGame } from "../../src/game/AsteroidsGame";
import type { Autopilot } from "../../src/game/Autopilot";
import { claimMessage, pubkeyAccountAddress } from "../claim";
import { bytesToHex, hexToBytes } from "../hex";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
};
const api = option("--api", "https://kalien-thruput.sdf-ecosystem.workers.dev").replace(
  /\/+$/u,
  "",
);
const maxFrames = Number(option("--frames", "3000"));
let failed = false;

function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  failed ||= !ok;
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

console.log(`smoke test: ${api}`);
const config = await json("/api/config");
const cfg = config.body as { networkHash: string; rpcUrl: string; scoreContract: string };
check(
  config.status === 200 && typeof cfg.scoreContract === "string",
  "GET /api/config",
  JSON.stringify(cfg),
);
const info = (await (
  await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetworkInfo", params: {} }),
  })
).json()) as { result?: { networkHash?: string } };
check(
  info.result?.networkHash === cfg.networkHash,
  "network hash matches the RPC",
  info.result?.networkHash,
);

let seed = (await json("/api/seed/current")).body as {
  seedId: number;
  seed: number | null;
  secondsLeft: number;
};
for (let i = 0; i < 20 && seed.seed === null; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  seed = (await json("/api/seed/current")).body as typeof seed;
}
check(
  seed.seed !== null,
  "GET /api/seed/current",
  `seedId ${seed.seedId} seed ${seed.seed} (${seed.secondsLeft}s left)`,
);
if (seed.seed === null) process.exit(1);

const game = new AsteroidsGame({ headless: true, seed: seed.seed });
game.startNewGame(seed.seed);
(game as unknown as { autopilot: Autopilot }).autopilot.setEnabled(true);
// The autopilot plays the same game on a seed, so cut it at a random length:
// each smoke run then sends a new tape.
const frames = maxFrames - Math.floor(Math.random() * Math.min(1_000, maxFrames / 2));
for (let frame = 0; frame < frames && game.getMode() !== "game-over"; frame += 1) {
  game.stepSimulation();
}
const tape = game.getTape();
if (!tape) throw new Error("no tape");

const PKCS8_PREFIX = hexToBytes("302e020100300506032b657004220420");
const key = await crypto.subtle.importKey(
  "pkcs8",
  new Uint8Array([...PKCS8_PREFIX, ...crypto.getRandomValues(new Uint8Array(32))]),
  { name: "Ed25519" },
  true,
  ["sign"],
);
const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
const pubkey = Uint8Array.from(atob((jwk.x ?? "").replace(/-/gu, "+").replace(/_/gu, "/")), (c) =>
  c.charCodeAt(0),
);
const player = pubkeyAccountAddress(pubkey);
const sig = new Uint8Array(
  await crypto.subtle.sign(
    "Ed25519",
    key,
    claimMessage({
      networkHash: cfg.networkHash,
      scoreContract: cfg.scoreContract,
      seedId: seed.seedId,
      tape,
    }) as Uint8Array<ArrayBuffer>,
  ),
);
const started = Date.now();
const post = await json(
  `/api/runs?pubkey=${bytesToHex(pubkey)}&seed_id=${seed.seedId}&sig=${bytesToHex(sig)}`,
  {
    method: "POST",
    body: tape,
  },
);
const runId = post.body.runId as string | undefined;
check(
  post.status === 202 && Boolean(runId),
  "POST /api/runs",
  `${post.status} ${post.body.status ?? post.body.error}`,
);
if (!runId) process.exit(1);

let run: Record<string, unknown> = post.body;
while (
  !["confirmed", "rejected", "failed"].includes(String(run.status)) &&
  Date.now() - started < 180_000
) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  run = (await json(`/api/runs/${runId}`)).body;
}
check(
  run.status === "confirmed",
  "run confirmed",
  `${run.status} after ${((Date.now() - started) / 1000).toFixed(1)}s: ${run.frameCount} frames, score ${run.score}, minted ${run.minted}, tx ${run.txHash}${run.error ? `, error ${run.error}` : ""}`,
);

const download = await fetch(`${api}/api/runs/${runId}/tape`);
const bytes = new Uint8Array(await download.arrayBuffer());
check(
  download.status === 200 && bytes.length === tape.length && bytes.every((b, i) => b === tape[i]),
  "GET /api/runs/:id/tape",
);

const list = (await json(`/api/runs?player=${player}`)).body as {
  runs?: Array<{ runId: string }>;
  total?: number;
};
check(list.runs?.[0]?.runId === runId, "GET /api/runs?player=", `total ${list.total}`);

const board = (await json(`/api/leaderboard?window=10m&address=${player}`)).body as {
  me?: { rank: number; score: number } | null;
};
check(
  Boolean(board.me),
  "leaderboard has the run",
  JSON.stringify(board.me ? { rank: board.me.rank, score: board.me.score } : null),
);

const health = (await json("/api/health")).body as {
  lanes?: Array<{ lane: number; address?: string; error?: string; lastError?: string | null }>;
  indexer?: { lastSyncedAt?: string | null; totalEvents?: number } | null;
};
check(
  (health.lanes ?? []).length > 0 &&
    (health.lanes ?? []).every((lane) => !lane.error && !lane.lastError),
  "GET /api/health lanes",
  (health.lanes ?? [])
    .map((lane) => `${lane.lane}:${lane.address?.slice(0, 10) ?? lane.error}`)
    .join(" "),
);
console.log(
  `indexer: last sync ${health.indexer?.lastSyncedAt ?? "never"}, ${health.indexer?.totalEvents ?? 0} events`,
);
console.log(failed ? "\nSMOKE: FAIL" : "\nSMOKE: PASS");
process.exit(failed ? 1 : 0);
