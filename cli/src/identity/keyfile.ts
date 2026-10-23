import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  PrivateKeySigner,
  createPubkeyAccount,
  derivePubkeyAccountAddress,
  toHex0x,
} from "@thruputchain/client";
import { bytesToHex, hexToBytes } from "./claim";

// Local Ed25519 identity for the CLI. The key file holds a 32-byte seed; the
// player address is the Thruput pubkey account derived from its public key
// (nonce 0, the client default).

export const KEY_FILE_VERSION = 1;

export interface KeyFile {
  version: number;
  /** 32-byte Ed25519 private key seed, 0x hex. */
  secretKey: string;
  /** 32-byte Ed25519 public key, 0x hex. */
  publicKey: string;
  /** Thruput pubkey account address, 0x hex. */
  address: string;
  createdAt: string;
}

export interface Identity {
  path: string;
  signer: PrivateKeySigner;
  publicKey: Uint8Array;
  publicKeyHex: string;
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
  const signer = new PrivateKeySigner(new Uint8Array(secret));
  const account = createPubkeyAccount({ signer });
  const publicKey = new Uint8Array(signer.publicKey.ed25519);
  return {
    path,
    signer,
    publicKey,
    publicKeyHex: bytesToHex(publicKey),
    address: toHex0x(account.address),
  };
}

/** Thruput pubkey account address (nonce 0) for a 32-byte Ed25519 public key. */
export function addressFromPublicKey(publicKey: Uint8Array | string): string {
  const bytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (bytes.length !== 32) {
    throw new Error(`public key must be 32 bytes, got ${bytes.length}`);
  }
  type Preimage = Parameters<typeof derivePubkeyAccountAddress>[0];
  const preimage = {
    pubkey: { scheme: 0, ed25519: new Uint8Array(bytes) }, // CryptographicScheme.Ed25519
    nonce: 0n,
  } as unknown as Preimage;
  return toHex0x(derivePubkeyAccountAddress(preimage));
}

export function parseSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  const bytes = hexToBytes(trimmed);
  if (bytes.length !== 32) {
    throw new Error("secret key must be 32 bytes of hex (64 hex chars, optional 0x prefix)");
  }
  return bytes;
}

function writeKeyFile(path: string, secret: Uint8Array): Identity {
  const identity = identityFromSecret(secret, path);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const body: KeyFile = {
    version: KEY_FILE_VERSION,
    secretKey: `0x${bytesToHex(secret)}`,
    publicKey: `0x${identity.publicKeyHex}`,
    address: identity.address,
    createdAt: new Date().toISOString(),
  };
  // `wx` refuses to overwrite an existing key file.
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: "wx" });
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
  const identity = identityFromSecret(parseSecretKey(parsed.secretKey), path);
  if (parsed.address && parsed.address.toLowerCase() !== identity.address.toLowerCase()) {
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

export function exportSecretHex(path: string): string {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<KeyFile>;
  if (typeof raw.secretKey !== "string") {
    throw new Error(`key file ${path} has no secretKey`);
  }
  return `0x${bytesToHex(parseSecretKey(raw.secretKey))}`;
}

export async function signClaim(identity: Identity, message: Uint8Array): Promise<Uint8Array> {
  const signature = await identity.signer.sign(message);
  return new Uint8Array(signature.ed25519);
}
