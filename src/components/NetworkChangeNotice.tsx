import { useEffect, useState } from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import { onThruputConfigChange, refreshThruputConfig } from "@/thruput/config";

/** How often an open, visible tab checks `/api/config` for a Futurenet reset. */
const CHECK_INTERVAL_MS = 5 * 60_000;
/** Focus and visibility changes check again, but not more often than this. */
const MIN_CHECK_GAP_MS = 30_000;

/**
 * Watches for a Futurenet reset (new network hash or contracts) while the tab is
 * open. The config store then swaps the client, seed and balance; this banner
 * tells the player why their old scores and KALIEN are gone.
 */
export function NetworkChangeNotice() {
  const [changed, setChanged] = useState(false);

  useEffect(() => onThruputConfigChange(() => setChanged(true)), []);

  useEffect(() => {
    let lastCheck = Date.now();
    const check = (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
      lastCheck = Date.now();
      // A failed check is retried at the next interval or focus.
      void refreshThruputConfig().catch(() => undefined);
    };
    const onFocus = () => check(false);
    const interval = window.setInterval(() => check(true), CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!changed) return null;

  return (
    <div
      role="status"
      data-testid="network-change-notice"
      className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-[1240px] items-start gap-2 rounded-lg border border-warning/40 bg-[rgba(42,22,15,0.6)] px-3 py-2 text-sm text-warning"
    >
      <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="m-0 flex-1">
        The Thruput Futurenet was reset. Kalien switched to the new network. Scores and KALIEN from
        before the reset are gone; your player key still works.
      </p>
      <button
        type="button"
        onClick={() => setChanged(false)}
        className="cursor-pointer rounded bg-transparent p-0.5 text-warning hover:text-card-foreground"
        aria-label="Dismiss notice"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
