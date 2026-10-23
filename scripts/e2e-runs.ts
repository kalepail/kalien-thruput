/**
 * End-to-end run test against the Kalien Worker API v0:
 * generate tapes on the current seed -> sign and POST /api/runs -> poll
 * /api/runs/:id -> check score, previous best, minted KALIEN, the run list,
 * the leaderboard entry, and the stored tape. Also checks that the API
 * refuses a bad signature, a wrong seed, and a non-improving replay.
 *
 * Usage:
 *   bun run scripts/e2e-runs.ts [--api-url <url>] [--runs <n>] [--key <path>]
 *                               [--timeout-sec <n>] [--skip-negative]
 *
 * Defaults: --api-url $KALIEN_API_URL or http://localhost:8787, --runs 2,
 * a fresh throwaway key in the OS temp dir (so each run is a new player).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsteroidsGame } from "../src/game/AsteroidsGame";
import { Autopilot } from "../src/game/Autopilot";
import { KalienApi, type RunRecord } from "../cli/src/api/client";
import { bytesToHex } from "../cli/src/identity/claim";
import { loadOrCreateIdentity } from "../cli/src/identity/keyfile";

const KALIEN_UNITS = 10_000_000n; // 7 decimals

let apiUrl = process.env.KALIEN_API_URL ?? "http://localhost:8787";
let runs = 2;
let keyPath = "";
let timeoutSec = 600;
let negative = true;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--api-url" && args[i + 1]) apiUrl = args[++i];
  else if (args[i] === "--runs" && args[i + 1]) runs = Number.parseInt(args[++i], 10);
  else if (args[i] === "--key" && args[i + 1]) keyPath = args[++i];
  else if (args[i] === "--timeout-sec" && args[i + 1]) timeoutSec = Number.parseInt(args[++i], 10);
  else if (args[i] === "--skip-negative") negative = false;
}

function log(msg: string): void {
  console.log(`[e2e-runs] ${new Date().toISOString().slice(11, 23)} ${msg}`);
}

let failures = 0;
function check(ok: boolean, msg: string): void {
  if (ok) {
    log(`  ok   ${msg}`);
  } else {
    failures++;
    log(`  FAIL ${msg}`);
  }
}

/** Autopilot tape for `seed`, cut at `maxFrames`. Same seed and config, so longer cuts never score less. */
function generateTape(seed: number, seedId: number, maxFrames: number) {
  const game = new AsteroidsGame({ headless: true, seed, seedId });
  game.startNewGame(seed, seedId);
  (game as unknown as { autopilot: Autopilot }).autopilot.setEnabled(true);
  let frame = 0;
  while (frame < maxFrames) {
    game.stepSimulation();
    frame++;
    if (game.getMode() === "game-over") break;
  }
  const tape = game.getTape();
  if (!tape) throw new Error("no tape data");
  return { tape: new Uint8Array(tape), score: game.getScore(), frames: frame };
}

const api = new KalienApi(apiUrl);
const identity = loadOrCreateIdentity(
  keyPath || join(mkdtempSync(join(tmpdir(), "kalien-e2e-")), "key.json"),
).identity;

log(`API:     ${api.baseUrl}`);
log(`Player:  ${identity.address}`);

const config = await api.config();
log(`Network: ${config.networkHash}`);
log(`Score:   ${config.scoreContract}`);

const { seedId, seed } = await api.currentSeed();
log(`Seed:    0x${seed.toString(16).padStart(8, "0")} (seed_id ${seedId})`);

// Increasing frame cuts give non-decreasing scores; keep only strict improvements.
const tapes: ReturnType<typeof generateTape>[] = [];
for (const cut of [1_200, 3_000, 6_000, 12_000, 24_000, 36_000]) {
  if (tapes.length >= runs) break;
  const t = generateTape(seed, seedId, cut);
  if (t.score > 0 && t.score > (tapes.at(-1)?.score ?? 0)) tapes.push(t);
}
log(`Generated ${tapes.length} tapes: ${tapes.map((t) => `${t.score}@${t.frames}f`).join(", ")}`);

