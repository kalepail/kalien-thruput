// Endless mode submits a finished run only when it can still earn KALIEN.
//
// The best score that counts is the confirmed one (the contract's best_score).
// A queued run is not a best: if it fails or is rejected, a weaker run must still
// be allowed (review item 16). While a stronger run on the same seed is still in
// flight, a weaker one is skipped, so endless mode does not spam the relay.

import type { RunStatus } from "./api";

export interface PendingEndlessRun {
  score: number;
  /** Worker run id; null while the POST is still in flight. */
  runId: string | null;
}

export type EndlessGateDecision =
  | { action: "submit"; clearPending: boolean }
  | { action: "skip"; reason: "zero-score" | "not-better" | "pending"; clearPending: boolean };

export async function decideEndlessSubmit(input: {
  score: number;
  /** Confirmed best for the seed, or null when it could not be read. */
  confirmedBest: number | null;
  pending: PendingEndlessRun | undefined;
  /** Current status of a pending run, or null when unknown (lookup failed). */
  getRunStatus: (runId: string) => Promise<RunStatus | null>;
}): Promise<EndlessGateDecision> {
  const { score, confirmedBest, pending } = input;
  if (score <= 0) {
    return { action: "skip", reason: "zero-score", clearPending: false };
  }
  if (confirmedBest !== null && score <= confirmedBest) {
    return { action: "skip", reason: "not-better", clearPending: false };
  }
  if (!pending || score > pending.score) {
    return { action: "submit", clearPending: false };
  }
  // A pending run scores at least as much as this one.
  if (pending.runId === null) {
    return { action: "skip", reason: "pending", clearPending: false };
  }
  let status: RunStatus | null = null;
  try {
    status = await input.getRunStatus(pending.runId);
  } catch {
    status = null;
  }
  if (status === "queued" || status === "submitting") {
    return { action: "skip", reason: "pending", clearPending: false };
  }
  if (status === "confirmed") {
    // The chain best already holds it (or will at the next read).
    return { action: "skip", reason: "not-better", clearPending: true };
  }
  // Rejected, failed, or unknown: the pending run does not count as a best.
  return { action: "submit", clearPending: true };
}
