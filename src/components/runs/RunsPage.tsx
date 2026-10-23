import { useCallback, useEffect, useRef, useState } from "react";
import Download from "lucide-react/dist/esm/icons/download";
import Play from "lucide-react/dist/esm/icons/play";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useWalletState } from "@/contexts/WalletContext";
import { PageShell } from "@/components/shared/PageShell";
import { PageHero } from "@/components/shared/PageHero";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SkeletonRows } from "@/components/shared/Skeleton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { Link } from "@/components/shared/Link";
import { Pagination } from "@/components/shared/Pagination";
import { RelativeTime } from "@/components/leaderboard/RelativeTime";
import { TxLink } from "@/components/runs/TxLink";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { navigate } from "@/hooks/useLocation";
import { downloadRunTape, listRuns, type RunListPage, type RunStatus } from "@/runs/api";
import { formatHex32, formatKalien, formatMetric } from "@/lib/format";
import { AUTO_REFRESH_RUNS_MS } from "@/consts";

const PAGE_SIZE = 25;

export function runStatusBadgeVariant(status: RunStatus): "success" | "error" | "info" | "warning" {
  switch (status) {
    case "confirmed":
      return "success";
    case "rejected":
      return "warning";
    case "failed":
      return "error";
    default:
      return "info";
  }
}

function RunsTableHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col" className="text-right">
          Score
        </TableHead>
        <TableHead scope="col" className="text-right">
          Frames
        </TableHead>
        <TableHead scope="col" className="text-right">
          KALIEN
        </TableHead>
        <TableHead scope="col">Seed</TableHead>
        <TableHead scope="col">Status</TableHead>
        <TableHead scope="col">Transaction</TableHead>
        <TableHead scope="col">Submitted</TableHead>
        <TableHead scope="col">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function RunsPage() {
  useDocumentTitle("My Runs", {
    description: "Your submitted Kalien runs and their on-chain status.",
    path: "/runs",
    noIndex: true,
  });
  const wallet = useWalletState();
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RunListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    (silent: boolean) => {
      if (!wallet.address) return;
      const requestId = ++requestIdRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      void (async () => {
        try {
          const next = await listRuns(wallet.address, { limit: PAGE_SIZE, offset });
          if (requestId !== requestIdRef.current) return;
          setPage(next);
          setError(null);
        } catch (err) {
          if (requestId !== requestIdRef.current) return;
          if (!silent) {
            setError(err instanceof Error ? err.message : "failed to load runs");
          }
        } finally {
          if (!silent && requestId === requestIdRef.current) {
            setLoading(false);
          }
        }
      })();
    },
    [offset, wallet.address],
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setPage(null);
    setOffset(0);
  }, [wallet.address]);

  useEffect(() => {
    loadRef.current(false);
  }, [offset, wallet.address]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadRef.current(true);
      }
    }, AUTO_REFRESH_RUNS_MS);
    return () => clearInterval(interval);
  }, []);

  const runs = page?.runs ?? [];

  return (
    <PageShell glow className="content-start">
      <PageHero title="My Runs" subtitle="Every run you submitted and its on-chain result.">
        <Button size="sm" onClick={() => load(false)} disabled={loading || !wallet.address}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </PageHero>

      <ErrorMessage message={error} />

      <Card className="animate-rise">
        {loading && !page ? (
          <Table aria-label="Loading runs">
            <RunsTableHead />
            <TableBody>
              <SkeletonRows count={3} cols={8} />
            </TableBody>
          </Table>
        ) : runs.length === 0 && offset === 0 ? (
          <div className="grid justify-items-center gap-2 p-6 text-center">
            <p className="m-0 text-text-soft">No runs yet.</p>
            <Button variant="active" asChild>
              <Link href="/" className="no-underline">
                Play Now
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-2 p-0 lg:hidden" aria-label="Submitted runs">
              {runs.map((run) => (
                <li
                  key={run.runId}
                  data-testid="run-card"
                  data-status={run.status}
                  className="grid gap-2 rounded-lg border border-border-subtle bg-[rgba(13,22,40,0.5)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-lg tabular-nums text-card-foreground">
                      {formatMetric(run.score)}
                    </span>
                    <StatusBadge variant={runStatusBadgeVariant(run.status)}>
                      {run.status}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-soft">
                    <span>
                      {run.minted !== null && run.minted > 0n
                        ? `+${formatKalien(run.minted)} KALIEN`
                        : "No KALIEN"}
                    </span>
                    <span>{formatMetric(run.frameCount)} frames</span>
                    <span>
                      Seed {run.seed !== null ? formatHex32(run.seed) : formatMetric(run.seedId)}
                    </span>
                    <RelativeTime value={run.createdAt} />
                  </div>
                  {run.txHash ? (
                    <p className="m-0 text-xs">
                      <TxLink txHash={run.txHash} />
                    </p>
                  ) : null}
                  {run.error && run.status !== "confirmed" ? (
                    <p className="m-0 text-xs text-warning [overflow-wrap:anywhere]">{run.error}</p>
                  ) : null}
                  {run.status === "confirmed" ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="space"
                        size="xs"
                        onClick={() => navigate(`/replay/${run.runId}`)}
                      >
                        <Play className="size-3.5" />
                        Replay
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => void downloadRunTape(run.runId)}
                      >
                        <Download className="size-3.5" />
                        Tape
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <Table aria-label="Submitted runs">
                <RunsTableHead />
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.runId} data-testid="run-row" data-status={run.status}>
                      <TableCell className="text-right tabular-nums">
                        {formatMetric(run.score)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetric(run.frameCount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {run.minted !== null && run.minted > 0n
                          ? `+${formatKalien(run.minted)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-display tracking-[0.04em]">
                        {run.seed !== null ? formatHex32(run.seed) : formatMetric(run.seedId)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          variant={runStatusBadgeVariant(run.status)}
                          title={run.error ?? undefined}
                        >
                          {run.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>{run.txHash ? <TxLink txHash={run.txHash} /> : "—"}</TableCell>
                      <TableCell>
                        <RelativeTime value={run.createdAt} />
                      </TableCell>
                      <TableCell>
                        {/* Tapes are served only once a run is confirmed. */}
                        <div
                          className={
                            run.status === "confirmed" ? "flex items-center gap-1" : "hidden"
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-primary hover:bg-primary/10 hover:text-primary"
                            onClick={() => navigate(`/replay/${run.runId}`)}
                            title="Replay this run"
                          >
                            <Play className="size-3.5" />
                            Replay
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void downloadRunTape(run.runId)}
                            title="Download tape"
                            aria-label="Download tape"
                          >
                            <Download className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {runs.some((run) => run.error && run.status !== "confirmed") && (
              <div className="hidden gap-1 lg:grid text-xs text-text-soft">
                {runs
                  .filter((run) => run.error && run.status !== "confirmed")
                  .slice(0, 5)
                  .map((run) => (
                    <p key={run.runId} className="m-0 [overflow-wrap:anywhere]">
                      <span className="text-warning">{run.score?.toLocaleString() ?? "?"}:</span>{" "}
                      {run.error}
                    </p>
                  ))}
              </div>
            )}
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={page?.total ?? offset + runs.length}
              nextOffset={page?.nextOffset ?? null}
              onOffsetChange={setOffset}
              disabled={loading}
            />
          </>
        )}
      </Card>
    </PageShell>
  );
}
