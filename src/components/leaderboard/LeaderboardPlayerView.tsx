import { useCallback, useEffect, useState } from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import { abbreviateAddress } from "@/lib/format";
import { toNullableTrimmed } from "@/lib/validation";
import {
  getLeaderboardPlayer,
  LeaderboardApiError,
  type LeaderboardPlayer,
  updateLeaderboardProfile,
} from "@/leaderboard/api";
import { Card } from "@/components/ui/card";
import { Table, TableBody } from "@/components/ui/table";
import { SkeletonRows } from "@/components/shared/Skeleton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { Link } from "@/components/shared/Link";
import { PlayerCard } from "./PlayerCard";
import { EditProfile } from "./EditProfile";
import { RecentRunsTable } from "./RecentRunsTable";
import { PageHero } from "@/components/shared/PageHero";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useWalletState } from "@/contexts/WalletContext";

export interface LeaderboardPlayerViewProps {
  playerAddress: string;
}

export function LeaderboardPlayerView({ playerAddress }: LeaderboardPlayerViewProps) {
  useDocumentTitle(`Player ${abbreviateAddress(playerAddress)}`, {
    description: `View player profile, ranking history, and recent confirmed runs for ${abbreviateAddress(playerAddress)} on Kalien.`,
    path: `/leaderboard/${playerAddress}`,
  });
  const wallet = useWalletState();
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerData, setPlayerData] = useState<LeaderboardPlayer | null>(null);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileLinkUrl, setProfileLinkUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);
  const [runsOffset, setRunsOffset] = useState(0);
  const [runsLimit] = useState(25);
  const [runsLoading, setRunsLoading] = useState(false);

  // Fetch player data
  useEffect(() => {
    let cancelled = false;
    const isPageChange = playerData !== null;
    if (isPageChange) {
      setRunsLoading(true);
    } else {
      setPlayerLoading(true);
      setPlayerError(null);
      setProfileSaveError(null);
      setProfileSavedAt(null);
    }

    void (async () => {
      try {
        const response = await getLeaderboardPlayer(playerAddress, {
          runsLimit: runsLimit,
          runsOffset: runsOffset,
        });
        if (cancelled) return;
        setPlayerData(response);
        if (!isPageChange) {
          setProfileUsername(response.profile?.username ?? "");
          setProfileLinkUrl(response.profile?.linkUrl ?? "");
        }
      } catch (reason) {
        if (cancelled) return;
        const detail =
          reason instanceof LeaderboardApiError || reason instanceof Error
            ? reason.message
            : "failed to load player";
        setPlayerError(detail);
      } finally {
        if (!cancelled) {
          setPlayerLoading(false);
          setRunsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerData excluded to avoid loop
  }, [playerAddress, runsOffset, runsLimit]);

  const saveProfile = useCallback(async () => {
    if (!playerData) return;

    const profileAddress = playerData.playerAddress;
    if (wallet.address !== profileAddress) {
      setProfileSavedAt(null);
      setProfileSaveError("only the player key for this address can edit the profile");
      return;
    }

    setSavingProfile(true);
    setProfileSaveError(null);
    setProfileSavedAt(null);

    try {
      const updated = await updateLeaderboardProfile(
        profileAddress,
        {
          username: toNullableTrimmed(profileUsername),
          linkUrl: toNullableTrimmed(profileLinkUrl),
        },
        { pubkeyHex: wallet.pubkeyHex, sign: wallet.sign },
      );

      setPlayerData((current) => {
        if (!current) return current;
        return { ...current, profile: updated.profile };
      });
      setProfileSavedAt(updated.profile.updatedAt);
    } catch (reason: unknown) {
      const detail =
        reason instanceof LeaderboardApiError || reason instanceof Error
          ? reason.message
          : "failed to save profile";
      setProfileSaveError(detail);
    } finally {
      setSavingProfile(false);
    }
  }, [playerData, profileLinkUrl, profileUsername, wallet.address, wallet.pubkeyHex, wallet.sign]);

  return (
    <>
      <PageHero
        title={playerData?.profile?.username?.trim() || abbreviateAddress(playerAddress)}
        subtitle="Profile, rankings, and recent confirmed runs."
      >
        <Link
          className="inline-flex items-center gap-1.5 font-display text-sm uppercase tracking-wider text-link no-underline hover:underline"
          href="/leaderboard"
        >
          <ChevronLeft className="size-4" />
          Back To Leaderboard
        </Link>
      </PageHero>

      {/* Loading state */}
      {playerLoading ? (
        <Card>
          <Table aria-label="Loading player data">
            <TableBody>
              <SkeletonRows count={3} cols={6} />
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <ErrorMessage message={playerError} />

      {playerData ? (
        <>
          <PlayerCard player={playerData} />

          {wallet.address === playerData.playerAddress && (
            <EditProfile
              username={profileUsername}
              linkUrl={profileLinkUrl}
              onUsernameChange={setProfileUsername}
              onLinkUrlChange={setProfileLinkUrl}
              onSave={saveProfile}
              isSaving={savingProfile}
              saveError={profileSaveError}
              savedAt={profileSavedAt}
            />
          )}

          <RecentRunsTable
            runs={playerData.recentRuns}
            pagination={playerData.runsPagination}
            offset={runsOffset}
            onOffsetChange={setRunsOffset}
            isLoading={runsLoading}
            limit={runsLimit}
          />
        </>
      ) : null}
    </>
  );
}
