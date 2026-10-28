/**
 * TS/Rust replay parity check.
 *
 * The Worker pre-checks every run with the TS sim (`worker/replay.ts`) before the relay spends
 * gas; the contract replays the same tape with the Rust core. This script builds a corpus of
 * tapes, replays each one with both, and compares:
 *
 * - container verdict (accepted, or the same rejection class),
 * - replayed frame count and final score,
 * - a per-frame hash of the full sim state (scalars, ship, every entity) with checkpoints,
 * - the accept/reject verdict (TS: parses and replayed score == claim; Rust: strict
 *   `verify_tape`), so a strict-rule rejection the TS pre-check cannot see is counted.
 *
 * Usage (from the repo root):
 *   bun run asteroids-core/parity/parity.ts [--count N] [--seed S] [--autopilot N]
 *     [--dir DIR] [--keep] [--no-worker] [--self-test]
 *
 * `--self-test` flips thrust and fire from frame 150 on, on the TS side only (in tapes of 200+ frames) and
 * expects every such tape to be reported as a mismatch, to prove the comparison can fail.
 *
 * Needs `cargo` and builds
 * `asteroids-core/parity` and `autopilot` in release mode.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, copyFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { join, resolve } from "path";
import { AsteroidsGame } from "../../src/game/AsteroidsGame";
import { TapeInputSource } from "../../src/game/input-source";
import { deserializeTape } from "../../src/game/tape";
import { replayTape } from "../../worker/replay";

const MAX_FRAMES = 36_000;
const CHECKPOINT_STRIDE = 500;
const AUTOPILOT_TIMEOUT_MS = 120_000;
const ROOT = resolve(import.meta.dir, "../..");
const PARITY_DIR = resolve(import.meta.dir);

interface Options {
  count: number;
  seed: number;
  autopilot: number;
  dir: string;
  keep: boolean;
  worker: boolean;
  selfTest: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    count: 300,
    seed: 0x5eed_0001,
    autopilot: 64,
    dir: join(process.env.TMPDIR ?? tmpdir(), "kalien-parity"),
    keep: false,
    worker: true,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--count") options.count = Number(next());
    else if (arg === "--seed") options.seed = Number(next());
    else if (arg === "--autopilot") options.autopilot = Number(next());
    else if (arg === "--dir") options.dir = resolve(next());
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--no-worker") options.worker = false;
    else if (arg === "--self-test") options.selfTest = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function run(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${result.exitCode}):\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** xorshift32, same as the game RNG; drives corpus choices reproducibly. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 0xdeadbeef;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/** Runs the Rust autopilot bots in parallel; a bot that runs past the timeout is skipped. */
async function generateAutopilot(options: Options, outDir: string): Promise<number> {
  if (options.autopilot <= 0) return 0;
  run(["cargo", "build", "--release"], join(ROOT, "autopilot"));
  const bin = join(ROOT, "autopilot/target/release/rust-autopilot");
  const bots = run([bin, "list-bots"], ROOT)
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name);
  const rng = makeRng(options.seed ^ 0xa070_f11e);
  mkdirSync(outDir, { recursive: true });
  const jobs = Array.from({ length: options.autopilot }, (_, i) => ({
    bot: bots[i % bots.length],
    seed: rng(),
  }));
  const workers = Math.max(1, availableParallelism() - 2);
  let next = 0;
  let written = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { bot, seed } = jobs[next++];
      const out = join(outDir, `autopilot-${bot}-${seed.toString(16).padStart(8, "0")}.tape`);
      const proc = Bun.spawn(
        [
          bin,
          "generate",
          "--bot",
          bot,
          "--seed",
          String(seed),
          "--max-frames",
          String(MAX_FRAMES),
          "--output",
          out,
        ],
        { cwd: ROOT, stdout: "ignore", stderr: "ignore", timeout: AUTOPILOT_TIMEOUT_MS },
      );
      // Each pool worker waits for its own process; the pool runs `workers` of them at once.
      // oxlint-disable-next-line no-await-in-loop
      const exitCode = await proc.exited;
      if (exitCode === 0 && existsSync(out)) written += 1;
      else {
        skipped += 1;
        rmSync(out, { force: true });
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  if (skipped > 0)
    console.warn(
      `autopilot: ${skipped} bot runs skipped (timeout ${AUTOPILOT_TIMEOUT_MS / 1000} s or error)`,
    );
  return written;
}

interface RustLine {
  file: string;
  parse: string;
  seed?: number;
  frames?: number;
  claimed?: number;
  score?: number;
  hash?: string;
  ck?: string[];
  verify?: string;
}

interface TsResult {
  parse: string;
  frames?: number;
  score?: number;
  claimed?: number;
  hash?: string;
  ck?: string[];
  workerScore?: number;
}

