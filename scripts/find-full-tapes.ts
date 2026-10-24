/**
 * Find autopilot tapes that survive the full 36,000-frame cap on the current
 * seed (the worst case for replay gas). Hill-climbs the TS autopilot config
 * with the CLI farm's mutation code and keeps every distinct full-length tape.
 *
 * Usage:
 *   bun run scripts/find-full-tapes.ts --out-dir <dir> [--count <n>] [--api-url <url>]
 *                                      [--seed-id <n> --seed <hex>] [--time-limit-sec <n>]
 *
 * Writes `<dir>/full-<score>-<hash8>.tape` and `<dir>/seed.json` ({ seedId, seed }).
 * Several copies can run at once into the same dir.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AsteroidsGame } from "../src/game/AsteroidsGame";
import { Autopilot, type AutopilotConfig } from "../src/game/Autopilot";
import { mutateConfig, randomConfig } from "../cli/src/worker/mutate";
import { KalienApi } from "../cli/src/api/client";

const FULL_FRAMES = 36_000;

let apiUrl = process.env.KALIEN_API_URL ?? "http://localhost:8787";
let outDir = "";
let count = 8;
let timeLimitSec = 600;
let seedId: number | null = null;
let seed: number | null = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--api-url" && args[i + 1]) apiUrl = args[++i];
  else if (args[i] === "--out-dir" && args[i + 1]) outDir = args[++i];
  else if (args[i] === "--count" && args[i + 1]) count = Number.parseInt(args[++i], 10);
  else if (args[i] === "--time-limit-sec" && args[i + 1])
    timeLimitSec = Number.parseInt(args[++i], 10);
  else if (args[i] === "--seed-id" && args[i + 1]) seedId = Number.parseInt(args[++i], 10);
  else if (args[i] === "--seed" && args[i + 1]) seed = Number.parseInt(args[++i], 16) >>> 0;
}
if (!outDir) throw new Error("--out-dir is required");
mkdirSync(outDir, { recursive: true });

if (seedId === null || seed === null) {
  const seedFile = join(outDir, "seed.json");
  if (existsSync(seedFile)) {
    ({ seedId, seed } = JSON.parse(readFileSync(seedFile, "utf-8")) as {
      seedId: number;
      seed: number;
    });
  } else {
    ({ seedId, seed } = await new KalienApi(apiUrl).currentSeed());
    writeFileSync(seedFile, JSON.stringify({ seedId, seed }));
  }
}
const activeSeed = seed >>> 0;
const activeSeedId = seedId >>> 0;

function play(config: AutopilotConfig) {
  const game = new AsteroidsGame({
    headless: true,
    seed: activeSeed,
    seedId: activeSeedId,
    autopilotConfig: config,
  });
  game.startNewGame(activeSeed, activeSeedId);
  (game as unknown as { autopilot: Autopilot }).autopilot.setEnabled(true);
  let frame = 0;
  while (frame < FULL_FRAMES) {
    game.stepSimulation();
    frame++;
    if (game.getMode() === "game-over") break;
  }
  return { game, frames: frame, score: game.getScore(), over: game.getMode() === "game-over" };
}

const found = () => readdirSync(outDir).filter((f) => /^full-.*\.tape$/.test(f)).length;

const started = Date.now();
let best = { score: 0, config: Autopilot.defaults() };
let games = 0;
let stale = 0;
console.log(`seed 0x${activeSeed.toString(16)} (seed_id ${activeSeedId}), want ${count} tapes`);
while (found() < count && Date.now() - started < timeLimitSec * 1000) {
  const config =
    stale > 150 ? randomConfig() : mutateConfig(best.config, stale > 50 ? 1.5 : 0.5, "exploit");
  const r = play(config);
  games++;
  if (r.frames === FULL_FRAMES && !r.over) {
    const tape = r.game.getTape();
    if (tape) {
      const hash = createHash("sha256").update(tape).digest("hex");
      const path = join(outDir, `full-${r.score}-${hash.slice(0, 8)}.tape`);
      if (!existsSync(path)) {
        writeFileSync(path, tape);
        console.log(`game ${games}: full tape score ${r.score} -> ${path}`);
      }
    }
  }
  if (r.score > best.score) {
    best = { score: r.score, config };
    stale = 0;
  } else if (++stale > 300) {
    best = { score: 0, config: randomConfig() };
    stale = 0;
  }
}
console.log(
  `done: ${found()} full tapes, ${games} games, ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
