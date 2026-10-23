import { cpus } from "os";
import { Autopilot, type AutopilotConfig } from "@/game/Autopilot";
import { renderDashboard, type DashboardStats } from "../display/dashboard";
import * as ansi from "../display/ansi";
import { KalienApi, type SubmitResult } from "../api/client";
import { fetchPlayerScore } from "../api/score";
import type { Identity } from "../identity/keyfile";
import type { MainToWorkerMessage, WorkerToMainMessage } from "../worker/messages";
import {
  SEED_INTERVAL_SECONDS,
  MAX_SUBMISSIONS_PER_EPOCH,
  SETTLE_DELAY_MS,
  currentSeedId,
} from "../constants";
import { runCliPreflight } from "../preflight";

const SEED_FETCH_TIMEOUT_MS = 6000;
const SEED_REFRESH_INTERVAL_MS = 4000;

function getCurrentEpoch(): number {
  return currentSeedId();
}

function epochEndMs(epoch: number): number {
  return (epoch + 1) * SEED_INTERVAL_SECONDS * 1000;
}

export interface RunOptions {
  identity: Identity;
  threads: number;
  apiUrl: string;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const availableCores = cpus().length;
  const threadCount = opts.threads > 0 ? opts.threads : Math.max(1, Math.floor(availableCores / 2));

  const pct = Math.round((threadCount / availableCores) * 100);
  process.stdout.write(
    ansi.color(ansi.cyan, "  Cores: ") +
      ansi.color(ansi.white, `${threadCount}/${availableCores}`) +
      ansi.color(ansi.dim, ` (${pct}%)\n`),
  );

  const api = new KalienApi(opts.apiUrl);
  const address = opts.identity.address;
  process.stdout.write(
    ansi.color(ansi.cyan, "  Address: ") + ansi.color(ansi.white, `${address}\n`),
  );
  process.stdout.write(ansi.color(ansi.cyan, "  Running preflight checks..."));
  const preflight = await runCliPreflight(api);
  process.stdout.write(ansi.color(ansi.green, " ok\n"));
  for (const warning of preflight.warnings) {
    process.stdout.write(ansi.color(ansi.yellow, `  Warning: ${warning}\n`));
  }

  // Fetch on-chain high score before starting workers
  process.stdout.write(ansi.color(ansi.cyan, "  Fetching on-chain score..."));
  const playerInfo = await fetchPlayerScore(address, opts.apiUrl);
  let onChainBestScore = playerInfo.bestScore;
  if (onChainBestScore > 0) {
    process.stdout.write(ansi.color(ansi.green, ` ${onChainBestScore}\n`));
  } else {
    process.stdout.write(ansi.color(ansi.dim, " none\n"));
  }

  // Fetch on-chain best for the *current seed_id* so we don't submit worse
  // scores from a previous session or a different client (e.g. the web UI).
  const initialSeedId = getCurrentEpoch();
  process.stdout.write(ansi.color(ansi.cyan, "  Fetching seed best score..."));
  const initialSeedBest = await api.bestScoreForSeed(address, initialSeedId);
  if (initialSeedBest > 0) {
    process.stdout.write(ansi.color(ansi.green, ` ${initialSeedBest}\n`));
  } else {
    process.stdout.write(ansi.color(ansi.dim, " none\n"));
  }

  // Epoch tracking
  let currentEpoch = initialSeedId;
  let epochGamesPlayed = 0;
  let currentSeed: number | null = null;
  let seedRefreshInFlight = false;
  let lastSeedRefreshAt = 0;
  let announceSeedResolution = false;

  // Read the current seed from the Worker API. Returns null if the API does
  // not serve the seed for the expected seed_id yet.
  async function fetchCurrentSeed(expectedSeedId: number): Promise<number | null> {
    try {
      const current = await api.currentSeed(SEED_FETCH_TIMEOUT_MS);
      return current.seedId === expectedSeedId ? current.seed : null;
    } catch {
      return null;
    }
  }

  async function refreshCurrentSeed(force = false): Promise<void> {
    if (seedRefreshInFlight) return;

    const now = Date.now();
    if (!force && now - lastSeedRefreshAt < SEED_REFRESH_INTERVAL_MS) {
      return;
    }

    const requestedEpoch = getCurrentEpoch();
    seedRefreshInFlight = true;
    lastSeedRefreshAt = now;
    try {
      const seed = await fetchCurrentSeed(requestedEpoch);

      // Ignore stale responses that started in a previous epoch.
      if (requestedEpoch !== getCurrentEpoch()) {
        return;
      }

      if (seed !== null) {
        currentSeed = seed;
        for (let i = 0; i < workers.length; i++) {
          safePostToWorker(i, { type: "seed", seedId: requestedEpoch, seed });
        }
        if (announceSeedResolution) {
          lastSubmitStatus = ansi.color(
            ansi.cyan,
            `new seed_id materialized (0x${seed.toString(16).padStart(8, "0").toUpperCase()})`,
          );
          announceSeedResolution = false;
        }
      }
    } finally {
      seedRefreshInFlight = false;
    }
  }

