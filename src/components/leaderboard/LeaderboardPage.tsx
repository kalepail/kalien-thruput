import { PageShell } from "@/components/shared/PageShell";
import { useEffect } from "react";
import { navigate, useLocation } from "@/hooks/useLocation";
import { parseAddressInput } from "@/thruput/ids";
import { LeaderboardListView } from "./LeaderboardListView";
import { LeaderboardPlayerView } from "./LeaderboardPlayerView";

function getPlayerAddressFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "leaderboard") {
    return null;
  }
  return segments[1] ?? null;
}

export function LeaderboardPage() {
  const pathname = useLocation();
  const rawPlayerAddress = getPlayerAddressFromPath(pathname);
  // Old links use hex addresses, and players may paste a C... StrKey: show the
  // canonical base58 URL.
  const playerAddress = rawPlayerAddress
    ? (parseAddressInput(decodeURIComponent(rawPlayerAddress)) ?? rawPlayerAddress)
    : null;

  useEffect(() => {
    if (rawPlayerAddress && playerAddress && playerAddress !== rawPlayerAddress) {
      navigate(`/leaderboard/${playerAddress}`, { replace: true });
    }
  }, [playerAddress, rawPlayerAddress]);

  return (
    <PageShell glow className="content-start">
      {playerAddress ? (
        <LeaderboardPlayerView playerAddress={playerAddress} />
      ) : (
        <LeaderboardListView />
      )}
    </PageShell>
  );
}
