/**
 * Concurrency test for the Kalien Worker API v0: N new players (one key each),
 * one unique autopilot tape each on the current seed, all POSTed at the same
 * moment. Reports per-run time to confirmed and gas, total wall time,
 * throughput, and the relay lane spread (from /api/health before and after).
 *
 * Usage:
 *   bun run scripts/concurrency-runs.ts [--api-url <url>] [--players <n>]
 *                                       [--max-frames <n>] [--timeout-sec <n>]
 *
 * Defaults: --api-url $KALIEN_API_URL or http://localhost:8787, --players 8,
 * --max-frames 6000. --tapes-dir <dir> submits pre-made tapes instead
 * (`full-*.tape` plus `seed.json`, as written by scripts/find-full-tapes.ts).
 */

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsteroidsGame } from "../src/game/AsteroidsGame";
import { Autopilot, type AutopilotConfig } from "../src/game/Autopilot";
import { deserializeTape } from "../src/game/tape";
import { KalienApi, type RunRecord } from "../cli/src/api/client";
import { loadOrCreateIdentity } from "../cli/src/identity/keyfile";
import { fetchGasUsed, fetchLaneCounts, laneSpread } from "./lib/probe";

let apiUrl = process.env.KALIEN_API_URL ?? "http://localhost:8787";
let players = 8;
let maxFrames = 6_000;
let timeoutSec = 600;
let tapesDir = "";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--api-url" && args[i + 1]) apiUrl = args[++i];
  else if (args[i] === "--players" && args[i + 1]) players = Number.parseInt(args[++i], 10);
  else if (args[i] === "--max-frames" && args[i + 1]) maxFrames = Number.parseInt(args[++i], 10);
  else if (args[i] === "--timeout-sec" && args[i + 1]) timeoutSec = Number.parseInt(args[++i], 10);
  else if (args[i] === "--tapes-dir" && args[i + 1]) tapesDir = args[++i];
}

function log(msg: string): void {
  console.log(`[concurrency] ${new Date().toISOString().slice(11, 23)} ${msg}`);
}

function jitteredConfig(): AutopilotConfig {
  const base = Autopilot.defaults() as unknown as Record<string, number | boolean>;
  const out: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = typeof value === "number" ? value * (0.9 + Math.random() * 0.2) : value;
  }
  return out as unknown as AutopilotConfig;
}

function generateTape(seed: number, seedId: number) {
  const game = new AsteroidsGame({
    headless: true,
    seed,
    seedId,
    autopilotConfig: jitteredConfig(),
  });
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
const config = await api.config();
let seedId: number;
let seed: number;
if (tapesDir) {
  ({ seedId, seed } = JSON.parse(readFileSync(join(tapesDir, "seed.json"), "utf-8")) as {
    seedId: number;
    seed: number;
  });
} else {
  const seedRes = (await (await fetch(`${api.baseUrl}/api/seed/current`)).json()) as {
    secondsLeft?: number;
  };
  if ((seedRes.secondsLeft ?? 600) < 120) {
    log(`Waiting ${seedRes.secondsLeft}s for the next seed epoch...`);
    await new Promise((r) => setTimeout(r, ((seedRes.secondsLeft ?? 0) + 15) * 1000));
  }
  let current = await api.currentSeed().catch(() => null);
  for (let i = 0; !current && i < 20; i++) {
    // eslint-disable-next-line no-await-in-loop -- the seed appears a few seconds after the epoch starts
    await new Promise((r) => setTimeout(r, 3000));
    // eslint-disable-next-line no-await-in-loop -- see above
    current = await api.currentSeed().catch(() => null);
  }
  if (!current) throw new Error("no current seed");
  ({ seedId, seed } = current);
}

const keyDir = mkdtempSync(join(tmpdir(), "kalien-conc-"));
const preMade = tapesDir
  ? readdirSync(tapesDir)
      .filter((f) => /^full-.*\.tape$/.test(f))
      .slice(0, players)
      .map((f) => {
        const tape = new Uint8Array(readFileSync(join(tapesDir, f)));
        const t = deserializeTape(tape, 36_000);
        return { tape, score: t.footer.finalScore, frames: t.header.frameCount };
      })
  : null;
if (preMade && preMade.length < players) {
  throw new Error(`only ${preMade.length} tapes in ${tapesDir}, need ${players}`);
}
const jobs = Array.from({ length: players }, (_, i) => {
  const identity = loadOrCreateIdentity(join(keyDir, `p${i}.json`)).identity;
  if (preMade) return { i, identity, ...preMade[i] };
  let t = generateTape(seed, seedId);
  while (t.score === 0) t = generateTape(seed, seedId);
  return { i, identity, ...t };
});
log(`API ${api.baseUrl}, seed 0x${seed.toString(16)} (seed_id ${seedId}), ${players} players`);
log(`Tapes: ${jobs.map((j) => `${j.score}@${j.frames}f`).join(", ")}`);

const lanesBefore = await fetchLaneCounts(api.baseUrl);
const t0 = Date.now();
const results = await Promise.all(
  jobs.map(async (job) => {
    const posted = await api.submitRun(job.identity, seedId, job.tape);
    const postMs = Date.now() - t0;
    if (!posted.success || !posted.runId) {
      return {
        job,
        postMs,
        run: null as RunRecord | null,
        doneMs: Date.now() - t0,
        error: posted.error,
      };
    }
    const run = await api.waitForRun(posted.runId, {
      timeoutMs: timeoutSec * 1000,
      intervalMs: 1000,
    });
    return { job, postMs, run, doneMs: Date.now() - t0, error: run.error ?? undefined };
  }),
);
const wallMs = Date.now() - t0;
const lanesAfter = await fetchLaneCounts(api.baseUrl);

let confirmed = 0;
for (const r of results) {
  const gas = r.run?.txHash ? await fetchGasUsed(config.rpcUrl, r.run.txHash) : null; // eslint-disable-line no-await-in-loop -- few rows
  if (r.run?.status === "confirmed") confirmed++;
  log(
    `p${r.job.i} score=${r.job.score} frames=${r.job.frames} status=${r.run?.status ?? "post-failed"} ` +
      `post=${(r.postMs / 1000).toFixed(1)}s done=${(r.doneMs / 1000).toFixed(1)}s gas=${gas ?? "?"} ` +
      `run=${r.run?.runId ?? "-"} tx=${r.run?.txHash ?? "-"}${r.error ? ` error=${r.error}` : ""}`,
  );
}
log(
  `Confirmed ${confirmed}/${players} in ${(wallMs / 1000).toFixed(1)}s wall ` +
    `(${((confirmed / wallMs) * 60_000).toFixed(1)} runs/min)`,
);
log(`Lane spread: ${laneSpread(lanesBefore, lanesAfter)}`);
process.exit(confirmed === players ? 0 : 1);