const PARSE_CLASSES: Array<[string, string]> = [
  ["Tape too short", "TapeTooShort"],
  ["Invalid tape magic", "InvalidMagic"],
  ["Unsupported tape version", "UnsupportedVersion"],
  ["Unknown rules tag", "UnknownRulesTag"],
  ["Header reserved bytes", "HeaderReservedNonZero"],
  ["Frame count out of range", "FrameCountOutOfRange"],
  ["Tape length mismatch", "TapeLengthMismatch"],
  ["CRC mismatch", "CrcMismatch"],
];

function parseClass(message: string): string {
  for (const [prefix, name] of PARSE_CLASSES) {
    if (message.startsWith(prefix)) return name;
  }
  return `Unknown(${message})`;
}

/** FNV-1a (32-bit) over little-endian u32 words; matches the Rust tool. */
class Fnv32 {
  value = 0x811c9dc5;
  word(input: number): void {
    let v = input >>> 0;
    for (let i = 0; i < 4; i += 1) {
      this.value ^= v & 0xff;
      this.value = Math.imul(this.value, 16777619) >>> 0;
      v >>>= 8;
    }
  }
}

const SIZE_CODE = { large: 0, medium: 1, small: 2 } as const;

/** Ship and every live entity, in storage order. Reads the sim's private state (test only). */
function hashEntities(hash: Fnv32, game: AsteroidsGame): void {
  const ship = game["ship"];
  for (const v of [ship.x, ship.y, ship.vx, ship.vy, ship.angle]) hash.word(v);
  hash.word(ship.canControl ? 1 : 0);
  hash.word(ship.fireCooldown);
  hash.word(ship.respawnTimer);
  hash.word(ship.invulnerableTimer);
  const asteroids = game["asteroids"];
  hash.word(asteroids.length);
  for (const a of asteroids) {
    for (const v of [a.x, a.y, a.vx, a.vy, a.angle, SIZE_CODE[a.size], a.spin]) hash.word(v);
  }
  for (const bullets of [game["bullets"], game["saucerBullets"]]) {
    hash.word(bullets.length);
    for (const b of bullets) for (const v of [b.x, b.y, b.vx, b.vy, b.life]) hash.word(v);
  }
  const saucers = game["saucers"];
  hash.word(saucers.length);
  for (const s of saucers) {
    for (const v of [s.x, s.y, s.vx, s.vy, s.small ? 1 : 0, s.fireCooldown, s.driftTimer])
      hash.word(v);
  }
}

function replayTs(bytes: Uint8Array, withWorker: boolean, perturb: boolean): TsResult {
  let tape;
  try {
    tape = deserializeTape(bytes, MAX_FRAMES);
  } catch (err) {
    return { parse: parseClass((err as Error).message) };
  }
  if (perturb && tape.inputs.length >= 200) {
    // Self-test: thrust + fire flipped on every frame from 150 on, TS side only.
    for (let i = 150; i < tape.inputs.length; i += 1) tape.inputs[i] ^= 0x0c;
  }

  // Same steps as worker/replay.ts, plus the state hash.
  const game = new AsteroidsGame({ headless: true, seed: tape.header.seed });
  game.startNewGame(tape.header.seed);
  game.setInputSource(new TapeInputSource(tape.inputs));
  const hash = new Fnv32();
  const ck: string[] = [];
  for (let frame = 1; frame <= tape.header.frameCount; frame += 1) {
    game.stepSimulation();
    hash.word(game.getFrameCount());
    hash.word(game.getScore());
    hash.word(game.getLives());
    hash.word(game.getWave());
    hash.word(game.getRngState());
    hash.word(game.getMode() === "game-over" ? 1 : 0);
    hashEntities(hash, game);
    if (frame % CHECKPOINT_STRIDE === 0) ck.push(hash.value.toString(16).padStart(8, "0"));
  }

  const result: TsResult = {
    parse: "ok",
    frames: game.getFrameCount(),
    score: game.getScore() >>> 0,
    claimed: tape.footer.finalScore >>> 0,
    hash: hash.value.toString(16).padStart(8, "0"),
    ck,
  };
  if (withWorker && !perturb) result.workerScore = replayTape(bytes).replayedScore;
  return result;
}

