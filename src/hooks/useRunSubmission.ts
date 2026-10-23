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
import { getThruputConfig } from "../thruput/config";
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

export function useRunSubmission(options?: UseRunSubmissionOptions): UseRunSubmissionReturn {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onConfirmedRef = useRef(options?.onConfirmed);
  onConfirmedRef.current = options?.onConfirmed;

  // Synchronous guard: set by clear(), checked by poll before calling setRun.
  // Prevents in-flight polls from overriding a clear that hasn't been rendered yet.
  const runClearedRef = useRef(false);

  const activeRunId = run?.runId ?? null;
  const activeStatus = run?.status ?? null;
  const status: RunStatus | "idle" = run ? run.status : "idle";
  const isBusy = run ? !isTerminalRunStatus(run.status) : false;

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
        const config = await getThruputConfig();
        const seedId = completed.record.seedId >>> 0;
        const message = await claimMessage({
          networkHash: config.networkHash,
          scoreContract: config.scoreContract,
          seedId,
          tape,
        });
        const signature = await signer.sign(message);
        const created = await postRun({
          tape,
          pubkeyHex: signer.pubkeyHex,
          seedId,
          signatureHex: bytesToHex(signature),
        });
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

  // Run status polling.
  useEffect(() => {
    if (!activeRunId || !activeStatus || isTerminalRunStatus(activeStatus)) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        const next = await getRun(activeRunId);
        if (cancelled || runClearedRef.current) {
          return;
        }
        setRun(next);
        setError(null);
        if (!isTerminalRunStatus(next.status)) {
          timeoutId = window.setTimeout(poll, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled || runClearedRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "failed to refresh run status");
        timeoutId = window.setTimeout(poll, RUN_STATUS_ERROR_POLL_INTERVAL_MS);
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
