import type { RunRecord, RunStatus } from "./store";

/** Run status as the API returns it (Worker API v0). */
export interface RunView {
  runId: string;
  status: RunStatus;
  playerAddress: string;
  seedId: number;
  seed: number;
  frameCount: number;
  claimedScore: number;
  /** Confirmed new best, else the claimed score. */
  score: number;
  previousBest: number | null;
  /** KALIEN base units (7 decimals) as a decimal string, once confirmed. */
  minted: string | null;
  txHash: string | null;
  blockHeight: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function runView(run: RunRecord): RunView {
  return {
    runId: run.runId,
    status: run.status,
    playerAddress: run.playerAddress,
    seedId: run.seedId,
    seed: run.seed,
    frameCount: run.frameCount,
    claimedScore: run.claimedScore,
    score: run.score ?? run.claimedScore,
    previousBest: run.previousBest,
    minted: run.minted,
    txHash: run.txHash,
    blockHeight: run.blockHeight,
    attempts: run.attempts,
    error: run.error,
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
  };
}
