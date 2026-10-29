import Medal from "lucide-react/dist/esm/icons/medal";
import Play from "lucide-react/dist/esm/icons/play";
import Trophy from "lucide-react/dist/esm/icons/trophy";
import type { LeaderboardEntry } from "@/leaderboard/api";
import { abbreviateAddress, formatHex32, formatKalien, formatMetric } from "@/lib/format";
import { isSafeUrl } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Skeleton, SkeletonRows } from "@/components/shared/Skeleton";
import { Link } from "@/components/shared/Link";
import { RelativeTime } from "./RelativeTime";
import { TxLink } from "@/components/runs/TxLink";
import { navigate } from "@/hooks/useLocation";

export interface RankingsTableProps {
  entries: LeaderboardEntry[];
  highlightAddress?: string;
  isLoading?: boolean;
}

function displayName(entry: LeaderboardEntry): string {
  return entry.profile?.username?.trim() || abbreviateAddress(entry.playerAddress);
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center gap-1 font-display font-bold tracking-wider text-[#ffe08f]">
        <Trophy className="size-4" />#{rank}
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center gap-1 font-display font-bold tracking-wider text-[#d8ecff]">
        <Medal className="size-4" />#{rank}
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center gap-1 font-display font-bold tracking-wider text-[#ffcda2]">
        <Medal className="size-4" />#{rank}
      </span>
    );
  }
  return <span className="font-display tracking-wider">#{rank}</span>;
}

function ReplayRunButton({ runId, className }: { runId: string | null; className?: string }) {
  if (!runId) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn(
        "justify-center px-2.5 text-primary hover:bg-primary/10 hover:text-primary sm:px-3",
        className,
      )}
      onClick={() => navigate(`/replay/${runId}`)}
      title="Replay this run"
    >
      <Play className="size-3.5" />
      Replay
    </Button>
  );
}

export function RankingsTable({ entries, highlightAddress, isLoading }: RankingsTableProps) {
  if (isLoading) {
    return (
      <>
        <ul
          className="m-0 grid list-none gap-2 p-0 lg:hidden"
          aria-label="Loading leaderboard rankings"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-lg border border-border-subtle bg-[rgba(13,22,40,0.5)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton wide />
                <Skeleton />
              </div>
              <Skeleton wide className="w-40" />
            </li>
          ))}
        </ul>
        <div className="hidden lg:block">
          <Table aria-label="Loading leaderboard rankings">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Rank</TableHead>
                <TableHead scope="col">Player</TableHead>
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
              <SkeletonRows count={5} cols={9} />
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Phones and tablets: one card per entry, so nothing scrolls sideways. */}
      <ul className="m-0 grid list-none gap-2 p-0 lg:hidden" aria-label="Leaderboard rankings">
        {entries.map((entry) => (
          <li
            key={`${entry.playerAddress}:${entry.runId ?? entry.txHash ?? entry.rank}`}
            className={cn(
              "grid gap-1.5 rounded-lg border border-border-subtle bg-[rgba(13,22,40,0.5)] p-3",
              highlightAddress === entry.playerAddress &&
                "border-primary/45 bg-[rgba(16,67,84,0.34)]",
            )}
            data-testid="leaderboard-card"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <RankBadge rank={entry.rank} />
                <Link
                  href={`/leaderboard/${entry.playerAddress}`}
                  className="truncate text-link no-underline hover:underline"
                >
                  {displayName(entry)}
                </Link>
              </div>
              <span className="shrink-0 font-display text-lg tabular-nums text-card-foreground">
                {entry.score.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-soft">
              <span>{entry.minted !== null ? `+${formatKalien(entry.minted)} KALIEN` : "n/a"}</span>
              <span>{formatMetric(entry.frameCount)} frames</span>
              <span>Seed {formatHex32(entry.seed)}</span>
              <RelativeTime value={entry.completedAt} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              {entry.txHash ? <TxLink txHash={entry.txHash} /> : <span />}
              <ReplayRunButton runId={entry.runId} />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Leaderboard rankings">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Rank</TableHead>
              <TableHead scope="col">Player</TableHead>
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
            {entries.map((entry) => (
              <TableRow
                key={`${entry.playerAddress}:${entry.runId ?? entry.txHash ?? entry.rank}`}
                className={cn(
                  highlightAddress === entry.playerAddress && "!bg-[rgba(16,67,84,0.34)]",
                )}
                data-testid="leaderboard-row"
              >
                <TableCell>
                  <RankBadge rank={entry.rank} />
                </TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <Link
                      href={`/leaderboard/${entry.playerAddress}`}
                      className="text-link no-underline hover:underline"
                    >
                      {displayName(entry)}
                    </Link>
                    {entry.profile?.username?.trim() ? (
                      <code className="text-text-soft">
                        {abbreviateAddress(entry.playerAddress)}
                      </code>
                    ) : null}
                    {entry.profile?.linkUrl && isSafeUrl(entry.profile.linkUrl) ? (
                      <a
                        href={entry.profile.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link no-underline hover:underline"
                      >
                        Link
                      </a>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {entry.score.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMetric(entry.frameCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {entry.minted !== null ? formatKalien(entry.minted) : "n/a"}
                </TableCell>
                <TableCell className="font-display tracking-[0.04em]">
                  {formatHex32(entry.seed)}
                </TableCell>
                <TableCell>
                  <RelativeTime value={entry.completedAt} />
                </TableCell>
                <TableCell>{entry.txHash ? <TxLink txHash={entry.txHash} /> : "n/a"}</TableCell>
                <TableCell>
                  <ReplayRunButton runId={entry.runId} className="px-2" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
