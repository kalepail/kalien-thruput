// Concurrent submissions against a running Worker.
//
//   bun tests/worker/live/load-runs.ts --api http://127.0.0.1:5174 --runs 12 [--frames 36000]
//
// Plays one autopilot game on the live seed, cuts it into --runs tapes of
// different lengths (each scored by the TS replay), signs each with its own
// throwaway player key, submits all at once, and waits for every run.
import { AsteroidsGame } from "../../../src/game/AsteroidsGame";
import type { Autopilot } from "../../../src/game/Autopilot";
import { deserializeTape, serializeTape } from "../../../src/game/tape";
import { claimMessage, pubkeyAccountAddress } from "../../../shared/thruput/claim";
import { bytesToHex, hexToBytes } from "../../../worker/hex";
import { replayTape } from "../../../worker/replay";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
};
const api = option("--api", "http://127.0.0.1:5174").replace(/\/+$/u, "");
const count = Number(option("--runs", "12"));
const maxFrames = Number(option("--frames", "36000"));

// DEV_API_KEY (optional) skips the per-IP submit limit.
const adminHeaders: Record<string, string> = process.env.DEV_API_KEY
  ? { authorization: `Bearer ${process.env.DEV_API_KEY}` }
  : {};

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { ...adminHeaders, ...init?.headers },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const config = (await json("/api/config")).body as { networkHash: string; scoreContract: string };
let seedInfo = (await json("/api/seed/current")).body as { seedId: number; seed: number | null };
for (let i = 0; i < 20 && seedInfo.seed === null; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  seedInfo = (await json("/api/seed/current")).body as typeof seedInfo;
}
if (seedInfo.seed === null) throw new Error("no seed for the current epoch");
const { seedId, seed } = seedInfo as { seedId: number; seed: number };

const game = new AsteroidsGame({ headless: true, seed });
game.startNewGame(seed);
(game as unknown as { autopilot: Autopilot }).autopilot.setEnabled(true);
for (let frame = 0; frame < maxFrames && game.getMode() !== "game-over"; frame += 1) {
  game.stepSimulation();
}
const full = deserializeTape(game.getTape() ?? new Uint8Array());
const total = full.header.frameCount;

const PKCS8_PREFIX = hexToBytes("302e020100300506032b657004220420");
const jobs = [];
for (let i = 0; i < count; i += 1) {
  const frames = Math.max(600, Math.round((total * (i + 1)) / count));
  const inputs = full.inputs.slice(0, frames);
  const score = replayTape(serializeTape(seed, inputs, 1)).replayedScore;
  if (score === 0) continue;
  const tape = serializeTape(seed, inputs, score);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array([...PKCS8_PREFIX, ...secret]),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  const pubkey = Uint8Array.from(atob((jwk.x ?? "").replace(/-/gu, "+").replace(/_/gu, "/")), (c) =>
    c.charCodeAt(0),
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      key,
      claimMessage({ ...config, seedId, tape }) as Uint8Array<ArrayBuffer>,
    ),
  );
  jobs.push({ frames, score, tape, pubkey, sig, player: pubkeyAccountAddress(pubkey) });
}
console.log(
  `api ${api} seed_id ${seedId}: ${jobs.length} runs, ${jobs.map((j) => j.frames).join("/")} frames`,
);

const started = Date.now();
const submitted = await Promise.all(
  jobs.map(async (job) => {
    const response = await json(
      `/api/runs?pubkey=${bytesToHex(job.pubkey)}&seed_id=${seedId}&sig=${bytesToHex(job.sig)}`,
      { method: "POST", body: job.tape },
    );
    return { ...job, runId: response.body.runId as string | undefined, post: response };
  }),
);
const postMs = Date.now() - started;

const results = await Promise.all(
  submitted.map(async (job) => {
    if (job.post.status >= 400 || !job.runId)
      return { ...job, status: `POST ${job.post.status} ${job.post.body.error}`, ms: 0, tx: null };
    for (;;) {
      const run = (await json(`/api/runs/${job.runId}`)).body;
      if (
        ["confirmed", "rejected", "failed"].includes(String(run.status)) ||
        Date.now() - started > 300_000
      ) {
        return {
          ...job,
          status: String(run.status),
          ms: Date.now() - started,
          tx: run.txHash,
          error: run.error,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }),
);
const done = Date.now() - started;
for (const r of results) {
  console.log(
    `${String(r.frames).padStart(5)} f  score ${String(r.score).padStart(6)}  ${r.status.padEnd(9)} ${(r.ms / 1000).toFixed(1)}s ${"error" in r && r.error ? r.error : ""}`,
  );
}
const confirmed = results.filter((r) => r.status === "confirmed").length;
console.log(
  `\n${confirmed}/${results.length} confirmed. POSTs took ${(postMs / 1000).toFixed(1)}s; all final after ${(done / 1000).toFixed(1)}s; ` +
    `${(confirmed / (done / 1000)).toFixed(2)} confirmed runs/s.`,
);
const health = (await json("/api/health")).body as {
  lanes: Array<{ lane: number; counts?: Record<string, number> }>;
};
console.log(
  `lanes: ${health.lanes.map((l) => `${l.lane}:${l.counts?.confirmed ?? "?"} confirmed`).join(", ")}`,
);
process.exit(confirmed === results.length ? 0 : 1);
