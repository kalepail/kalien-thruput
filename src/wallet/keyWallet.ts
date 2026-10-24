// Local Ed25519 player key, kept in localStorage.
//
// The key is a Thruput pubkey account (nonce 0). The player never pays gas: the
// key only signs claim messages and profile edits, and the Worker relay submits
// the transactions. Anyone with the secret can claim runs as this player, so the
// export flow warns before it shows the secret.

import {
  derivePubkeyAccountAddress,
  Ed25519Signer,
  parseAddress,
  parsePublicKey,
  parseSecretSeed,
  pubkeyAccountPreimage,
  publicKeyToStrkey,
  secretSeedToStrkey,
  toBase58,
} from "@thruputchain/client";
import { CryptographicScheme, ed25519PublicKey } from "@thruputchain/protocol";
import { bytesToHex, hexToBytes, isHexOfLength, sha256, strip0x } from "@/lib/hex";
import { idBytes, isHex32 } from "@/thruput/ids";

export const WALLET_STORAGE_KEY = "kalien:wallet:v1";
export const BACKUP_PREFIX = "kalien-key-v1";

export interface StoredWallet {
  version: 1;
  /** 32-byte Ed25519 seed, lowercase hex without `0x`. */
  secretKey: string;
  createdAt: string;
}

export interface KeyWallet {
  /** Pubkey account address (nonce 0), base58. */
  address: string;
  /** Ed25519 public key, lowercase hex without `0x` (the runs API format). */
  pubkeyHex: string;
  /** The same public key as a Stellar `G...` StrKey; Stellar users know this form. */
  publicKeyStrkey: string;
  createdAt: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface WalletBackupFile {
  format: typeof BACKUP_PREFIX;
  address: string;
  pubkey: string;
  /** The public key as a Stellar `G...` StrKey. */
  stellarPublicKey: string;
  secretKey: string;
  createdAt: string;
  network: "thruput-devnet";
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Base58 address of the nonce-0 Ed25519 pubkey account for `pubkey`. */
export function pubkeyAccountAddress(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) {
    throw new Error("pubkey must be 32 bytes");
  }
  return toBase58(
    derivePubkeyAccountAddress(
      pubkeyAccountPreimage(
        { scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(pubkey) },
        0n,
      ),
    ),
  );
}

export function walletFromSecret(secretHex: string, createdAt: string): KeyWallet {
  const secret = hexToBytes(secretHex);
  if (secret.length !== 32) {
    throw new Error("secret key must be 32 bytes");
  }
  const signer = Ed25519Signer.fromSeed(secret);
  const pubkey = new Uint8Array(signer.publicKey.ed25519);
  return {
    address: pubkeyAccountAddress(pubkey),
    pubkeyHex: bytesToHex(pubkey),
    publicKeyStrkey: publicKeyToStrkey(pubkey),
    createdAt,
    sign: async (message) => {
      const signature = await signer.sign(message);
      return new Uint8Array(signature.ed25519);
    },
  };
}

export function readStoredWallet(): StoredWallet | null {
  const raw = storage()?.getItem(WALLET_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredWallet>;
    if (
      parsed.version !== 1 ||
      typeof parsed.secretKey !== "string" ||
      !isHexOfLength(parsed.secretKey, 32)
    ) {
      return null;
    }
    return {
      version: 1,
      secretKey: strip0x(parsed.secretKey).toLowerCase(),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeStoredWallet(wallet: StoredWallet): void {
  const store = storage();
  if (!store) {
    throw new Error("browser storage is not available; the key cannot be saved");
  }
  store.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
}

export function clearStoredWallet(): void {
  storage()?.removeItem(WALLET_STORAGE_KEY);
}

export function generateStoredWallet(): StoredWallet {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return { version: 1, secretKey: bytesToHex(secret), createdAt: new Date().toISOString() };
}

/** Load the saved key, or make and save a new one. */
export function loadOrCreateStoredWallet(): StoredWallet {
  const existing = readStoredWallet();
  if (existing) {
    return existing;
  }
  const created = generateStoredWallet();
  writeStoredWallet(created);
  return created;
}

async function backupChecksum(secret: Uint8Array): Promise<string> {
  return bytesToHex((await sha256(secret)).subarray(0, 4));
}

/** Backup string: `kalien-key-v1:<64 hex secret>:<8 hex checksum>`. */
export async function encodeBackupString(stored: StoredWallet): Promise<string> {
  const secret = hexToBytes(stored.secretKey);
  return `${BACKUP_PREFIX}:${stored.secretKey}:${await backupChecksum(secret)}`;
}

export async function encodeBackupFile(stored: StoredWallet): Promise<WalletBackupFile> {
  const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
  return {
    format: BACKUP_PREFIX,
    address: wallet.address,
    pubkey: wallet.pubkeyHex,
    stellarPublicKey: wallet.publicKeyStrkey,
    secretKey: stored.secretKey,
    createdAt: stored.createdAt,
    network: "thruput-devnet",
  };
}

/** The secret as a Stellar `S...` StrKey. Stellar wallets import this form. Treat it as secret. */
export function encodeStrkeySecret(stored: StoredWallet): string {
  return secretSeedToStrkey(hexToBytes(stored.secretKey));
}

/** Decode a 32-byte seed from hex (with or without `0x`), base58, or an `S...` StrKey. */
function decodeSecret(text: string): string {
  const trimmed = text.trim();
  if (isHexOfLength(trimmed, 32)) {
    return strip0x(trimmed).toLowerCase();
  }
  let seed: Uint8Array;
  try {
    seed = parseSecretSeed(trimmed);
  } catch {
    throw new Error("backup does not contain a 32-byte secret key");
  }
  const hex = bytesToHex(seed);
  seed.fill(0);
  return hex;
}

/** A bare 32-byte value: hex or base58, with no checksum to tell a secret from a public value. */
function isRawSeedText(text: string): boolean {
  return isHexOfLength(text, 32) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(text);
}

/** Every 32-byte value a public identifier text can stand for (hex, base58, G / C StrKey). */
function publicValueBytes(text: string): string[] {
  const trimmed = text.trim();
  const out: string[] = [];
  const attempts = [
    () => idBytes(trimmed),
    () => parsePublicKey(trimmed),
    () => parseAddress(trimmed),
  ];
  for (const attempt of attempts) {
    try {
      out.push(bytesToHex(attempt()));
    } catch {
      // Not this form.
    }
  }
  return out;
}

export const PUBLIC_VALUE_ERROR =
  "this is an address or public key, not a secret key. Paste the backup string, the S... secret, or the backup file";

export interface PublicIdentity {
  address: string;
  pubkeyHex: string;
}

/**
 * True when the input names one of these identities' public values (the
 * address or the public key, in any format). Those values are on the
 * leaderboard; importing one as a seed would give a key anyone can use.
 */
export function isPublicValueOf(input: string, identities: readonly PublicIdentity[]): boolean {
  const candidates = new Set(publicValueBytes(input));
  if (candidates.size === 0) return false;
  for (const identity of identities) {
    const known = [bytesToHex(idBytes(identity.address)), identity.pubkeyHex.toLowerCase()];
    if (known.some((value) => candidates.has(value))) return true;
  }
  return false;
}

export interface ParsedBackup {
  stored: StoredWallet;
  /** Base58 address of the imported key. */
  address: string;
  /**
   * False for a bare 32-byte value (hex or base58) with no checksum. The UI shows
   * the resulting address and asks the player to confirm before it imports.
   */
  checked: boolean;
}

/**
 * Parse a backup the player pasted or uploaded. Accepts the backup string, the
 * JSON backup file, a `kalien` CLI key file, a bare 32-byte seed as hex (with
 * or without `0x`) or base58, and a Stellar `S...` StrKey secret.
 */
export async function parseBackup(
  input: string,
  options: { current?: PublicIdentity | null } = {},
): Promise<ParsedBackup> {
  const text = input.trim();
  if (text.length === 0) {
    throw new Error("paste a backup string or choose a backup file");
  }
  if (options.current && isPublicValueOf(text, [options.current])) {
    throw new Error(PUBLIC_VALUE_ERROR);
  }
  let checked = true;

  let secretText: string | null = null;
  let checksum: string | null = null;
  let createdAt = new Date().toISOString();
  let expectedAddress: string | null = null;

  if (text.startsWith("{")) {
    let parsed: Partial<WalletBackupFile> & { version?: unknown };
    try {
      parsed = JSON.parse(text) as Partial<WalletBackupFile> & { version?: unknown };
    } catch {
      throw new Error("backup file is not valid JSON");
    }
    // Browser backup files carry `format`; `kalien` CLI key files carry `version`.
    const isKnownFormat = parsed.format === BACKUP_PREFIX || parsed.version !== undefined;
    if (!isKnownFormat || typeof parsed.secretKey !== "string") {
      throw new Error("backup file is not a Kalien key backup");
    }
    secretText = parsed.secretKey;
    if (typeof parsed.createdAt === "string") createdAt = parsed.createdAt;
    // Files from before the 2026-10-24 devnet upgrade hold a hex address from the
    // old derivation. The secret is still valid; only base58 addresses are checked.
    if (typeof parsed.address === "string" && !isHex32(parsed.address)) {
      expectedAddress = parsed.address.trim();
    }
  } else if (text.startsWith(`${BACKUP_PREFIX}:`)) {
    const parts = text.split(":");
    if (parts.length !== 3) {
      throw new Error("backup string has the wrong format");
    }
    secretText = parts[1] ?? "";
    checksum = (parts[2] ?? "").toLowerCase();
    if (!isHexOfLength(secretText, 32)) {
      throw new Error("backup does not contain a 32-byte secret key");
    }
  } else {
    secretText = text;
    checked = !isRawSeedText(text);
  }

  const normalized = decodeSecret(secretText);
  if (checksum !== null && checksum !== (await backupChecksum(hexToBytes(normalized)))) {
    throw new Error("backup checksum does not match; check for a typo");
  }
  const wallet = walletFromSecret(normalized, createdAt);
  if (expectedAddress && wallet.address !== expectedAddress) {
    throw new Error("backup file address does not match its secret key");
  }
  // A seed equal to its own public key or address is a pasted public value.
  if (isPublicValueOf(normalized, [wallet])) {
    throw new Error(PUBLIC_VALUE_ERROR);
  }
  return {
    stored: { version: 1, secretKey: normalized, createdAt },
    address: wallet.address,
    checked,
  };
}
