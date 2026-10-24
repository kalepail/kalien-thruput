import { useCallback, useEffect, useRef, useState } from "react";
import { BALANCE_REFRESH_MS } from "../consts";
import { formatKalien } from "../lib/format";

export interface UseTokenBalanceReturn {
  balance: bigint | null;
  formattedBalance: string;
  tokenContractId: string | null;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

type ClientModule = typeof import("../thruput/client");

let clientModulePromise: Promise<ClientModule> | null = null;

function loadClientModule(): Promise<ClientModule> {
  if (!clientModulePromise) {
    clientModulePromise = import("../thruput/client");
  }
  return clientModulePromise;
}

export function useTokenBalance(walletAddress: string): UseTokenBalanceReturn {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tokenContractId, setTokenContractId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    if (walletAddress.trim().length === 0) {
      setBalance(null);
      setTokenContractId(null);
      setError(null);
      setIsRefreshing(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const clientModule = await loadClientModule();
      const next = await clientModule.readKalienBalance(walletAddress);
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      setBalance(next.balance);
      setTokenContractId(next.tokenContract);
      setError(null);
    } catch (err) {
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      const detail = err instanceof Error ? err.message : "failed to load token balance";
      // A devnet reset changes the network hash; the pinned client then refuses it.
      setError(
        /network identity|network mismatch/i.test(detail)
          ? "the network changed (devnet reset?); reload the page"
          : detail,
      );
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [walletAddress]);

  // Refresh when the address changes, then poll while the tab is visible.
  useEffect(() => {
    if (walletAddress.trim().length === 0) {
      refreshRequestIdRef.current += 1;
      setBalance(null);
      setTokenContractId(null);
      setError(null);
      setIsRefreshing(false);
      return;
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, BALANCE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [walletAddress, refresh]);

  const formattedBalance = balance === null ? "—" : `${formatKalien(balance)} KALIEN`;

  return {
    balance,
    formattedBalance,
    tokenContractId,
    isRefreshing,
    error,
    refresh,
  };
}
