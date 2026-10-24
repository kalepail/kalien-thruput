/**
 * End-to-end run test against the Kalien Worker API v0:
 * generate tapes on the current seed -> sign and POST /api/runs -> poll
 * /api/runs/:id -> check score, previous best, minted KALIEN, the run list,
 * the leaderboard entry, and the stored tape. Also checks dedupe (runId =
 * sha256(tape); same player gets the same run, another player gets 409
 * already_claimed) and that the API refuses a bad signature, a wrong seed_id,
 * and a tape that does not beat the player's best.
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
import { Autopilot, type AutopilotConfig } from "../src/game/Autopilot";
import { KalienApi, type RunRecord } from "../cli/src/api/client";
import { bytesToHex, sha256 } from "../cli/src/identity/claim";
import { loadOrCreateIdentity } from "../cli/src/identity/keyfile";
import { fetchGasUsed, fetchLaneCounts, laneSpread } from "./lib/probe";

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

// One random autopilot config per e2e run. The API refuses a tape that another
// player already claimed, so every run must make tapes nobody has sent before.
const autopilotConfig: AutopilotConfig = (() => {
  const base = Autopilot.defaults() as unknown as Record<string, number | boolean>;
  const out: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = typeof value === "number" ? value * (0.9 + Math.random() * 0.2) : value;
  }
  return out as unknown as AutopilotConfig;
})();

/** Autopilot tape for `seed`, cut at `maxFrames`. Same seed and config, so longer cuts never score less. */
function generateTape(seed: number, seedId: number, maxFrames: number) {
  const game = new AsteroidsGame({ headless: true, seed, seedId, autopilotConfig });
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

// Do not start a run sequence close to an epoch change.
{
  const res = await fetch(`${api.baseUrl}/api/seed/current`);
  const info = (await res.json()) as { secondsLeft?: number };
  if ((info.secondsLeft ?? 600) < 90) {
    log(`Waiting ${info.secondsLeft}s for the next seed epoch...`);
    await new Promise((r) => setTimeout(r, ((info.secondsLeft ?? 0) + 15) * 1000));
  }
}
let seedInfo = await api.currentSeed().catch(() => null);
for (let i = 0; !seedInfo && i < 20; i++) {
  // eslint-disable-next-line no-await-in-loop -- the seed appears a few seconds after the epoch starts
  await new Promise((r) => setTimeout(r, 3000));
  // eslint-disable-next-line no-await-in-loop -- see above
  seedInfo = await api.currentSeed().catch(() => null);
}
if (!seedInfo) throw new Error("no current seed");
const { seedId, seed } = seedInfo;
const lanesBefore = await fetchLaneCounts(api.baseUrl).catch(() => []);
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
  check(result.runId === bytesToHex(sha256(t.tape)), "runId == sha256(tape)");
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
  const gas = run.txHash ? await fetchGasUsed(config.rpcUrl, run.txHash) : null;
  log(
    `  RUN ${run.runId} score=${t.score} frames=${t.frames} gas=${gas ?? "?"} secs=${secs} tx=${run.txHash}`,
  );
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

if (negative && last) {
  log("Dedupe and negative checks");
  const lastTape = tapes[confirmed.length - 1];

  // Same player re-sends a confirmed tape: 200 with the same run.
  const again = await api.submitRun(identity, seedId, lastTape.tape);
  check(
    again.success && again.existing === true && again.runId === last.runId,
    `same player re-send -> HTTP ${again.httpStatus}, same run ${again.runId === last.runId}`,
  );

  // Another player sends the same tape with a valid signature: 409 already_claimed.
  const other = loadOrCreateIdentity(
    join(mkdtempSync(join(tmpdir(), "kalien-e2e-")), "key.json"),
  ).identity;
  const stolen = await api.submitRun(other, seedId, lastTape.tape);
  check(
    !stolen.success && stolen.httpStatus === 409 && stolen.code === "already_claimed",
    `other player same tape -> ${stolen.httpStatus} ${stolen.code}`,
  );

  // A fresh tape that scores below the best: not_improved with bestScore.
  let low: ReturnType<typeof generateTape> | null = null;
  for (const cut of [2_000, 1_500, 900, 4_500, 9_000]) {
    const t = generateTape(seed, seedId, cut);
    const used = tapes.some((u) => bytesToHex(u.tape) === bytesToHex(t.tape));
    if (t.score > 0 && t.score < best && !used) {
      low = t;
      break;
    }
  }
  if (low) {
    const lower = await api.submitRun(identity, seedId, low.tape);
    check(
      !lower.success && lower.code === "not_improved" && lower.bestScore === best,
      `score ${low.score} < best ${best} -> ${lower.httpStatus} ${lower.code} (bestScore ${lower.bestScore})`,
    );
  } else {
    log("  skip not_improved: no lower-scoring fresh tape");
  }

  // The checks below use a tape that nobody has sent yet. A tape this player
  // already sent hits the dedupe first and returns the existing run (200).
  const fresh = generateTape(seed, seedId, 8_000);

  // Zero signature: bad_signature.
  const params = new URLSearchParams({
    pubkey: identity.publicKeyHex,
    seed_id: String(seedId),
    sig: "00".repeat(64),
  });
  const badSig = await fetch(`${api.baseUrl}/api/runs?${params.toString()}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: fresh.tape,
  });
  const badSigBody = (await badSig.json().catch(() => ({}))) as { code?: string };
  check(
    badSig.status >= 400 && badSig.status < 500 && badSigBody.code === "bad_signature",
    `zero signature -> ${badSig.status} ${badSigBody.code}`,
  );

  // Valid signature, but the signed seed_id is not the tape's epoch.
  for (const wrong of [(seedId + 1) >>> 0, (seedId - 1) >>> 0, (seedId - 1_000) >>> 0]) {
    // eslint-disable-next-line no-await-in-loop -- one request at a time keeps the log readable
    const r = await api.submitRun(identity, wrong, fresh.tape);
    check(
      !r.success && (r.httpStatus ?? 0) >= 400 && (r.httpStatus ?? 0) < 500,
      `seed_id ${wrong} for a seed_id ${seedId} tape -> ${r.httpStatus} ${r.code}`,
    );
  }

  // Malformed tapes: refused before any chain work.
  const malformed: [string, Uint8Array][] = [];
  const badMagic = new Uint8Array(fresh.tape);
  badMagic[0] ^= 0xff;
  malformed.push(["bad magic", badMagic]);
  malformed.push(["truncated", fresh.tape.slice(0, fresh.tape.length - 20)]);
  const badBody = new Uint8Array(fresh.tape);
  badBody[20] ^= 0x01; // body byte; the CRC no longer matches
  malformed.push(["CRC mismatch", badBody]);
  malformed.push(["empty", new Uint8Array(0)]);
  malformed.push(["oversized (18,025 bytes)", new Uint8Array(18_025)]);
  for (const [name, bytes] of malformed) {
    // eslint-disable-next-line no-await-in-loop -- one request at a time keeps the log readable
    const r = await api.submitRun(identity, seedId, bytes);
    check(
      !r.success && (r.httpStatus ?? 0) >= 400 && (r.httpStatus ?? 0) < 500,
      `${name} tape -> ${r.httpStatus} ${r.code}`,
    );
  }

  // Forged footer score: replay_mismatch.
  const forged = new Uint8Array(fresh.tape);
  const view = new DataView(forged.buffer);
  view.setUint32(forged.length - 8, best + 1_000_000, true); // footer score; CRC covers header+body only
  const forgedRes = await api.submitRun(identity, seedId, forged);
  check(
    !forgedRes.success && (forgedRes.httpStatus ?? 0) >= 400,
    `forged footer score -> ${forgedRes.httpStatus} ${forgedRes.code}`,
  );
}

const lanesAfter = await fetchLaneCounts(api.baseUrl).catch(() => []);
if (lanesBefore.length > 0) log(`Lane spread: ${laneSpread(lanesBefore, lanesAfter)}`);

log(failures === 0 ? "PASSED" : `FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
