import { useState, useRef, useEffect, useCallback } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Coins from "lucide-react/dist/esm/icons/coins";
import Copy from "lucide-react/dist/esm/icons/copy";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import User from "lucide-react/dist/esm/icons/user";
import { cn } from "@/lib/utils";
import { useBalanceState, useWalletState } from "@/contexts/WalletContext";
import { abbreviateAddress } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AddressExplorerLink } from "@/components/runs/TxLink";
import { navigate } from "@/hooks/useLocation";

export function HeaderWallet() {
  const wallet = useWalletState();
  const balance = useBalanceState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const copyTimerRef = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const copyAddress = useCallback(() => {
    void navigator.clipboard.writeText(wallet.address).then(() => {
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
      return undefined;
    });
  }, [wallet.address]);

  // Close dropdown on outside interaction
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  // Close dropdown on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (wallet.action === "restoring") {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span className="hidden text-xs sm:inline">Loading...</span>
      </div>
    );
  }

  if (!wallet.isConnected) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <KeyRound className="size-3.5 text-destructive" aria-hidden="true" />
        <span className="text-xs">{wallet.error ?? "Player key unavailable"}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex max-w-full min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-border/40 bg-surface-dim px-2.5 py-2 text-left transition-colors hover:border-border/60 hover:bg-[rgba(8,16,29,0.8)] sm:gap-2 sm:px-3",
          open && "border-primary/40",
        )}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
      >
        {/* Balance pill */}
        <span className="flex min-w-0 items-center gap-1.5">
          <Coins className="size-3.5 text-secondary" aria-hidden="true" />
          <span className="truncate font-display text-xs tabular-nums tracking-wide text-card-foreground">
            {balance.formattedBalance}
          </span>
        </span>

        <span className="hidden h-4 w-px bg-border/40 xl:block" aria-hidden="true" />

        {/* Address */}
        <span className="hidden items-center gap-1 xl:flex">
          <User className="size-3 text-muted-foreground" aria-hidden="true" />
          <span className="font-display text-xs text-muted-foreground">
            {abbreviateAddress(wallet.address)}
          </span>
        </span>

        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[min(92vw,18rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border/50 bg-[rgba(8,16,29,0.95)] shadow-[0_12px_40px_rgba(0,0,0,0.5)] sm:left-auto sm:right-0 sm:max-w-none">
          {/* Account info with copy */}
          <div className="border-b border-border/30 px-3 py-2.5">
            <p className="m-0 font-display text-[0.65rem] uppercase tracking-[0.06em] text-muted-foreground">
              Account
            </p>
            <button
              onClick={copyAddress}
              className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded bg-transparent p-0 text-left transition-colors hover:text-primary"
              title="Copy address"
              data-testid="header-copy-address"
            >
              <span className="min-w-0 flex-1 text-xs text-card-foreground">
                {abbreviateAddress(wallet.address)}
              </span>
              {copied ? (
                <Check className="size-3 shrink-0 text-secondary" aria-hidden="true" />
              ) : (
                <Copy className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
            <AddressExplorerLink address={wallet.address} className="mt-1 text-[0.7rem]">
              View on explorer
            </AddressExplorerLink>
          </div>

          {/* Balance */}
          <button
            type="button"
            className="w-full cursor-pointer border-b border-border/30 px-3 py-2.5 bg-transparent text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            onClick={() => {
              setOpen(false);
              navigate("/wallet");
            }}
          >
            <p className="m-0 font-display text-[0.65rem] uppercase tracking-[0.06em] text-muted-foreground">
              Balance
            </p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-card-foreground">
              <Coins className="size-3 text-secondary" aria-hidden="true" />
              {balance.formattedBalance}
            </p>
          </button>

          {/* Key backup */}
          <div className="grid gap-1 px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                setOpen(false);
                navigate("/wallet");
              }}
            >
              <KeyRound className="size-3.5" aria-hidden="true" />
              Back Up or Import Key
            </Button>
            {wallet.isEphemeral && (
              <p className="m-0 px-2 text-[0.65rem] text-warning">
                Storage is blocked. Back up this key before you close the tab.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
