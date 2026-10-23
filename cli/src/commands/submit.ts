import { readFileSync } from "fs";
import { deserializeTape } from "@/game/tape";
import { KalienApi, isTerminalStatus, type RunRecord } from "../api/client";
import type { Identity } from "../identity/keyfile";
import { MAX_FRAMES } from "../constants";
import * as ansi from "../display/ansi";

export interface SubmitOptions {
  identity: Identity;
  apiUrl: string;
  tapePath: string;
  /** Explicit seed_id. Default: the current seed_id, if its seed matches the tape. */
  seedId: number | null;
  wait: boolean;
  timeoutMs: number;
  json: boolean;
}

function printRun(run: RunRecord, explorerUrl = ""): void {
  const color =
    run.status === "confirmed"
      ? ansi.green
      : run.status === "rejected" || run.status === "failed"
        ? ansi.red
        : ansi.yellow;
  console.log(`  ${ansi.color(ansi.gray, "Run:")}      ${run.runId}`);
  console.log(`  ${ansi.color(ansi.gray, "Status:")}   ${ansi.color(color, run.status)}`);
  if (run.score !== null && run.score !== undefined) {
    console.log(`  ${ansi.color(ansi.gray, "Score:")}    ${run.score}`);
  }
  if (run.previousBest !== null && run.previousBest !== undefined) {
    console.log(`  ${ansi.color(ansi.gray, "Previous:")} ${run.previousBest}`);
  }
  if (run.minted !== null && run.minted !== undefined) {
    console.log(`  ${ansi.color(ansi.gray, "Minted:")}   ${run.minted}`);
  }
  if (run.txHash) {
    console.log(`  ${ansi.color(ansi.gray, "Tx:")}       ${run.txHash}`);
    if (explorerUrl) {
      console.log(
        `  ${ansi.color(ansi.gray, "Explorer:")} ${explorerUrl.replace(/\/+$/, "")}/tx/${run.txHash}`,
      );
    }
  }
  if (run.error)
    console.log(`  ${ansi.color(ansi.gray, "Error:")}    ${ansi.color(ansi.red, run.error)}`);
}

/** Submit one tape file as a run, then follow it to a final status. */
export async function submitCommand(opts: SubmitOptions): Promise<void> {
  const tapeBytes = new Uint8Array(readFileSync(opts.tapePath));
  const tape = deserializeTape(tapeBytes, MAX_FRAMES);
  const api = new KalienApi(opts.apiUrl);

  let seedId = opts.seedId;
  if (seedId === null) {
    const current = await api.currentSeed();
    if (current.seed !== tape.header.seed >>> 0) {
      throw new Error(
        `tape seed 0x${tape.header.seed.toString(16).padStart(8, "0")} does not match the current seed ` +
          `0x${current.seed.toString(16).padStart(8, "0")} (seed_id ${current.seedId}); pass --seed-id`,
      );
    }
    seedId = current.seedId;
  }

  if (!opts.json) {
    console.log(`  ${ansi.color(ansi.gray, "Tape:")}     ${opts.tapePath}`);
    console.log(
      `  ${ansi.color(ansi.gray, "Seed:")}     0x${tape.header.seed.toString(16).padStart(8, "0")} (seed_id ${seedId})`,
    );
    console.log(
      `  ${ansi.color(ansi.gray, "Frames:")}   ${tape.header.frameCount}  ${ansi.color(ansi.gray, "Score:")} ${tape.footer.finalScore}`,
    );
    console.log(`  ${ansi.color(ansi.gray, "Player:")}   ${opts.identity.address}`);
  }

  const result = await api.submitRun(opts.identity, seedId, tapeBytes);
  if (!result.success || !result.runId) {
    if (opts.json) {
      console.log(
        JSON.stringify({
          ok: false,
          error: result.error,
          code: result.code,
          bestScore: result.bestScore,
          httpStatus: result.httpStatus,
        }),
      );
    }
    throw new Error(`submit failed: ${result.error ?? "unknown error"}`);
  }

  if (result.existing && !opts.json) {
    console.log(
      ansi.color(ansi.dim, "  This tape was already submitted by you; showing that run."),
    );
  }
  let run: RunRecord = { runId: result.runId, status: result.status ?? "queued" };
  if (opts.wait && !isTerminalStatus(run.status)) {
    run = await api.waitForRun(result.runId, {
      timeoutMs: opts.timeoutMs,
      onUpdate: (r) => {
        if (!opts.json) console.log(ansi.color(ansi.dim, `  ... ${r.status}`));
      },
    });
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, existing: result.existing === true, ...run }));
  } else {
    printRun(run, (await api.config().catch(() => null))?.explorerUrl);
  }
  if (run.status === "rejected" || run.status === "failed") process.exit(2);
}

export async function statusCommand(apiUrl: string, runId: string, wait: boolean): Promise<void> {
  const api = new KalienApi(apiUrl);
  const run = wait ? await api.waitForRun(runId) : await api.getRun(runId);
  printRun(run, (await api.config().catch(() => null))?.explorerUrl);
}
