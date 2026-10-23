/**
 * Headless tape generator using autopilot.
 *
 * Usage: bun run scripts/generate-tape.ts [--seed <hex>] [--max-frames <n>] [--output <path>]
 *                                         [--api-url <url>]
 *
 * Runs an autopilot game in headless mode, records inputs to a tape,
 * writes the tape to a file, then verifies it inline. Without --seed, the
 * current seed comes from the Kalien API (GET /api/seed/current).
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { AsteroidsGame } from "../src/game/AsteroidsGame";
import { TapeInputSource } from "../src/game/input-source";
import { Autopilot } from "../src/game/Autopilot";
import { deserializeTape } from "../src/game/tape";

const DEFAULT_MAX_FRAMES = 36_000;
const DEFAULT_API_URL =
  process.env.KALIEN_API_URL ?? "https://kalien-thruput.sdf-ecosystem.workers.dev";

// Parse arguments
let explicitSeed: number | null = null;
let maxFrames = DEFAULT_MAX_FRAMES; // ~10 minutes
let outputPath = "";
let apiUrl = DEFAULT_API_URL;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed" && args[i + 1]) {
    explicitSeed = parseInt(args[++i], 16);
  } else if (args[i] === "--max-frames" && args[i + 1]) {
    maxFrames = parseInt(args[++i], 10);
  } else if (args[i] === "--output" && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === "--api-url" && args[i + 1]) {
    apiUrl = args[++i];
  }
}

async function fetchCurrentSeed(): Promise<{ seedId: number; seed: number } | null> {
  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/seed/current`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { seedId?: unknown; seed?: unknown };
    if (typeof body.seedId !== "number" || typeof body.seed !== "number") return null;
    return { seedId: body.seedId >>> 0, seed: body.seed >>> 0 };
  } catch {
    return null;
  }
}

// Resolve seed: use explicit --seed flag, or fetch the current seed from the API
let seed: number;
if (explicitSeed !== null) {
  seed = explicitSeed;
} else {
  process.stdout.write(`Fetching current seed from ${apiUrl}...`);
  let fetched: { seedId: number; seed: number } | null = null;
  /* eslint-disable no-await-in-loop -- seed retries must remain sequential */
  for (let attempt = 0; attempt < 6; attempt++) {
    fetched = await fetchCurrentSeed();
    if (fetched !== null) break;
    if (attempt < 5) {
      process.stdout.write(" retrying...");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  /* eslint-enable no-await-in-loop */
  if (fetched === null) {
    console.error(
      "\nNo seed available for the current window. The API cron may not have fired yet.",
    );
    process.exit(1);
  }
  seed = fetched.seed;
  console.log(` 0x${seed.toString(16).toUpperCase().padStart(8, "0")} (seed_id ${fetched.seedId})`);
}

if (!outputPath) {
  const seedHex = seed.toString(16).padStart(8, "0");
  const rootDir = join(dirname(new URL(import.meta.url).pathname), "..");
  const outDir = join(rootDir, "generated-tapes");
  mkdirSync(outDir, { recursive: true });
  outputPath = join(outDir, `asteroids-${seedHex}.tape`);
}

console.log(`Generating tape:`);
console.log(`  Seed:       0x${seed.toString(16).toUpperCase().padStart(8, "0")}`);
console.log(`  Max frames: ${maxFrames}`);
console.log(`  Output:     ${outputPath}`);
console.log();

// Create headless game and start with the given seed
const game = new AsteroidsGame({ headless: true, seed });
game.startNewGame(seed);

// Enable the internal autopilot (pragmatic private access for script use)
(game as unknown as { autopilot: Autopilot }).autopilot.setEnabled(true);

const start = performance.now();
let frame = 0;

while (frame < maxFrames) {
  game.stepSimulation();
  frame++;

  if (game.getMode() === "game-over") {
    break;
  }

  if (frame % 3000 === 0) {
    const elapsed = performance.now() - start;
    console.log(
      `  Frame ${frame}/${maxFrames} (score: ${game.getScore()}, wave: ${game.getWave()}, ${(frame / (elapsed / 1000)).toFixed(0)} fps)`,
    );
  }
}

const elapsed = performance.now() - start;

console.log();
console.log(`Generation complete:`);
console.log(`  Frames: ${frame}`);
console.log(`  Score:  ${game.getScore()}`);
console.log(`  Wave:   ${game.getWave()}`);
console.log(`  Lives:  ${game.getLives()}`);
console.log(`  Time:   ${elapsed.toFixed(1)}ms (${(frame / (elapsed / 1000)).toFixed(0)} fps)`);

const tapeData = game.getTape();
if (!tapeData) {
  console.error("Failed to get tape data");
  process.exit(1);
}

writeFileSync(outputPath, tapeData);
console.log(`  Written: ${outputPath} (${tapeData.length} bytes)`);

// Inline verification
console.log();
console.log("Verifying tape...");

const verifyData = new Uint8Array(readFileSync(outputPath));
const tape = deserializeTape(verifyData, maxFrames);

const verifyGame = new AsteroidsGame({
  headless: true,
  seed: tape.header.seed,
});
verifyGame.startNewGame(tape.header.seed);
const verifySource = new TapeInputSource(tape.inputs);
verifyGame.setInputSource(verifySource);

for (let i = 0; i < tape.header.frameCount; i++) {
  verifyGame.stepSimulation();
}

const vScore = verifyGame.getScore();
const scoreOk = vScore === tape.footer.finalScore;

if (scoreOk) {
  console.log("VERIFICATION PASSED");
} else {
  console.error(`  Score mismatch: got ${vScore}, expected ${tape.footer.finalScore}`);
  console.error("VERIFICATION FAILED");
  process.exit(1);
}
