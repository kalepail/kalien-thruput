import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Gamepad2 from "lucide-react/dist/esm/icons/gamepad-2";
import History from "lucide-react/dist/esm/icons/history";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import PartyPopper from "lucide-react/dist/esm/icons/party-popper";
import Send from "lucide-react/dist/esm/icons/send";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import type { RunRecord, RunStatus } from "@/runs/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { Link } from "@/components/shared/Link";
import { TxLink } from "@/components/runs/TxLink";
import { cn } from "@/lib/utils";
import { formatKalien } from "@/lib/format";

export interface RunProgressProps {
  run: RunRecord | null;
  status: RunStatus | "idle";
  friendlyStatus: string;
  isBusy: boolean;
  error: string | null;
  onPlayAgain?: () => void;
  hintText?: string | null;
  className?: string;
}

function statusDetail(status: RunStatus | "idle"): string | null {
  switch (status) {
    case "queued":
      return "The relay will send your run to Thruput Futurenet.";
    case "submitting":
      return "The score contract is replaying your tape frame by frame.";
    default:
      return null;
  }
}

export function RunProgress({
  run,
  status,
  friendlyStatus,
  isBusy,
  error,
  onPlayAgain,
  hintText,
  className,
}: RunProgressProps) {
  const isConfirmed = status === "confirmed";
  const isFailed = status === "rejected" || status === "failed";
  const detail = statusDetail(status);
  const minted =
    run?.minted ??
    (isConfirmed && run?.score != null
      ? BigInt(Math.max(0, run.score - (run.previousBest ?? 0))) * 10_000_000n
      : null);

  return (
    <Card
      data-slot="run-progress"
      className={cn(
        "gap-4",
        isConfirmed && "border-secondary/35",
        isFailed && "border-destructive/35",
        className,
      )}
      aria-live="polite"
      aria-label="Run submission progress"
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            isBusy && "animate-pulse bg-primary/15 text-primary",
            isConfirmed && "bg-secondary/15 text-secondary",
            isFailed && "bg-destructive/15 text-destructive",
            !isBusy && !isConfirmed && !isFailed && "bg-muted text-muted-foreground",
          )}
        >
          {isBusy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : isConfirmed ? (
            <PartyPopper className="size-5" aria-hidden="true" />
          ) : isFailed ? (
            <XCircle className="size-5" aria-hidden="true" />
          ) : (
            <Send className="size-5" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "m-0 font-display text-sm font-semibold uppercase tracking-[0.05em]",
              isBusy && "text-primary",
              isConfirmed && "text-secondary",
              isFailed && "text-destructive",
              !isBusy && !isConfirmed && !isFailed && "text-card-foreground",
            )}
            data-testid="run-status"
            data-status={status}
          >
            {friendlyStatus}
          </p>
          {detail && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{detail}</p>}
        </div>
      </div>

      {isBusy && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-primary/10"
          role="progressbar"
          aria-label="Run submission in progress"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
        </div>
      )}

      {isConfirmed && (
        <dl className="m-0 grid grid-cols-3 gap-2 text-center">
          <div className="grid gap-0.5">
            <dt className="font-display text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
              Score
            </dt>
            <dd className="m-0 font-display text-sm text-secondary">
              {run?.score != null ? run.score.toLocaleString() : "—"}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-display text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
              Previous Best
            </dt>
            <dd className="m-0 font-display text-sm text-card-foreground">
              {run?.previousBest != null ? run.previousBest.toLocaleString() : "0"}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-display text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
              KALIEN Minted
            </dt>
            <dd className="m-0 font-display text-sm text-secondary">
              {minted !== null ? `+${formatKalien(minted)}` : "—"}
            </dd>
          </div>
        </dl>
      )}

      {run?.txHash && (
        <p className="m-0 text-xs text-muted-foreground">
          Transaction: <TxLink txHash={run.txHash} />
        </p>
      )}

      <ErrorMessage message={error ?? (isFailed ? run?.error : null)} />

      {isBusy && (
        <>
          <p className="m-0 text-xs text-muted-foreground">
            {hintText ?? "This usually takes a few seconds. You can play again while it runs."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onPlayAgain && (
              <Button variant="ghost" size="sm" onClick={onPlayAgain}>
                <Gamepad2 className="size-3.5" aria-hidden="true" />
                Play Again
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/runs" className="no-underline">
                <History className="size-3.5" aria-hidden="true" />
                My Runs
              </Link>
            </Button>
          </div>
        </>
      )}

      {isConfirmed && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="space" size="sm" asChild>
            <Link href="/runs" className="no-underline">
              <History className="size-3.5" />
              My Runs
            </Link>
          </Button>
          <Button variant="space" size="sm" asChild>
            <Link href="/leaderboard" className="no-underline">
              <ExternalLink className="size-3.5" />
              Leaderboard
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
