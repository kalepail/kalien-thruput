import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { Link } from "@/components/shared/Link";
import { useThruputConfig } from "@/hooks/useThruputConfig";
import { explorerAddressUrl, explorerTxUrl } from "@/thruput/config";
import { DEFAULT_EXPLORER_URL } from "@/consts";
import { abbreviateHex } from "@/lib/format";
import { canonicalIdOr } from "@/thruput/ids";
import { cn } from "@/lib/utils";

// Links open our own pages first (`/tx/:hash`, the player page), which show the Kalien
// run details, and keep the public explorer as a small second link.

/** Link to the in-app transaction page, plus a small explorer icon link. */
export function TxLink({ txHash, className }: { txHash: string; className?: string }) {
  const { config } = useThruputConfig();
  const display = canonicalIdOr(txHash);
  const explorerHref = explorerTxUrl(config?.explorerUrl ?? DEFAULT_EXPLORER_URL, display);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Link
        href={`/tx/${display}`}
        className="break-all text-link no-underline hover:underline"
        title={display}
      >
        <code>{abbreviateHex(display, 8)}</code>
      </Link>
      <a
        href={explorerHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex text-text-dim hover:text-link"
        title="Open in the Thruput explorer"
        aria-label="Open in the Thruput explorer"
      >
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
    </span>
  );
}

/** Player page link (optional) and a secondary explorer link for an address. */
export function AddressLinks({
  address,
  showPlayerPage = true,
  className,
}: {
  address: string;
  showPlayerPage?: boolean;
  className?: string;
}) {
  const { config } = useThruputConfig();
  const display = canonicalIdOr(address);
  const explorerHref = explorerAddressUrl(config?.explorerUrl ?? DEFAULT_EXPLORER_URL, display);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {showPlayerPage ? (
        <Link href={`/leaderboard/${display}`} className="text-link">
          Player page
        </Link>
      ) : null}
      <a
        href={explorerHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-text-dim hover:text-link"
      >
        Explorer
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
    </span>
  );
}
