import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WALLET_STORAGE_KEY,
  clearStoredWallet,
  encodeBackupFile,
  encodeBackupString,
  encodeStrkeySecret,
  generateStoredWallet,
  loadOrCreateStoredWallet,
  parseBackup,
  readStoredWallet,
  walletFromSecret,
  writeStoredWallet,
  type KeyWallet,
  type StoredWallet,
  type WalletBackupFile,
} from "../wallet/keyWallet";

export type WalletAction = "idle" | "restoring" | "importing" | "resetting";

export interface UseWalletReturn {
  /** The active key, or null while it loads. */
  wallet: KeyWallet | null;
  isConnected: boolean;
  isBusy: boolean;
  action: WalletAction;
  error: string | null;
  /** True when the key lives only in memory because storage is blocked. */
  isEphemeral: boolean;
  address: string;
  pubkeyHex: string;
  /** The public key as a Stellar `G...` StrKey (secondary identity). */
  publicKeyStrkey: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  exportBackupString: () => Promise<string>;
  exportBackupFile: () => Promise<WalletBackupFile>;
  exportStrkeySecret: () => string;
  /**
   * Import a backup. A bare 32-byte value (no checksum) is not imported until it is
   * confirmed: the first call returns `confirm` with the address it would give.
   */
  importBackup: (input: string, options?: { confirmRaw?: boolean }) => Promise<ImportResult>;
  resetKey: () => Promise<boolean>;
  clearError: () => void;
}

export type ImportResult =
  | { status: "imported"; address: string }
  | { status: "confirm"; address: string }
  | { status: "error" };

interface WalletState {
  stored: StoredWallet | null;
  ephemeral: boolean;
}

function initialState(): WalletState {
  try {
    return { stored: loadOrCreateStoredWallet(), ephemeral: false };
  } catch {
    // Storage is blocked (private mode, disabled cookies). Keep a key for this tab only.
    return { stored: generateStoredWallet(), ephemeral: true };
  }
}

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({ stored: null, ephemeral: false });
  const [action, setAction] = useState<WalletAction>("restoring");
  const [error, setError] = useState<string | null>(null);

  // Load or make the key on first visit. One tap later is enough to play and submit.
  useEffect(() => {
    const next = initialState();
    setState(next);
    if (next.ephemeral) {
      setError("browser storage is blocked; this key will be lost when the tab closes");
    }
    setAction("idle");
  }, []);

  // Follow key changes made in another tab.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== WALLET_STORAGE_KEY) {
        return;
      }
      const stored = readStoredWallet();
      if (stored) {
        setState({ stored, ephemeral: false });
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const wallet = useMemo(
    () => (state.stored ? walletFromSecret(state.stored.secretKey, state.stored.createdAt) : null),
    [state.stored],
  );

  const sign = useCallback(
    async (message: Uint8Array) => {
      if (!wallet) {
        throw new Error("the player key is not ready yet");
      }
      return wallet.sign(message);
    },
    [wallet],
  );

  const exportBackupString = useCallback(async () => {
    if (!state.stored) {
      throw new Error("the player key is not ready yet");
    }
    return encodeBackupString(state.stored);
  }, [state.stored]);

  const exportBackupFile = useCallback(async () => {
    if (!state.stored) {
      throw new Error("the player key is not ready yet");
    }
    return encodeBackupFile(state.stored);
  }, [state.stored]);

  const exportStrkeySecret = useCallback(() => {
    if (!state.stored) {
      throw new Error("the player key is not ready yet");
    }
    return encodeStrkeySecret(state.stored);
  }, [state.stored]);

  const importBackup = useCallback(
    async (input: string, options?: { confirmRaw?: boolean }): Promise<ImportResult> => {
      setAction("importing");
      setError(null);
      try {
        const parsed = await parseBackup(input, { current: wallet });
        if (!parsed.checked && !options?.confirmRaw) {
          return { status: "confirm", address: parsed.address };
        }
        writeStoredWallet(parsed.stored);
        setState({ stored: parsed.stored, ephemeral: false });
        return { status: "imported", address: parsed.address };
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to import key");
        return { status: "error" };
      } finally {
        setAction("idle");
      }
    },
    [wallet],
  );

  const resetKey = useCallback(async () => {
    setAction("resetting");
    setError(null);
    try {
      clearStoredWallet();
      const stored = generateStoredWallet();
      writeStoredWallet(stored);
      setState({ stored, ephemeral: false });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to make a new key");
      return false;
    } finally {
      setAction("idle");
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    wallet,
    isConnected: wallet !== null,
    isBusy: action !== "idle",
    action,
    error,
    isEphemeral: state.ephemeral,
    address: wallet?.address ?? "",
    pubkeyHex: wallet?.pubkeyHex ?? "",
    publicKeyStrkey: wallet?.publicKeyStrkey ?? "",
    sign,
    exportBackupString,
    exportBackupFile,
    exportStrkeySecret,
    importBackup,
    resetKey,
    clearError,
  };
}
