import { useCallback, useEffect, useRef, useState } from "react";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Play from "lucide-react/dist/esm/icons/play";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import User from "lucide-react/dist/esm/icons/user";
import { PageShell } from "@/components/shared/PageShell";
import { PageHero } from "@/components/shared/PageHero";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard, StatGrid } from "@/components/shared/StatCard";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { Link } from "@/components/shared/Link";
import { RelativeTime } from "@/components/leaderboard/RelativeTime";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useLocation } from "@/hooks/useLocation";
import { useThruputConfig } from "@/hooks/useThruputConfig";
import { explorerTxUrl } from "@/thruput/config";
import { toCanonicalId } from "@/thruput/ids";
import type { TxView } from "@/thruput/tx";
import { DEFAULT_EXPLORER_URL } from "@/consts";
import { abbreviateAddress, formatHex32, formatKalien } from "@/lib/format";
import { formatUtcDateTime } from "@/lib/time";

const PENDING_POLL_MS = 3_000;

type TxModule = typeof import("@/thruput/tx");

let txModulePromise: Promise<TxModule> | null = null;

function loadTxModule(): Promise<TxModule> {
  if (!txModulePromise) {
    txModulePromise = import("@/thruput/tx");
  }
  return txModulePromise;
}

function statusVariant(status: string): "success" | "info" | "warning" | "error" | "muted" {
  switch (status) {
    case "committed":
      return "success";
    case "pending":
    case "retry":
      return "info";
    case "dropped":
    case "recentFailure":
      return "warning";
    default:
      return "muted";
  }
}

function executionVariant(result: string | null): "success" | "error" | "muted" {
  if (result === "return") return "success";
  if (result === null) return "muted";
  return "error";
}

/** Whether the lifecycle can still change, so the page should poll. */
function isSettling(view: TxView): boolean {
  return (
    !view.receiptFound &&
    (view.status === "pending" || view.status === "retry" || view.status === "committed")
  );
}

function getHashFromPath(pathname: string): string {
  return decodeURIComponent(pathname.replace(/^\/tx\//u, "").split("/")[0] ?? "");
}

export function TxPage() {
  const pathname = useLocation();
  const rawHash = getHashFromPath(pathname);
  const hash = toCanonicalId(rawHash);
  useDocumentTitle(`Transaction ${abbreviateAddress(hash ?? rawHash)}`, {
    description: "Kalien transaction status, execution result, and run details on Thruput.",
    path: pathname,
    noIndex: true,
  });
  const { config } = useThruputConfig();
  const [view, setView] = useState<TxView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!hash) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const txModule = await loadTxModule();
      const next = await txModule.readTransaction(hash);
      if (requestId !== requestIdRef.current) return;
      setView(next);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "failed to read the transaction");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  // Poll while the transaction is pending or its receipt is not indexed yet.
  useEffect(() => {
    if (!view || !isSettling(view)) return;
    const timer = window.setTimeout(() => void load(), PENDING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [load, view]);

  const explorerHref = hash
    ? explorerTxUrl(config?.explorerUrl ?? DEFAULT_EXPLORER_URL, hash)
    : null;
  const run = view?.run ?? null;

  return (
    <PageShell glow className="content-start">
      <PageHero title="Transaction" subtitle={hash ?? rawHash}>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button size="sm" onClick={() => void load()} disabled={loading || !hash}>
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>
      </PageHero>

      {!hash ? (
        <ErrorMessage message="This is not a transaction hash (expected 32 bytes of base58)." />
      ) : null}
      <ErrorMessage message={error} />

      {hash && !view && !error ? (
        <Card className="animate-rise">
          <p className="m-0 text-text-soft">Reading the transaction from the network…</p>
        </Card>
      ) : null}

      {view ? (
        <Card className="animate-rise" data-testid="tx-summary">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={statusVariant(view.status)} data-testid="tx-status">
              {view.status}
            </StatusBadge>
            {view.executionResult ? (
              <StatusBadge
                variant={executionVariant(view.executionResult)}
                data-testid="tx-execution"
              >
                execution: {view.executionResult}
              </StatusBadge>
            ) : null}
            {view.scoreOutcome === "rejected" && view.errorName ? (
              <StatusBadge variant="warning">{view.errorName}</StatusBadge>
            ) : null}
          </div>
          <StatGrid columns={4}>
            <StatCard
              label="Block"
              value={view.blockHeight !== null ? view.blockHeight.toLocaleString() : "n/a"}
            />
            <StatCard
              label="Time"
              value={
                view.blockTime !== null ? (
                  <span title={formatUtcDateTime(view.blockTime * 1000)}>
                    <RelativeTime value={new Date(view.blockTime * 1000).toISOString()} />
                  </span>
                ) : (
                  "n/a"
                )
              }
            />
            <StatCard
              label="Gas used"
              value={view.gasUsed !== null ? view.gasUsed.toLocaleString() : "n/a"}
            />
            <StatCard label="Events" value={view.receiptFound ? view.eventCount : "n/a"} />
          </StatGrid>
          {!view.receiptFound ? (
            <p className="m-0 text-sm text-text-soft">
              {view.status === "committed"
                ? "Committed. The receipt is not indexed yet; this page checks again in a few seconds."
                : view.status === "pending" || view.status === "retry"
                  ? "Waiting for the network to commit this transaction."
                  : "No receipt yet. An unknown or dropped status does not prove the transaction never ran."}
            </p>
          ) : null}
          {view.note ? (
            <p className="m-0 font-mono text-xs break-all text-text-dim">{view.note}</p>
          ) : null}
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-link"
            >
              Explorer (team access)
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </Card>
      ) : null}

      {run ? (
        <Card className="animate-rise" data-testid="tx-run">
          <h2 className="m-0 font-display text-sm tracking-[0.08em] uppercase text-[rgba(176,219,255,0.95)]">
            Kalien Run
          </h2>
          <p className="m-0 text-sm">
            <span className="text-text-dim">Player </span>
            <Link href={`/leaderboard/${run.player}`} className="break-all text-link">
              {run.player}
            </Link>
          </p>
          <StatGrid columns={4}>
            <StatCard label="Score" value={run.finalScore.toLocaleString()} />
            <StatCard label="Previous best" value={run.previousBest.toLocaleString()} />
            <StatCard label="KALIEN minted" value={`+${formatKalien(run.mintedDelta)}`} />
            <StatCard label="Frames" value={run.frameCount.toLocaleString()} />
            <StatCard label="Seed" value={formatHex32(run.seed)} />
            <StatCard label="Seed id" value={run.seedId.toLocaleString()} />
            <StatCard label="New best" value={run.newBest.toLocaleString()} />
            <StatCard label="Relay" value={abbreviateAddress(run.relay)} />
          </StatGrid>
          <div className="flex flex-wrap gap-2">
            <Button variant="active" size="sm" asChild>
              <Link href={`/replay/${run.runId}`} className="no-underline">
                <Play className="size-3.5" />
                Replay
              </Link>
            </Button>
            <Button variant="space" size="sm" asChild>
              <Link href={`/leaderboard/${run.player}`} className="no-underline">
                <User className="size-3.5" />
                Player page
              </Link>
            </Button>
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}
