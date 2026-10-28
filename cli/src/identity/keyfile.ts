import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  Ed25519Signer,
  createPubkeyAccount,
  derivePubkeyAccountAddress,
  parseSecretSeed,
  pubkeyAccountPreimage,
  secretSeedToStrkey,
  toBase58,
} from "@thruputchain/client";
import { bytesToHex, decodeBytes32, hexToBytes, sha256 } from "./claim";

// Local Ed25519 identity for the CLI. The key file holds a 32-byte seed; the
// player address is the Thruput pubkey account derived from its public key
// (nonce 0, the client default). Thruput identifiers are base58.

export const KEY_FILE_VERSION = 1;

/** Prefix of the browser wallet backup string: `kalien-key-v1:<hex seed>:<hex checksum>`. */
export const BROWSER_BACKUP_PREFIX = "kalien-key-v1";

export interface KeyFile {
  version: number;
  /** 32-byte Ed25519 private key seed, 0x hex (the browser wallet imports this file). */
  secretKey: string;
  /** 32-byte Ed25519 public key, base58. */
  publicKey: string;
  /** Thruput pubkey account address, base58. */
  address: string;
  createdAt: string;
}

export interface Identity {
  path: string;
  signer: Ed25519Signer;
  publicKey: Uint8Array;
  /** Lowercase hex without 0x; the form the Worker API takes in `pubkey=`. */
  publicKeyHex: string;
  publicKeyBase58: string;
  /** Pubkey account address, base58. */
  address: string;
}

export function defaultKeyPath(): string {
  const override = process.env.KALIEN_KEY_FILE?.trim();
  if (override) return resolve(override);
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configHome, "kalien", "key.json");
}

export function identityFromSecret(secret: Uint8Array, path = ""): Identity {
  if (secret.length !== 32) {
    throw new Error(`secret key must be 32 bytes, got ${secret.length}`);
  }
  const signer = Ed25519Signer.fromSeed(new Uint8Array(secret));
  const account = createPubkeyAccount({ signer });
  const publicKey = new Uint8Array(signer.publicKey.ed25519);
  return {
    path,
    signer,
    publicKey,
    publicKeyHex: bytesToHex(publicKey),
    publicKeyBase58: toBase58(publicKey),
    address: toBase58(account.address),
  };
}

/** Thruput pubkey account address (nonce 0, base58) for a 32-byte Ed25519 public key. */
export function addressFromPublicKey(publicKey: Uint8Array | string): string {
  const bytes = typeof publicKey === "string" ? decodeBytes32(publicKey, "public key") : publicKey;
  if (bytes.length !== 32) {
    throw new Error(`public key must be 32 bytes, got ${bytes.length}`);
  }
  type PublicKeyArg = Parameters<typeof pubkeyAccountPreimage>[0];
  const pubkey = {
    scheme: 0, // CryptographicScheme.Ed25519
    ed25519: new Uint8Array(bytes),
  } as unknown as PublicKeyArg;
  return toBase58(derivePubkeyAccountAddress(pubkeyAccountPreimage(pubkey, 0n)));
}

function browserBackupChecksum(secret: Uint8Array): string {
  return bytesToHex(sha256(secret).subarray(0, 4));
}

/**
 * Parse a secret seed in any form a player may hold:
 * - 64 hex chars, optional 0x (`kalien key export`, the CLI key file);
 * - the browser backup string `kalien-key-v1:<hex>:<checksum>`;
 * - base58 or an S StrKey (`thruput keys export`);
 * - a JSON CLI key file or browser backup file (field `secretKey`).
 */
