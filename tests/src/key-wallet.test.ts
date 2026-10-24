import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { verifyAsync as verify } from "@noble/ed25519";
import {
  createPubkeyAccount,
  Ed25519Signer,
  parseSecretSeed,
  publicKeyToStrkey,
  toBase58,
} from "@thruputchain/client";
import {
  encodeBackupFile,
  encodeBackupString,
  encodeStrkeySecret,
  generateStoredWallet,
  parseBackup,
  pubkeyAccountAddress,
  walletFromSecret,
} from "../../src/wallet/keyWallet";
import { isHex32 } from "../../src/thruput/ids";
import { hexToBytes, strip0x } from "../../src/lib/hex";

const VECTORS_PATH = new URL("../../shared/thruput/claim-vectors.json", import.meta.url);

interface AddressVector {
  secretKey: string;
  pubkey: string;
  address: string;
}

describe("key wallet", () => {
  it("derives the same address as createPubkeyAccount (nonce 0)", () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    const account = createPubkeyAccount({
      signer: Ed25519Signer.fromSeed(hexToBytes(stored.secretKey)),
    });
    expect(wallet.address).toBe(toBase58(account.address));
    expect(isHex32(wallet.address)).toBe(false);
    expect(pubkeyAccountAddress(hexToBytes(wallet.pubkeyHex))).toBe(wallet.address);
  });

  it("signs messages that verify with the public key", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    const message = new Uint8Array(32).fill(9);
    const signature = await wallet.sign(message);
    expect(signature.length).toBe(64);
    expect(await verify(signature, message, hexToBytes(wallet.pubkeyHex))).toBe(true);
    const tampered = message.slice();
    tampered[0] ^= 1;
    expect(await verify(signature, tampered, hexToBytes(wallet.pubkeyHex))).toBe(false);
  });

  it.skipIf(!existsSync(VECTORS_PATH))("matches the shared address vectors", () => {
    const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as {
      addresses: AddressVector[];
    };
    for (const vector of vectors.addresses) {
      // Vectors from before the wire-14 upgrade carry hex addresses from the old
      // derivation; only base58 addresses are checked.
      const checkAddress = !isHex32(vector.address);
      if (checkAddress) {
        expect(pubkeyAccountAddress(hexToBytes(vector.pubkey))).toBe(vector.address);
      }
      if (vector.secretKey) {
        const wallet = walletFromSecret(strip0x(vector.secretKey), "2026-01-01T00:00:00.000Z");
        expect(`0x${wallet.pubkeyHex}`).toBe(vector.pubkey.toLowerCase());
        if (checkAddress) {
          expect(wallet.address).toBe(vector.address);
        }
      }
    }
  });
});

describe("key backup", () => {
  it("round-trips the backup string", async () => {
    const stored = generateStoredWallet();
    const backup = await encodeBackupString(stored);
    expect(backup).toMatch(/^kalien-key-v1:[0-9a-f]{64}:[0-9a-f]{8}$/);
    expect((await parseBackup(backup)).secretKey).toBe(stored.secretKey);
  });

  it("rejects a backup string with a typo", async () => {
    const stored = generateStoredWallet();
    const backup = await encodeBackupString(stored);
    const last = backup.at(-1) === "0" ? "1" : "0";
    await expect(parseBackup(backup.slice(0, -1) + last)).rejects.toThrow(/checksum/);
  });

  it("round-trips the JSON backup file and keeps createdAt", async () => {
    const stored = generateStoredWallet();
    const file = await encodeBackupFile(stored);
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.secretKey).toBe(stored.secretKey);
    expect(parsed.createdAt).toBe(stored.createdAt);
  });

  it("rejects a backup file whose address does not match the secret", async () => {
    const file = await encodeBackupFile(generateStoredWallet());
    const other = walletFromSecret(generateStoredWallet().secretKey, "x");
    await expect(parseBackup(JSON.stringify({ ...file, address: other.address }))).rejects.toThrow(
      /does not match/,
    );
  });

  it("accepts the kalien CLI export (0x hex seed) and key file", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    expect((await parseBackup(`0x${stored.secretKey}`)).secretKey).toBe(stored.secretKey);
    const cliKeyFile = {
      version: 1,
      secretKey: `0x${stored.secretKey}`,
      publicKey: `0x${wallet.pubkeyHex}`,
      address: wallet.address,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const parsed = await parseBackup(JSON.stringify(cliKeyFile));
    expect(parsed.secretKey).toBe(stored.secretKey);
    expect(parsed.createdAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("shows the key as a Stellar G StrKey and round-trips the S StrKey secret", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    expect(wallet.publicKeyStrkey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(wallet.publicKeyStrkey).toBe(publicKeyToStrkey(hexToBytes(wallet.pubkeyHex)));
    const strkey = encodeStrkeySecret(stored);
    expect(strkey).toMatch(/^S[A-Z2-7]{55}$/);
    expect(parseSecretSeed(strkey)).toEqual(hexToBytes(stored.secretKey));
    expect((await parseBackup(strkey)).secretKey).toBe(stored.secretKey);
  });

  it("imports a pre-upgrade backup file that holds a hex address", async () => {
    const stored = generateStoredWallet();
    const legacy = {
      format: "kalien-key-v1",
      address: `0x${"ab".repeat(32)}`,
      pubkey: "00",
      secretKey: stored.secretKey,
      createdAt: "2026-10-23T00:00:00.000Z",
      network: "thruput-devnet",
    };
    expect((await parseBackup(JSON.stringify(legacy))).secretKey).toBe(stored.secretKey);
  });

  it("rejects input that is not a key", async () => {
    await expect(parseBackup("")).rejects.toThrow();
    await expect(parseBackup("hello!")).rejects.toThrow(/32-byte/);
    await expect(parseBackup('{"foo":1}')).rejects.toThrow(/not a Kalien key backup/);
  });
});
