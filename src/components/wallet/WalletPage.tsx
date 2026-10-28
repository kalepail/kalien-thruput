import { useCallback, useEffect, useRef, useState } from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import Check from "lucide-react/dist/esm/icons/check";
import Coins from "lucide-react/dist/esm/icons/coins";
import Copy from "lucide-react/dist/esm/icons/copy";
import Download from "lucide-react/dist/esm/icons/download";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Upload from "lucide-react/dist/esm/icons/upload";
import { useBalanceState, useWalletState } from "@/contexts/WalletContext";
import { PageShell } from "@/components/shared/PageShell";
import { PageHero } from "@/components/shared/PageHero";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { AddressLinks } from "@/components/runs/TxLink";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const sectionTitle =
  "m-0 font-display text-sm tracking-[0.08em] uppercase text-[rgba(176,219,255,0.95)]";
const fieldLabel = "font-display text-[0.7rem] uppercase tracking-[0.06em] text-muted-foreground";

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
      return undefined;
    });
  }, []);
  return [copied, copy];
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-warning/40 bg-[rgba(42,22,15,0.42)] px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function BackupCard() {
  const wallet = useWalletState();
  const [revealed, setRevealed] = useState<{ label: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopied();

  // Hide the secret again when the key changes.
  useEffect(() => {
    setRevealed(null);
  }, [wallet.address]);

  const reveal = useCallback(
    async (kind: "backup" | "stellar") => {
      setError(null);
      try {
        setRevealed(
          kind === "backup"
            ? { label: "Backup string", value: await wallet.exportBackupString() }
            : { label: "Stellar secret key (S...)", value: wallet.exportStrkeySecret() },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to export key");
      }
    },
    [wallet],
  );

  const download = useCallback(async () => {
    setError(null);
    try {
      const file = await wallet.exportBackupFile();
      const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kalien-key-${wallet.address.slice(0, 8)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to export key");
    }
  }, [wallet]);

  return (
    <Card className="animate-rise">
      <div className="grid gap-4 p-4">
        <h2 className={sectionTitle}>Back Up Your Key</h2>
        <p className="m-0 text-sm text-text-soft">
          Your player key lives only in this browser. Back it up to keep your scores and KALIEN if
          you clear browser data or switch devices.
        </p>
        <Warning>
          <p className="m-0">
            The backup is your secret key. Anyone who has it can submit runs as you.
          </p>
          <p className="m-0">Do not share it. Store it somewhere safe.</p>
        </Warning>

        {revealed ? (
          <div className="grid gap-2">
            <label htmlFor="backup-string" className={fieldLabel}>
              {revealed.label}
            </label>
            <textarea
              id="backup-string"
              readOnly
              value={revealed.value}
              rows={3}
              data-testid="backup-string"
              className="w-full resize-none rounded-md border border-border/40 bg-surface-dim px-3 py-2 font-mono text-xs break-all text-card-foreground focus:border-primary/60 focus:outline-none"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="active" size="sm" onClick={() => copy(revealed.value)}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy Backup"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                <EyeOff className="size-3.5" />
                Hide
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="active" size="sm" onClick={() => void reveal("backup")}>
              <Eye className="size-3.5" />
              Show Backup String
            </Button>
            <Button variant="space" size="sm" onClick={() => void download()}>
              <Download className="size-3.5" />
              Download Backup File
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void reveal("stellar")}>
              <Eye className="size-3.5" />
              Show as Stellar Secret
            </Button>
          </div>
        )}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}

function ImportCard() {
  const wallet = useWalletState();
  const [input, setInput] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [imported, setImported] = useState(false);
  // Address a raw 32-byte key would give; set until the player confirms or edits the input.
  const [rawAddress, setRawAddress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setInput((await file.text()).trim());
    setImported(false);
    setRawAddress(null);
  }, []);

  const onImport = useCallback(
    async (confirmRaw: boolean) => {
      setImported(false);
      const result = await wallet.importBackup(input, { confirmRaw });
      if (result.status === "confirm") {
        setRawAddress(result.address);
        return;
      }
      setRawAddress(null);
      if (result.status === "imported") {
        setImported(true);
        setInput("");
        setConfirmed(false);
      }
    },
    [input, wallet],
  );

  const busy = wallet.action === "importing";

  return (
    <Card className="animate-rise">
      <form
        className="grid gap-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onImport(false);
        }}
      >
        <h2 className={sectionTitle}>Import a Key</h2>
        <p className="m-0 text-sm text-text-soft">
          Paste the backup string or the Stellar S... secret, or choose a backup file from another
          browser.
        </p>
        <Warning>
          <p className="m-0">
            Importing replaces the key in this browser. Back up the current key first if it has
            scores or KALIEN you want to keep.
          </p>
        </Warning>
        <div className="grid gap-1.5">
          <label htmlFor="import-backup" className={fieldLabel}>
            Backup
          </label>
          <textarea
            id="import-backup"
            value={input}
            rows={3}
            placeholder="kalien-key-v1:... or S..."
            data-testid="import-backup"
            onChange={(event) => {
              setInput(event.target.value);
              setImported(false);
              setRawAddress(null);
            }}
            disabled={busy}
            className="w-full resize-none rounded-md border border-border/40 bg-surface-dim px-3 py-2 font-mono text-xs break-all text-card-foreground focus:border-primary/60 focus:outline-none disabled:opacity-50"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="hidden"
            data-testid="import-file"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-text-soft">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
            data-testid="import-confirm"
          />
          I backed up my current key, or I do not need it.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="active"
            size="sm"
            disabled={busy || !confirmed || input.trim().length === 0}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            Import Key
          </Button>
          <Button
            type="button"
            variant="space"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload className="size-3.5" />
            Choose File
          </Button>
        </div>
        {rawAddress ? (
          <div
            className="grid gap-2 rounded-lg border border-warning/40 bg-[rgba(42,22,15,0.42)] p-3"
            data-testid="import-raw-confirm"
          >
            <p className="m-0 text-sm text-warning">
              This is a bare 32-byte key with no checksum. It gives this address:
            </p>
            <code className="font-mono text-xs break-all text-card-foreground">{rawAddress}</code>
            <p className="m-0 text-xs text-text-soft">
              Import only if this is the address you expect. If it is not, you pasted an address or
              public key, not a secret key.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="active"
                size="sm"
                onClick={() => void onImport(true)}
                disabled={busy || !confirmed}
              >
                <KeyRound className="size-3.5" />
                Import This Key
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRawAddress(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {imported && <p className="m-0 text-sm text-secondary">Key imported.</p>}
        <ErrorMessage message={wallet.action === "idle" ? wallet.error : null} />
      </form>
    </Card>
  );
}

export function WalletPage() {
  useDocumentTitle("Wallet", {
    description: "Your Kalien player key, KALIEN balance, and key backup.",
    path: "/wallet",
  });

  const wallet = useWalletState();
  const balance = useBalanceState();
  const [copied, copy] = useCopied();
  const [copiedStrkey, copyStrkey] = useCopied();

  return (
    <PageShell glow className="content-start">
      <PageHero title="Wallet" subtitle="Your player key and KALIEN on Thruput Futurenet." />

      {!wallet.isConnected && (
        <Card className="animate-rise">
          <p className="m-0 text-center text-muted-foreground">
            {wallet.action === "restoring" ? "Loading your player key…" : wallet.error}
          </p>
        </Card>
      )}

      {wallet.isConnected && (
        <div className="grid gap-4">
          <Card className="animate-rise">
            <div className="grid gap-3 p-4">
              <div>
                <p className={fieldLabel}>Address</p>
                <button
                  onClick={() => copy(wallet.address)}
                  className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded bg-transparent p-0 text-left transition-colors hover:text-primary"
                  title="Copy address"
                >
                  <span
                    className="min-w-0 flex-1 font-mono text-sm break-all text-card-foreground"
                    data-testid="wallet-address"
                  >
                    {wallet.address}
                  </span>
                  {copied ? (
                    <Check className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  <AddressLinks address={wallet.address} />
                </div>
              </div>
              <div>
                <p className={fieldLabel}>Stellar public key</p>
                <button
                  onClick={() => copyStrkey(wallet.publicKeyStrkey)}
                  className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded bg-transparent p-0 text-left transition-colors hover:text-primary"
                  title="Copy Stellar public key"
                >
                  <span
                    className="min-w-0 flex-1 font-mono text-xs break-all text-text-soft"
                    data-testid="wallet-strkey"
                  >
                    {wallet.publicKeyStrkey}
                  </span>
                  {copiedStrkey ? (
                    <Check className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
                <p className="m-0 mt-0.5 text-xs text-text-dim">
                  The same Ed25519 key in Stellar G... form. Your Thruput address above is derived
                  from it.
                </p>
              </div>
              <div className="grid gap-1">
                <p className={fieldLabel}>Balance</p>
                <div className="flex items-center gap-2">
                  <p
                    className="m-0 flex items-center gap-1.5 font-display text-lg tracking-wide text-card-foreground"
                    data-testid="wallet-balance"
                  >
                    <Coins className="size-4 text-secondary" aria-hidden="true" />
                    {balance.formattedBalance}
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void balance.refresh()}
                    disabled={balance.isRefreshing}
                    aria-label="Refresh balance"
                  >
                    <RefreshCw
                      className={balance.isRefreshing ? "size-3 animate-spin" : "size-3"}
                    />
                  </Button>
                </div>
                <ErrorMessage message={balance.error} severity="warning" className="text-xs" />
              </div>
              <p className="m-0 text-xs text-text-soft">
                You earn KALIEN when you beat your best score on a seed. A relay pays the network
                costs, so you never need HOG.
              </p>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BackupCard />
            <ImportCard />
          </div>
        </div>
      )}
    </PageShell>
  );
}
