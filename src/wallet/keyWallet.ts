// Local Ed25519 player key, kept in localStorage.
//
// The key is a Thruput pubkey account (nonce 0). The player never pays gas: the
// key only signs claim messages and profile edits, and the Worker relay submits
// the transactions. Anyone with the secret can claim runs as this player, so the
// export flow warns before it shows the secret.

import { derivePubkeyAccountAddress, PrivateKeySigner, toHex0x } from "@thruputchain/client";
import { CryptographicScheme, ed25519PublicKey } from "@thruputchain/protocol";
import { bytesToHex, hexToBytes, isHexOfLength, sha256, strip0x } from "@/lib/hex";

export const WALLET_STORAGE_KEY = "kalien:wallet:v1";
export const BACKUP_PREFIX = "kalien-key-v1";

export interface StoredWallet {
  version: 1;
  /** 32-byte Ed25519 seed, lowercase hex without `0x`. */
  secretKey: string;
  createdAt: string;
}

export interface KeyWallet {
  /** Pubkey account address, `0x`-prefixed lowercase hex. */
  address: string;
  /** Ed25519 public key, lowercase hex without `0x`. */
  pubkeyHex: string;
  createdAt: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface WalletBackupFile {
  format: typeof BACKUP_PREFIX;
  address: string;
  pubkey: string;
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

export function pubkeyAccountAddress(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) {
    throw new Error("pubkey must be 32 bytes");
  }
  return toHex0x(
    derivePubkeyAccountAddress({
      pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(pubkey) },
      nonce: 0n,
    }),
  ).toLowerCase();
}

export function walletFromSecret(secretHex: string, createdAt: string): KeyWallet {
  const secret = hexToBytes(secretHex);
  if (secret.length !== 32) {
    throw new Error("secret key must be 32 bytes");
  }
  const signer = new PrivateKeySigner(secret);
  const pubkey = new Uint8Array(signer.publicKey.ed25519);
  return {
    address: pubkeyAccountAddress(pubkey),
    pubkeyHex: bytesToHex(pubkey),
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
    secretKey: stored.secretKey,
    createdAt: stored.createdAt,
    network: "thruput-devnet",
  };
}

/**
 * Parse a backup the player pasted or uploaded. Accepts the backup string, the
 * JSON backup file, a `kalien` CLI key file, or a bare 32-byte hex secret
 * (with or without `0x`, the `kalien key export` format).
 */
export async function parseBackup(input: string): Promise<StoredWallet> {
  const text = input.trim();
  if (text.length === 0) {
    throw new Error("paste a backup string or choose a backup file");
  }

  let secretHex: string | null = null;
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
    secretHex = parsed.secretKey;
    if (typeof parsed.createdAt === "string") createdAt = parsed.createdAt;
    if (typeof parsed.address === "string") expectedAddress = parsed.address.toLowerCase();
  } else if (text.startsWith(`${BACKUP_PREFIX}:`)) {
    const parts = text.split(":");
    if (parts.length !== 3) {
      throw new Error("backup string has the wrong format");
    }
    secretHex = parts[1] ?? null;
    checksum = (parts[2] ?? "").toLowerCase();
  } else {
    secretHex = text;
  }

  if (!secretHex || !isHexOfLength(secretHex, 32)) {
    throw new Error("backup does not contain a 32-byte secret key");
  }
  const normalized = strip0x(secretHex).toLowerCase();
  if (checksum !== null && checksum !== (await backupChecksum(hexToBytes(normalized)))) {
    throw new Error("backup checksum does not match; check for a typo");
  }
  if (expectedAddress && walletFromSecret(normalized, createdAt).address !== expectedAddress) {
    throw new Error("backup file address does not match its secret key");
  }
  return { version: 1, secretKey: normalized, createdAt };
}
