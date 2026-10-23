import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Send from "lucide-react/dist/esm/icons/send";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SubmitScoreProps {
  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  isWalletReady: boolean;
  hasPositiveScore: boolean;
  score: number;
  /** Best confirmed score on this seed, or null while unknown. */
  scoreToBeat: number | null;
  isScoreToBeatLoading: boolean;
  className?: string;
}

export function SubmitScore({
  onSubmit,
  canSubmit,
  isSubmitting,
  isWalletReady,
  hasPositiveScore,
  score,
  scoreToBeat,
  isScoreToBeatLoading,
  className,
}: SubmitScoreProps) {
  const beatsBest = scoreToBeat === null || score > scoreToBeat;
  const enabled = canSubmit && beatsBest;

  const helperText = !isWalletReady
    ? "Preparing your player key..."
    : !hasPositiveScore
      ? "Score points to earn KALIEN"
      : !beatsBest
        ? `Your best on this seed is ${scoreToBeat?.toLocaleString()}. Beat it to earn more KALIEN.`
        : scoreToBeat && scoreToBeat > 0
          ? `Beats your best of ${scoreToBeat.toLocaleString()} on this seed.`
          : isScoreToBeatLoading
            ? "Checking your best score on this seed..."
            : null;

  return (
    <div data-slot="submit-score" className={cn("grid gap-2 text-center", className)}>
      <Button
        variant={enabled ? "active" : "space"}
        size="lg"
        onClick={onSubmit}
        disabled={!enabled}
        className="w-full"
        aria-label="Submit score on-chain"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Submitting...
          </>
        ) : !beatsBest ? (
          "Not a new best"
        ) : (
          <>
            <Send className="size-4" aria-hidden="true" />
            Submit Score
          </>
        )}
      </Button>

      {helperText && !isSubmitting && (
        <p className="m-0 text-xs text-muted-foreground">{helperText}</p>
      )}

      {isSubmitting && (
        <p className="m-0 text-xs text-primary">Signing and sending your game tape...</p>
      )}
    </div>
  );
}
