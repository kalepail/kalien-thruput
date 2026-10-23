import { useCallback, useState } from "react";
import type { CompletedGameRun } from "../game/types";
import { deserializeTape } from "../game/tape";
import type { RunRecord } from "../runs/api";
import type { UseWalletReturn } from "./useWallet";
import { useRunSubmission, type UseRunSubmissionReturn } from "./useRunSubmission";
import type { UseTokenBalanceReturn } from "./useTokenBalance";

export type GameFlowStep = "play" | "score" | "submit" | "earn";

export interface UseGameFlowReturn {
  currentStep: GameFlowStep;
  wallet: UseWalletReturn;
  submission: UseRunSubmissionReturn;
  balance: UseTokenBalanceReturn;
  latestRun: CompletedGameRun | null;
  hasPositiveScore: boolean;
  handleGameOver: (run: CompletedGameRun) => void;
  dismissOverlay: () => void;
  submitCompletedRun: (run: CompletedGameRun) => Promise<RunRecord | null>;
  submitLatestRun: () => Promise<RunRecord | null>;
  loadTapeFile: () => void;
  canSubmit: boolean;
}

export interface UseGameFlowDeps {
  wallet: UseWalletReturn;
  balance: UseTokenBalanceReturn;
  onRunConfirmed?: (run: RunRecord) => void;
}

export function useGameFlow(deps: UseGameFlowDeps): UseGameFlowReturn {
  const [latestRun, setLatestRun] = useState<CompletedGameRun | null>(null);

  const { wallet, balance, onRunConfirmed } = deps;

  const submission = useRunSubmission({
    onConfirmed: (run) => {
      void balance.refresh();
      onRunConfirmed?.(run);
    },
  });
  const { clear, clearError, setError, submit } = submission;

  const hasPositiveScore = (latestRun?.record.finalScore ?? 0) > 0;

  const handleGameOver = useCallback(
    (run: CompletedGameRun) => {
      setLatestRun(run);
      clearError();
      clear();
    },
    [clear, clearError],
  );

  const dismissOverlay = useCallback(() => {
    setLatestRun(null);
  }, []);

  const loadTapeFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tape";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const tape = deserializeTape(bytes);
          // Tape v4 format does not carry seed_id — set to 0 so the submit
          // guard rejects with a clear message rather than sending a run the
          // contract cannot match to a seed.
          setLatestRun({
            record: {
              seed: tape.header.seed,
              seedId: 0,
              inputs: tape.inputs,
              finalScore: tape.footer.finalScore,
            },
            frameCount: tape.header.frameCount,
            endedAtMs: Date.now(),
          });
          clearError();
          clear();
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          setError(`failed to load tape file: ${detail}`);
        }
      })();
    });
    input.click();
  }, [clear, clearError, setError]);

  const submitCompletedRun = useCallback(
    async (run: CompletedGameRun) => {
      return submit(run, { pubkeyHex: wallet.pubkeyHex, sign: wallet.sign });
    },
    [submit, wallet.pubkeyHex, wallet.sign],
  );

  const submitLatestRun = useCallback(async () => {
    if (!latestRun) {
      return null;
    }
    return submitCompletedRun(latestRun);
  }, [latestRun, submitCompletedRun]);

  const canSubmit =
    Boolean(latestRun) &&
    hasPositiveScore &&
    !submission.isSubmitting &&
    !submission.isBusy &&
    submission.run === null &&
    wallet.isConnected &&
    !wallet.isBusy;

  let currentStep: GameFlowStep = "play";
  if (submission.run?.status === "confirmed") {
    currentStep = "earn";
  } else if (submission.isBusy || submission.isSubmitting) {
    currentStep = "submit";
  } else if (latestRun) {
    currentStep = "score";
  }

  return {
    currentStep,
    wallet,
    submission,
    balance,
    latestRun,
    hasPositiveScore,
    handleGameOver,
    dismissOverlay,
    submitCompletedRun,
    submitLatestRun,
    loadTapeFile,
    canSubmit,
  };
}