  void refreshCurrentSeed(true);

  // Score tracking (per epoch)
  let bestScore = 0;
  let bestTape: Uint8Array | null = null;
  let bestConfig: AutopilotConfig = Autopilot.defaults();
  let lastSubmittedScore = initialSeedBest; // start from on-chain best so we don't submit worse

  // Settle tracking: when a new best is found, record the timestamp.
  // Don't submit until SETTLE_DELAY_MS has elapsed (score may still be climbing).
  let bestScoreFoundAt = 0;

  // Submission budget tracking (per epoch)
  let epochSubmissions = 0;

  // Session stats
  let totalGamesPlayed = 0;
  let totalSubmissions = 0;
  let lastSubmitStatus = "";
  const startTime = Date.now();
  let submitting = false;

  // Per-worker best scores for dashboard display
  const workerBests: number[] = Array.from({ length: threadCount }, () => 0);

  // Spawn workers: worker 0 is the exploiter, the rest are explorers.
  // Exploiter: small mutations, always tracks the global best.
  // Explorers: large mutations, independent search, restart from random when stuck.
  // In compiled binaries ($bunfs), import.meta.url-based URLs don't resolve;
  // use a plain string literal instead (worker must be a --compile entrypoint).
  // For `bun run` (dev), use import.meta.url so the path resolves from the source file.
  const isCompiled = import.meta.url.includes("$bunfs");
  const workers: Worker[] = [];
  const workerAlive: boolean[] = Array.from({ length: threadCount }, () => false);

