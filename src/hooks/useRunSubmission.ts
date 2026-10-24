import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRun,
  isTerminalRunStatus,
  RunApiError,
  submitRun as postRun,
  type RunRecord,
  type RunStatus,
} from "../runs/api";
import { serializeTape } from "../game/tape";
import type { CompletedGameRun } from "../game/types";
import { getThruputConfig, refreshThruputConfig } from "../thruput/config";
import { claimMessage } from "../thruput/claim";
import { bytesToHex } from "../lib/hex";
import {
  RUN_STATUS_ERROR_POLL_INTERVAL_MS,
  RUN_STATUS_INITIAL_POLL_DELAY_MS,
  RUN_STATUS_POLL_INTERVAL_MS,
} from "../consts";

export interface RunSigner {
  pubkeyHex: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface UseRunSubmissionReturn {
  run: RunRecord | null;
  status: RunStatus | "idle";
  isBusy: boolean;
  isSubmitting: boolean;
  error: string | null;
  friendlyStatus: string;
  submit: (completed: CompletedGameRun, signer: RunSigner) => Promise<RunRecord | null>;
  clearError: () => void;
  setError: (message: string) => void;
  clear: () => void;
}

export function getFriendlyRunStatus(status: RunStatus | "idle"): string {
  switch (status) {
    case "queued":
      return "Run queued";
    case "submitting":
      return "Replaying on-chain...";
    case "confirmed":
      return "Score confirmed!";
    case "rejected":
      return "Run rejected";
    case "failed":
      return "Submission failed";
    default:
      return "Ready";
  }
}

export interface UseRunSubmissionOptions {
  onConfirmed?: (run: RunRecord) => void;
}

/** Stop polling a run that is still not terminal after this long. */
export const RUN_POLL_MAX_MS = 15 * 60_000;
const RUN_POLL_MAX_ERROR_DELAY_MS = 60_000;

export type PollStep = { action: "poll"; delayMs: number } | { action: "stop"; message: string };

/**
 * What to do after one status poll. `errorStatus` is null after a good answer,
 * else the HTTP status (0 for a network error or timeout).
 */
export function nextPollStep(input: {
  errorStatus: number | null;
  consecutiveErrors: number;
  elapsedMs: number;
}): PollStep {
  if (input.errorStatus === 404) {
    return {
      action: "stop",
      message:
        "the Worker has no record of this run (was the devnet reset?). Check My Runs for its status",
    };
  }
  if (input.elapsedMs >= RUN_POLL_MAX_MS) {
    return {
      action: "stop",
      message:
        "this run is still not final after 15 minutes. It may still confirm; check My Runs later",
    };
  }
  if (input.errorStatus === null) {
    return { action: "poll", delayMs: RUN_STATUS_POLL_INTERVAL_MS };
  }
  const backoff = RUN_STATUS_ERROR_POLL_INTERVAL_MS * 2 ** Math.max(0, input.consecutiveErrors - 1);
  return { action: "poll", delayMs: Math.min(backoff, RUN_POLL_MAX_ERROR_DELAY_MS) };
}

export function useRunSubmission(options?: UseRunSubmissionOptions): UseRunSubmissionReturn {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onConfirmedRef = useRef(options?.onConfirmed);
  onConfirmedRef.current = options?.onConfirmed;

  // Synchronous guard: set by clear(), checked by poll before calling setRun.
  // Prevents in-flight polls from overriding a clear that hasn't been rendered yet.
  const runClearedRef = useRef(false);
  // Polling stopped for this run (404 or time limit); the run is not "busy" any more.
  const [stoppedRunId, setStoppedRunId] = useState<string | null>(null);
  const pollStartRef = useRef<{ runId: string; startedAt: number } | null>(null);

  const activeRunId = run?.runId ?? null;
  const activeStatus = run?.status ?? null;
  const status: RunStatus | "idle" = run ? run.status : "idle";
  const isBusy = run ? !isTerminalRunStatus(run.status) && stoppedRunId !== run.runId : false;

  const submit = useCallback(
    async (completed: CompletedGameRun, signer: RunSigner): Promise<RunRecord | null> => {
      if (completed.record.finalScore <= 0) {
        setError("zero-score runs do not earn KALIEN");
        return null;
      }
      if (completed.record.seedId >>> 0 === 0) {
        setError("this run is missing seed_id metadata; play with a live seed");
        return null;
      }
      if (signer.pubkeyHex.length === 0) {
        setError("the player key is not ready yet");
        return null;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const tape = serializeTape(
          completed.record.seed,
          completed.record.inputs,
          completed.record.finalScore,
        );
        const seedId = completed.record.seedId >>> 0;
        const signAndPost = async () => {
          const config = await getThruputConfig();
          const message = await claimMessage({
            networkHash: config.networkHash,
            scoreContract: config.scoreContract,
            seedId,
            tape,
          });
          const signature = await signer.sign(message);
          return postRun({
            tape,
            pubkeyHex: signer.pubkeyHex,
            seedId,
            signatureHex: bytesToHex(signature),
          });
        };
        let created: RunRecord;
        try {
          created = await signAndPost();
        } catch (err) {
          // The Worker refused the claim signature: this tab may still hold the
          // config from before a devnet reset. The POST was refused outright (no
          // chain write), so re-signing once for the new network is safe.
          if (!(err instanceof RunApiError) || err.code !== "bad_signature") throw err;
          const changed = await refreshThruputConfig().catch(() => false);
          if (!changed) throw err;
          created = await signAndPost();
        }
        runClearedRef.current = false;
        setRun(created);
        return created;
      } catch (err) {
        if (err instanceof RunApiError) {
          if (err.run) {
            runClearedRef.current = false;
            setRun(err.run);
          }
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "failed to submit run");
        }
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const setErrorExposed = useCallback((message: string) => {
    setError(message);
  }, []);

  const clear = useCallback(() => {
    runClearedRef.current = true;
    setRun(null);
  }, []);

  // Run status polling: stops on a terminal status, on 404, or after a time limit;
  // errors back off (see nextPollStep).
  useEffect(() => {
    if (!activeRunId || !activeStatus || isTerminalRunStatus(activeStatus)) {
      return;
    }
    if (pollStartRef.current?.runId !== activeRunId) {
      pollStartRef.current = { runId: activeRunId, startedAt: Date.now() };
    }
    const startedAt = pollStartRef.current.startedAt;

    let cancelled = false;
    let timeoutId: number | null = null;
    let consecutiveErrors = 0;

    const schedule = (step: PollStep) => {
      if (step.action === "poll") {
        timeoutId = window.setTimeout(poll, step.delayMs);
        return;
      }
      setStoppedRunId(activeRunId);
      setError(step.message);
    };

    const poll = async () => {
      try {
        const next = await getRun(activeRunId);
        if (cancelled || runClearedRef.current) {
          return;
        }
        consecutiveErrors = 0;
        setRun(next);
        setError(null);
        if (!isTerminalRunStatus(next.status)) {
          schedule(
            nextPollStep({
              errorStatus: null,
              consecutiveErrors,
              elapsedMs: Date.now() - startedAt,
            }),
          );
        }
      } catch (err) {
        if (cancelled || runClearedRef.current) {
          return;
        }
        consecutiveErrors += 1;
        const step = nextPollStep({
          errorStatus: err instanceof RunApiError ? err.status : 0,
          consecutiveErrors,
          elapsedMs: Date.now() - startedAt,
        });
        if (step.action === "poll") {
          setError(err instanceof Error ? err.message : "failed to refresh run status");
        }
        schedule(step);
      }
    };

    timeoutId = window.setTimeout(poll, RUN_STATUS_INITIAL_POLL_DELAY_MS);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeRunId, activeStatus]);

  // Notify once when the run is confirmed.
  useEffect(() => {
    if (run?.status === "confirmed") {
      onConfirmedRef.current?.(run);
    }
    // Only the status transition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.runId]);

  return {
    run,
    status,
    isBusy,
    isSubmitting,
    error,
    friendlyStatus: getFriendlyRunStatus(status),
    submit,
    clearError,
    setError: setErrorExposed,
    clear,
  };
}
