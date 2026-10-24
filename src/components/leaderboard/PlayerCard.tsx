import Link from "lucide-react/dist/esm/icons/link";
import Trophy from "lucide-react/dist/esm/icons/trophy";
import User from "lucide-react/dist/esm/icons/user";
import type { LeaderboardPlayer } from "@/leaderboard/api";
import { abbreviateAddress, formatKalien } from "@/lib/format";
import { isSafeUrl } from "@/lib/validation";
import { Card } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/shared/StatCard";
import { RelativeTime } from "./RelativeTime";
import { AddressLinks } from "@/components/runs/TxLink";

export interface PlayerCardProps {
  player: LeaderboardPlayer;
}

function RankValue({ rank }: { rank: number | null }) {
  if (rank === null) {
    return <span>n/a</span>;
  }
  if (rank <= 3) {
    return (
      <span className="inline-flex items-center gap-1">
        <Trophy className="size-3.5 text-[#ffe08f]" />#{rank}
      </span>
    );
  }
  return <span>#{rank}</span>;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const name = player.profile?.username?.trim() || abbreviateAddress(player.playerAddress);

  return (
    <Card>
      {/* Player name and address */}
      <div className="grid gap-1">
        <h2 className="m-0 flex min-w-0 items-center gap-2 font-display text-[clamp(1.2rem,3vw,1.6rem)] tracking-[0.055em] uppercase [overflow-wrap:anywhere]">
          <User className="size-5 text-primary" />
          {name}
        </h2>
        <p className="m-0">
          <strong className="text-xs uppercase tracking-[0.04em] text-text-dim">Address:</strong>{" "}
          <code className="break-all text-text-soft">{player.playerAddress}</code>{" "}
          <AddressLinks address={player.playerAddress} showPlayerPage={false} className="text-xs" />
        </p>
        {player.profile?.linkUrl && isSafeUrl(player.profile.linkUrl) ? (
          <p className="m-0 flex items-center gap-1.5">
            <Link className="size-3.5 text-text-dim" />
            <a
              href={player.profile.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-link"
            >
              {player.profile.linkUrl}
            </a>
          </p>
        ) : null}
      </div>

      {/* Performance stats */}
      <StatGrid columns={4}>
        <StatCard label="Total Runs" value={player.stats.totalRuns.toLocaleString()} />
        <StatCard label="Best Score" value={player.stats.bestScore.toLocaleString()} />
        <StatCard
          label="Total KALIEN"
          value={player.stats.totalMinted !== null ? formatKalien(player.stats.totalMinted) : "n/a"}
        />
        <StatCard label="Last Played" value={<RelativeTime value={player.stats.lastPlayedAt} />} />
      </StatGrid>

      <p className="m-0 text-sm text-text-soft">
        Leaderboard rank uses each player's single best confirmed run in the selected window. This
        page also shows the recent run history and total KALIEN minted.
      </p>

      {/* Rank badges */}
      <StatGrid columns={3}>
        <StatCard label="10m Rank" value={<RankValue rank={player.ranks.tenMin} />} />
        <StatCard label="24h Rank" value={<RankValue rank={player.ranks.day} />} />
        <StatCard label="All-Time Rank" value={<RankValue rank={player.ranks.all} />} />
      </StatGrid>
    </Card>
  );
}