  function safePostToWorker(index: number, msg: MainToWorkerMessage): void {
    const worker = workers[index];
    if (!worker || !workerAlive[index]) {
      return;
    }
    try {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage does not accept targetOrigin
      worker.postMessage(msg);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/Worker has been terminated|InvalidStateError/i.test(detail)) {
        workerAlive[index] = false;
        return;
      }
      throw error;
    }
  }

  for (let i = 0; i < threadCount; i++) {
    const role = i === 0 ? "exploit" : "explore";
    const worker = isCompiled
      ? new Worker("./worker/game-worker.ts")
      : new Worker(new URL("../worker/game-worker.ts", import.meta.url));
    workerAlive[i] = true;
    worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "game-complete":
          totalGamesPlayed++;
          epochGamesPlayed++;
          break;
        case "new-best":
          // Discard tapes from a stale epoch (worker hadn't received reset-best yet)
          if (msg.seedId !== currentEpoch) break;
          if (msg.score > bestScore) {
            bestScore = msg.score;
            bestTape = msg.tape;
            bestConfig = msg.config;
            bestScoreFoundAt = Date.now();

            // Immediately share the new global best with the exploiter (worker 0)
            // so it can start refining this region right away.
            if (msg.workerId !== 0) {
              safePostToWorker(0, {
                type: "set-config",
                config: msg.config,
                globalScore: msg.score,
              });
            }

            // Also offer to all other explorers — they'll decide whether to adopt
            // based on their own threshold logic (>10% improvement required).
            for (let j = 1; j < workers.length; j++) {
              if (j !== msg.workerId) {
                safePostToWorker(j, {
                  type: "set-config",
                  config: msg.config,
                  globalScore: msg.score,
                });
              }
            }
          }
          workerBests[msg.workerId] = msg.score;
          break;
        case "stopped":
          workerAlive[msg.workerId] = false;
          break;
      }
    });
    worker.addEventListener("error", (event) => {
      workerAlive[i] = false;
      const detail =
        event instanceof ErrorEvent && typeof event.message === "string"
          ? event.message
          : "unknown worker error";
      lastSubmitStatus = ansi.color(ansi.red, `worker ${i} crashed: ${detail}`);
    });
    workers.push(worker);
    safePostToWorker(i, {
      type: "start",
      workerId: i,
      role,
    });
    if (currentSeed !== null) {
      safePostToWorker(i, { type: "seed", seedId: currentEpoch, seed: currentSeed });
    }
  }

  function resetEpoch(onChainSeedBest = 0): void {
    const prevBestScore = bestScore;
    const prevBestConfig = bestConfig;

    bestScore = 0;
    bestTape = null;
    lastSubmittedScore = onChainSeedBest; // start from on-chain best so we don't submit worse
    epochGamesPlayed = 0;
    epochSubmissions = 0;
    bestScoreFoundAt = 0;
    workerBests.fill(0);

    // Carry best config forward only if it improved over defaults
    const seedConfig = prevBestScore > 0 ? prevBestConfig : Autopilot.defaults();
    bestConfig = seedConfig;

    for (let i = 0; i < workers.length; i++) {
      safePostToWorker(i, { type: "reset-best" });
      if (i === 0) {
        // Exploiter gets the carried-forward best config
        safePostToWorker(i, {
          type: "set-config",
          config: seedConfig,
          globalScore: 0,
          force: true,
        });
      }
      // Explorers handle their own reset in reset-best (they pick a random config)
    }
  }

  // Submit if we have an unsubmitted improvement
  async function doSubmit(force = false): Promise<void> {
    if (submitting || !bestTape || bestScore <= lastSubmittedScore) return;

    // Check submission budget
    if (epochSubmissions >= MAX_SUBMISSIONS_PER_EPOCH && !force) {
      lastSubmitStatus = ansi.color(
        ansi.yellow,
        `budget exhausted (${MAX_SUBMISSIONS_PER_EPOCH}/${MAX_SUBMISSIONS_PER_EPOCH})`,
      );
      return;
    }

    // Settle delay: wait for score to stop climbing before submitting
    if (!force && bestScoreFoundAt > 0 && Date.now() - bestScoreFoundAt < SETTLE_DELAY_MS) {
      return;
    }

    submitting = true;
    const tape = bestTape;
    const score = bestScore;

    lastSubmitStatus = ansi.color(ansi.yellow, `submitting (score: ${score})...`);

    const result: SubmitResult = await api.submitRun(opts.identity, currentEpoch, tape);

    if (result.success) {
      totalSubmissions++;
      epochSubmissions++;
      lastSubmittedScore = score;
      lastSubmitStatus = ansi.color(
        ansi.green,
        `score ${score} submitted (run ${result.runId || "?"}, ${result.status || "queued"})`,
      );
      if (result.runId) trackRun(result.runId, score);
    } else if (result.rateLimited) {
      lastSubmitStatus = ansi.color(ansi.yellow, `rate limited - will retry`);
    } else {
      lastSubmitStatus = ansi.color(ansi.red, `failed: ${result.error}`);
    }

    submitting = false;
  }

  // Follow a submitted run in the background and show its final status.
  function trackRun(runId: string, score: number): void {
    void api
      .waitForRun(runId, { timeoutMs: 10 * 60_000, intervalMs: 3_000 })
      .then((run) => {
        if (run.status === "confirmed") {
          lastSubmitStatus = ansi.color(
            ansi.green,
            `run ${runId} confirmed: score ${run.score ?? score}` +
              (run.minted !== null && run.minted !== undefined ? `, minted ${run.minted}` : ""),
          );
          if ((run.score ?? score) > onChainBestScore) onChainBestScore = run.score ?? score;
        } else if (run.status === "rejected" || run.status === "failed") {
          lastSubmitStatus = ansi.color(
            ansi.red,
            `run ${runId} ${run.status}: ${run.error ?? "no reason given"}`,
          );
        }
        return undefined;
      })
      .catch(() => undefined);
  }

  // Main tick: check epoch transitions and submit improvements
  const tickInterval = setInterval(async () => {
    const epoch = getCurrentEpoch();

    // Epoch changed — new seed_id interval
    if (epoch !== currentEpoch) {
      // Drain loop: during doSubmit(), workers can still post new-best messages
      // that update bestScore/bestTape. Keep submitting until no unsubmitted
      // improvements remain so we never lose a late-arriving high score.
      /* eslint-disable no-await-in-loop, no-unmodified-loop-condition -- drain logic must wait for in-flight submits before deciding whether to submit again */
      for (let drain = 0; drain < 10; drain++) {
        while (submitting) await new Promise((r) => setTimeout(r, 100));
        if (bestTape && bestScore > lastSubmittedScore) {
          await doSubmit(true);
        } else {
          break;
        }
      }
      /* eslint-enable no-await-in-loop, no-unmodified-loop-condition */
      currentEpoch = epoch;
      currentSeed = null; // will be updated once the fetch resolves
      resetEpoch(); // reset immediately with 0, then backfill from on-chain
      lastSubmitStatus = ansi.color(ansi.cyan, "new seed_id interval — fetching seed...");
      announceSeedResolution = true;
      // Refresh seed and on-chain score in the background
      void refreshCurrentSeed(true);
      void fetchPlayerScore(address, opts.apiUrl).then((info) => {
        onChainBestScore = info.bestScore;
        return undefined;
      });
      // Fetch this player's on-chain best for the new seed so we don't
      // submit scores worse than what's already claimed.
      void api.bestScoreForSeed(address, epoch).then((seedBest) => {
        // Only apply if we're still in the same epoch and haven't already
        // submitted something better this session.
        if (epoch === currentEpoch && seedBest > lastSubmittedScore) {
          lastSubmittedScore = seedBest;
        }
        return undefined;
      });
    }

    // Initial/current epoch seed may not be materialized immediately.
    // Keep polling in the background until it appears so the dashboard can update.
    if (currentSeed === null) {
      void refreshCurrentSeed();
    }

    // Try to submit if we have a settled improvement
    await doSubmit();
  }, 2000);

  // Dashboard update
  process.stdout.write(ansi.clearScreen + ansi.cursorHide);
  const dashInterval = setInterval(() => {
    const now = Date.now();
    const epochRemainingSec = Math.max(0, (epochEndMs(currentEpoch) - now) / 1000);

    // Settle countdown (seconds remaining before we'll submit)
    let settleRemainingSec = 0;
    if (bestScoreFoundAt > 0 && bestScore > lastSubmittedScore) {
      const elapsed = now - bestScoreFoundAt;
      if (elapsed < SETTLE_DELAY_MS) {
        settleRemainingSec = Math.ceil((SETTLE_DELAY_MS - elapsed) / 1000);
      }
    }

    const stats: DashboardStats = {
      totalGamesPlayed,
      epochGamesPlayed,
      bestScore,
      lastSubmittedScore,
      totalSubmissions,
      lastSubmitStatus,
      epochRemainingSec,
      currentSeed,
      threads: threadCount,
      availableCores,
      address,
      startTime,
      workerBests,
      onChainBestScore,
      epochSubmissions,
      maxSubmissionsPerEpoch: MAX_SUBMISSIONS_PER_EPOCH,
      settleRemainingSec,
    };
    renderDashboard(stats);
  }, 500);

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    clearInterval(dashInterval);
    clearInterval(tickInterval);

    process.stdout.write(ansi.cursorShow);
    console.log("\n");
    console.log(ansi.color(ansi.brightCyan, "  Shutting down..."));

    // Stop workers
    for (let i = 0; i < workers.length; i++) {
      safePostToWorker(i, { type: "stop" });
    }

    // Drain any in-flight submit before the final one
    /* eslint-disable no-await-in-loop, no-unmodified-loop-condition -- shutdown must wait for the current submit to finish before the final flush */
    while (submitting) await new Promise((r) => setTimeout(r, 100));
    /* eslint-enable no-await-in-loop, no-unmodified-loop-condition */
    // Final submit if we have an unsubmitted improvement
    if (bestTape && bestScore > lastSubmittedScore) {
      console.log(ansi.color(ansi.yellow, `  Submitting best tape (score: ${bestScore})...`));
      const result = await api.submitRun(opts.identity, currentEpoch, bestTape);
      if (result.success) {
        totalSubmissions++;
        console.log(ansi.color(ansi.green, `  Submitted! Run: ${result.runId || "ok"}`));
        console.log(ansi.color(ansi.dim, `  Follow it with: kalien status ${result.runId || ""}`));
      } else {
        console.log(ansi.color(ansi.red, `  Submit failed: ${result.error}`));
      }
    } else {
      console.log(ansi.color(ansi.dim, "  No unsubmitted improvements."));
    }

    // Summary
    const elapsed = (Date.now() - startTime) / 1000;
    console.log("");
    console.log(ansi.color(ansi.brightWhite, "  Session Summary"));
    console.log(
      ansi.color(
        ansi.gray,
        `  Games: ${totalGamesPlayed}  |  Best: ${bestScore}  |  Submissions: ${totalSubmissions}`,
      ),
    );
    console.log(
      ansi.color(
        ansi.gray,
        `  On-chain best: ${onChainBestScore}  |  Duration: ${Math.round(elapsed)}s`,
      ),
    );
    console.log("");

    // Terminate workers
    for (const w of workers) {
      w.terminate();
    }

    process.exit(0);
  }

  process.on("SIGINT", () => {
    shutdown();
  });
  process.on("SIGTERM", () => {
    shutdown();
  });

  // Keep alive
  await new Promise(() => {});
}