function classOf(file: string): string {
  return file.replace(/-[^-]*\.tape$/, "").replace(/^autopilot-.*/, "autopilot");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const corpus = options.dir;
  rmSync(corpus, { recursive: true, force: true });
  mkdirSync(corpus, { recursive: true });

  const started = performance.now();
  const autopilotDir = join(corpus, "autopilot-src");
  const autopilotCount = await generateAutopilot(options, autopilotDir);
  if (autopilotCount > 0) {
    for (const name of readdirSync(autopilotDir))
      copyFileSync(join(autopilotDir, name), join(corpus, name));
  }

  run(["cargo", "build", "--release"], PARITY_DIR);
  const parityBin = join(PARITY_DIR, "target/release/asteroids-parity");
  const fixtureDirs = [
    join(ROOT, "test-fixtures"),
    join(ROOT, "autopilot/fixtures/public"),
    join(ROOT, "asteroids-core/tests/fixtures/local"),
    autopilotDir,
  ];
  run(
    [parityBin, "gen", corpus, String(options.count), String(options.seed >>> 0), ...fixtureDirs],
    ROOT,
  );
  // The fixture tapes themselves are part of the corpus too.
  for (const dir of fixtureDirs.slice(0, 3)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".tape"))) {
      copyFileSync(join(dir, name), join(corpus, `fixture-${name.replace(/-/g, "_")}`));
    }
  }

  const rustStarted = performance.now();
  const rustLines = run([parityBin, "eval", corpus], ROOT)
    .split("\n")
    .filter((line) => line)
    .map((line) => JSON.parse(line) as RustLine);
  const rustMs = performance.now() - rustStarted;

  const tsStarted = performance.now();
  const mismatches: string[] = [];
  const counts = new Map<
    string,
    { tapes: number; frames: number; accepted: number; rejected: number }
  >();
  let totalFrames = 0;
  let strictOnly = 0;
  let parseRejects = 0;
  let claimRejects = 0;
  let accepted = 0;

  for (const rust of rustLines) {
    const bytes = new Uint8Array(readFileSync(join(corpus, rust.file)));
    const ts = replayTs(bytes, options.worker, options.selfTest);
    const cls = classOf(rust.file);
    const entry = counts.get(cls) ?? { tapes: 0, frames: 0, accepted: 0, rejected: 0 };
    entry.tapes += 1;

    const fail = (why: string) => mismatches.push(`${rust.file}: ${why}`);
    if (ts.parse !== rust.parse) {
      fail(`parse ts=${ts.parse} rust=${rust.parse}`);
    } else if (rust.parse !== "ok") {
      parseRejects += 1;
      entry.rejected += 1;
    } else {
      entry.frames += rust.frames ?? 0;
      totalFrames += rust.frames ?? 0;
      if (ts.frames !== rust.frames) fail(`frames ts=${ts.frames} rust=${rust.frames}`);
      if (ts.score !== rust.score) fail(`score ts=${ts.score} rust=${rust.score}`);
      if (ts.workerScore !== undefined && ts.workerScore !== ts.score) {
        fail(`worker replayTape score ${ts.workerScore} != loop score ${ts.score}`);
      }
      if (ts.hash !== rust.hash) {
        const at = (ts.ck ?? []).findIndex((h, i) => h !== rust.ck?.[i]);
        fail(
          `state hash differs (first differing checkpoint: frame ${at < 0 ? "after last" : (at + 1) * CHECKPOINT_STRIDE})`,
        );
      }
      const tsAccepts = ts.score === ts.claimed;
      const rustAccepts = rust.verify === "ok";
      if (tsAccepts && !rustAccepts) {
        strictOnly += 1;
        fail(`TS pre-check accepts, contract rejects: ${rust.verify}`);
      } else if (!tsAccepts && rustAccepts) {
        fail("TS pre-check rejects a tape the contract accepts");
      }
      if (rustAccepts) {
        accepted += 1;
        entry.accepted += 1;
      } else {
        if (rust.verify === "ScoreMismatch") claimRejects += 1;
        entry.rejected += 1;
      }
    }
    counts.set(cls, entry);
  }
  const tsMs = performance.now() - tsStarted;

  console.log("| class | tapes | frames | accepted | rejected |");
  console.log("|---|---:|---:|---:|---:|");
  for (const [cls, entry] of [...counts.entries()].toSorted()) {
    console.log(
      `| ${cls} | ${entry.tapes} | ${entry.frames} | ${entry.accepted} | ${entry.rejected} |`,
    );
  }
  console.log();
  console.log(`tapes: ${rustLines.length} (autopilot generated: ${autopilotCount})`);
  console.log(`frames replayed per side: ${totalFrames}`);
  console.log(`accepted by both: ${accepted}`);
  console.log(`rejected by both: container ${parseRejects}, claim mismatch ${claimRejects}`);
  console.log(`strict-only rejections (TS accepts, Rust strict rejects): ${strictOnly}`);
  console.log(`mismatches: ${mismatches.length}`);
  console.log(
    `time: total ${((performance.now() - started) / 1000).toFixed(1)} s, rust eval ${(rustMs / 1000).toFixed(1)} s, ts eval ${(tsMs / 1000).toFixed(1)} s`,
  );
  for (const line of mismatches.slice(0, 50)) console.log(`  MISMATCH ${line}`);

  if (!options.keep) rmSync(corpus, { recursive: true, force: true });
  else console.log(`corpus kept at ${corpus}`);

  if (options.selfTest) {
    const perturbed = rustLines.filter((line) => line.parse === "ok" && (line.frames ?? 0) >= 200);
    const caught = new Set(mismatches.map((line) => line.split(":")[0]));
    const missed = perturbed.filter((line) => !caught.has(line.file));
    console.log(
      `self-test: ${perturbed.length - missed.length}/${perturbed.length} perturbed tapes detected`,
    );
    for (const line of missed) console.log(`  not detected: ${line.file} (${line.frames} frames)`);
    process.exit(missed.length === 0 ? 0 : 1);
  }
  process.exit(mismatches.length === 0 ? 0 : 1);
}

await main();