export function parseSecretKey(input: string): Uint8Array {
  const text = input.trim();
  if (text.startsWith("{")) {
    let parsed: { secretKey?: unknown };
    try {
      parsed = JSON.parse(text) as { secretKey?: unknown };
    } catch {
      throw new Error("key JSON is not valid");
    }
    if (typeof parsed.secretKey !== "string") throw new Error("key JSON has no secretKey");
    return parseSecretKey(parsed.secretKey);
  }
  if (text.startsWith(`${BROWSER_BACKUP_PREFIX}:`)) {
    const [, hex = "", checksum = ""] = text.split(":");
    const secret = parseSecretKey(hex);
    if (checksum.toLowerCase() !== browserBackupChecksum(secret)) {
      throw new Error("backup checksum does not match; check for a typo");
    }
    return secret;
  }
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(text)) return hexToBytes(text);
  try {
    return parseSecretSeed(text);
  } catch {
    throw new Error(
      "secret key must be 32 bytes as hex (64 chars), base58, an S StrKey, or a kalien backup",
    );
  }
}

function keyFileBody(secret: Uint8Array, identity: Identity, createdAt: string): string {
  const body: KeyFile = {
    version: KEY_FILE_VERSION,
    secretKey: `0x${bytesToHex(secret)}`,
    publicKey: identity.publicKeyBase58,
    address: identity.address,
    createdAt,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

function writeKeyFile(path: string, secret: Uint8Array): Identity {
  const identity = identityFromSecret(secret, path);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // `wx` refuses to overwrite an existing key file.
  writeFileSync(path, keyFileBody(secret, identity, new Date().toISOString()), {
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(path, 0o600);
  return identity;
}

export function readKeyFile(path: string): Identity {
  const raw = readFileSync(path, "utf-8");
  let parsed: Partial<KeyFile>;
  try {
    parsed = JSON.parse(raw) as Partial<KeyFile>;
  } catch {
    throw new Error(`key file ${path} is not valid JSON`);
  }
  if (typeof parsed.secretKey !== "string") {
    throw new Error(`key file ${path} has no secretKey`);
  }
  const secret = parseSecretKey(parsed.secretKey);
  const identity = identityFromSecret(secret, path);
  if (parsed.address?.startsWith("0x")) {
    // Written before the 2026-10-24 Futurenet upgrade (hex address, old derivation).
    // The secret is unchanged; refresh the reference fields in place.
    const tmp = `${path}.tmp-${process.pid}`;
    const createdAt = parsed.createdAt ?? new Date().toISOString();
    writeFileSync(tmp, keyFileBody(secret, identity, createdAt), { mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } else if (parsed.address && parsed.address !== identity.address) {
    throw new Error(`key file ${path}: stored address does not match the secret key`);
  }
  return identity;
}

/** True when group or other users can read or write the key file. */
export function keyFileIsExposed(path: string): boolean {
  if (process.platform === "win32") return false;
  return (statSync(path).mode & 0o077) !== 0;
}

/** Load the key file, or make a new one on first run. */
export function loadOrCreateIdentity(path = defaultKeyPath()): {
  identity: Identity;
  created: boolean;
} {
  if (existsSync(path)) {
    return { identity: readKeyFile(path), created: false };
  }
  return { identity: writeKeyFile(path, new Uint8Array(randomBytes(32))), created: true };
}

/** Write an imported secret to a new key file. Never overwrites. */
export function importIdentity(path: string, secret: Uint8Array): Identity {
  if (existsSync(path)) {
    throw new Error(`key file ${path} already exists; move it away first`);
  }
  return writeKeyFile(path, secret);
}

export type SecretFormat = "hex" | "base58" | "strkey";

/**
 * Export the secret seed. `hex` (0x) imports into the browser wallet and the CLI;
 * `base58` and `strkey` import into `thruput keys import`.
 */
export function exportSecret(path: string, format: SecretFormat = "hex"): string {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<KeyFile>;
  if (typeof raw.secretKey !== "string") {
    throw new Error(`key file ${path} has no secretKey`);
  }
  const secret = parseSecretKey(raw.secretKey);
  switch (format) {
    case "hex":
      return `0x${bytesToHex(secret)}`;
    case "base58":
      return toBase58(secret);
    case "strkey":
      return secretSeedToStrkey(secret);
  }
}

export function exportSecretHex(path: string): string {
  return exportSecret(path, "hex");
}

export async function signClaim(identity: Identity, message: Uint8Array): Promise<Uint8Array> {
  const signature = await identity.signer.sign(message);
  return new Uint8Array(signature.ed25519);
}