const confirmed: RunRecord[] = [];
let best = 0;
/* eslint-disable no-await-in-loop -- runs must be submitted in score order */
for (const t of tapes) {
  const started = Date.now();
  const result = await api.submitRun(identity, seedId, t.tape);
  check(result.success, `POST /api/runs score=${t.score} -> ${result.runId ?? result.error}`);
  if (!result.success || !result.runId) continue;
  const run = await api.waitForRun(result.runId, {
    timeoutMs: timeoutSec * 1000,
    onUpdate: (r) => log(`  run ${r.runId}: ${r.status}`),
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  check(run.status === "confirmed", `run ${run.runId} confirmed in ${secs}s (tx ${run.txHash})`);
  if (run.status !== "confirmed") {
    log(`  error: ${run.error}`);
    continue;
  }
  check(run.score === t.score, `score ${run.score} == tape score ${t.score}`);
  check((run.previousBest ?? 0) === best, `previousBest ${run.previousBest} == ${best}`);
  const expectedMint = BigInt(t.score - best) * KALIEN_UNITS;
  if (run.minted !== null && run.minted !== undefined) {
    check(
      BigInt(run.minted) === expectedMint,
      `minted ${run.minted} == (${t.score} - ${best}) * 1e7`,
    );
  }
  best = t.score;
  confirmed.push(run);
}
/* eslint-enable no-await-in-loop */

const last = confirmed.at(-1);
if (last) {
  const list = await api.listRuns(identity.address);
  check(
    list.some((r) => r.runId === last.runId),
    `GET /api/runs?player lists ${last.runId} (${list.length} runs)`,
  );

  const tapeRes = await fetch(`${api.baseUrl}/api/runs/${last.runId}/tape`);
  const stored = new Uint8Array(await tapeRes.arrayBuffer());
  check(
    tapeRes.ok && bytesToHex(stored) === bytesToHex(tapes[confirmed.length - 1].tape),
    `GET /api/runs/:id/tape returns the submitted tape (${stored.length} bytes)`,
  );

  const lb = await fetch(`${api.baseUrl}/api/leaderboard/player/${identity.address}`);
  check(lb.ok, `GET /api/leaderboard/player/:address -> ${lb.status}`);
  if (lb.ok) log(`  leaderboard: ${JSON.stringify(await lb.json()).slice(0, 300)}`);
}

if (negative && tapes.length > 0) {
  log("Negative checks");
  const t = tapes[0];
  const goodSigner = identity;

  // Signature over another seed_id: the API must refuse it.
  const params = new URLSearchParams({
    pubkey: goodSigner.publicKeyHex,
    seed_id: String(seedId),
    sig: "00".repeat(64),
  });
  const badSig = await fetch(`${api.baseUrl}/api/runs?${params.toString()}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: t.tape,
  });
  check(badSig.status >= 400 && badSig.status < 500, `zero signature refused (${badSig.status})`);

  const wrongSeed = await api.submitRun(identity, (seedId + 1) >>> 0, t.tape);
  const wrongSeedFinal = wrongSeed.runId ? await api.waitForRun(wrongSeed.runId) : null;
  check(
    !wrongSeed.success ||
      wrongSeedFinal?.status === "rejected" ||
      wrongSeedFinal?.status === "failed",
    `wrong seed_id refused (${wrongSeed.error ?? wrongSeedFinal?.status})`,
  );

  if (confirmed.length > 0) {
    const replay = await api.submitRun(identity, seedId, t.tape);
    const replayFinal = replay.runId ? await api.waitForRun(replay.runId) : null;
    check(
      !replay.success || replayFinal?.status === "rejected" || replayFinal?.status === "failed",
      `non-improving replay refused (${replay.error ?? `${replayFinal?.status}: ${replayFinal?.error}`})`,
    );
  }
}

log(failures === 0 ? "PASSED" : `FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
