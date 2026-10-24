import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { useThruputConfig } from "@/hooks/useThruputConfig";
import { explorerAddressUrl, explorerTxUrl } from "@/thruput/config";
import { DEFAULT_EXPLORER_URL } from "@/consts";
import { abbreviateHex } from "@/lib/format";
import { canonicalIdOr } from "@/thruput/ids";
import { cn } from "@/lib/utils";

/** Explorer link for a transaction hash. */
export function TxLink({ txHash, className }: { txHash: string; className?: string }) {
  const { config } = useThruputConfig();
  const href = explorerTxUrl(config?.explorerUrl ?? DEFAULT_EXPLORER_URL, txHash);
  const display = canonicalIdOr(txHash);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 break-all text-link", className)}
      title={display}
    >
      <code>{abbreviateHex(display, 8)}</code>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** Explorer link for an account or contract address. */
export function AddressExplorerLink({
  address,
  className,
  children,
}: {
  address: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { config } = useThruputConfig();
  const href = explorerAddressUrl(config?.explorerUrl ?? DEFAULT_EXPLORER_URL, address);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 text-link", className)}
    >
      {children ?? "Explorer"}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}
