import Play from "lucide-react/dist/esm/icons/play";
import type { LeaderboardPlayer } from "@/leaderboard/api";
import { formatHex32, formatKalien, formatMetric } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { SkeletonRows } from "@/components/shared/Skeleton";
import { Pagination } from "@/components/shared/Pagination";
import { RelativeTime } from "./RelativeTime";
import { TxLink } from "@/components/runs/TxLink";
import { navigate } from "@/hooks/useLocation";

export interface RecentRunsTableProps {
  runs: LeaderboardPlayer["recentRuns"];
  pagination: LeaderboardPlayer["runsPagination"];
  offset: number;
  onOffsetChange: (offset: number) => void;
  isLoading: boolean;
  limit: number;
}

export function RecentRunsTable({
  runs,
  pagination,
  offset,
  onOffsetChange,
  isLoading,
  limit,
}: RecentRunsTableProps) {
  const renderReplayButton = (runId: string | null) => {
    if (!runId) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="justify-center px-2.5 text-primary hover:bg-primary/10 hover:text-primary sm:px-3"
        onClick={() => navigate(`/replay/${runId}`)}
        title="Replay this run"
      >
        <Play className="size-3.5" />
        Replay
      </Button>
    );
  };

  return (
    <Card>
      <h3 className="m-0 font-display tracking-[0.055em] uppercase">Recent Runs</h3>
      <p className="m-0 text-sm text-text-soft">
        Recent runs lists every confirmed score for this player, not only the best run.
      </p>
      {runs.length === 0 && offset === 0 ? (
        <p className="m-0 text-text-soft">No confirmed runs yet.</p>
      ) : (
        <>
          {isLoading ? (
            <Table aria-label="Recent confirmed runs">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="text-right">
                    Score
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Frames
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    KALIEN Earned
                  </TableHead>
                  <TableHead scope="col">Seed</TableHead>
                  <TableHead scope="col">Completed</TableHead>
                  <TableHead scope="col">Transaction</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Replay</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SkeletonRows count={3} cols={7} />
              </TableBody>
            </Table>
          ) : (
            <Table aria-label="Recent confirmed runs">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="text-right">
                    Score
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Frames
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    KALIEN Earned
                  </TableHead>
                  <TableHead scope="col">Seed</TableHead>
                  <TableHead scope="col">Completed</TableHead>
                  <TableHead scope="col">Transaction</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Replay</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.runId ?? run.txHash ?? `${run.seed}:${run.score}`}>
                    <TableCell className="text-right tabular-nums">
                      {run.score.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMetric(run.frameCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.minted !== null ? formatKalien(run.minted) : "n/a"}
                    </TableCell>
                    <TableCell className="font-display tracking-[0.04em]">
                      {formatHex32(run.seed)}
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={run.completedAt} />
                    </TableCell>
                    <TableCell>{run.txHash ? <TxLink txHash={run.txHash} /> : "n/a"}</TableCell>
                    <TableCell>{renderReplayButton(run.runId)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            offset={offset}
            limit={limit}
            total={pagination.total}
            nextOffset={pagination.nextOffset}
            onOffsetChange={onOffsetChange}
            disabled={isLoading}
          />
        </>
      )}
    </Card>
  );
}
