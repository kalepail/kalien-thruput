import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { verifyAsync as verify } from "@noble/ed25519";
import {
  addressToStrkey,
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
  isPublicValueOf,
  parseBackup,
  pubkeyAccountAddress,
  walletFromSecret,
} from "../../src/wallet/keyWallet";
import { idBytes, isHex32 } from "../../src/thruput/ids";
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
    expect((await parseBackup(backup)).stored.secretKey).toBe(stored.secretKey);
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
    expect(parsed.stored.secretKey).toBe(stored.secretKey);
    expect(parsed.stored.createdAt).toBe(stored.createdAt);
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
    expect((await parseBackup(`0x${stored.secretKey}`)).stored.secretKey).toBe(stored.secretKey);
    const cliKeyFile = {
      version: 1,
      secretKey: `0x${stored.secretKey}`,
      publicKey: `0x${wallet.pubkeyHex}`,
      address: wallet.address,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const parsed = await parseBackup(JSON.stringify(cliKeyFile));
    expect(parsed.stored.secretKey).toBe(stored.secretKey);
    expect(parsed.stored.createdAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("shows the key as a Stellar G StrKey and round-trips the S StrKey secret", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    expect(wallet.publicKeyStrkey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(wallet.publicKeyStrkey).toBe(publicKeyToStrkey(hexToBytes(wallet.pubkeyHex)));
    const strkey = encodeStrkeySecret(stored);
    expect(strkey).toMatch(/^S[A-Z2-7]{55}$/);
    expect(parseSecretSeed(strkey)).toEqual(hexToBytes(stored.secretKey));
    expect((await parseBackup(strkey)).stored.secretKey).toBe(stored.secretKey);
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
    expect((await parseBackup(JSON.stringify(legacy))).stored.secretKey).toBe(stored.secretKey);
  });

  it("rejects input that is not a key", async () => {
    await expect(parseBackup("")).rejects.toThrow();
    await expect(parseBackup("hello!")).rejects.toThrow(/32-byte/);
    await expect(parseBackup('{"foo":1}')).rejects.toThrow(/not a Kalien key backup/);
  });

  it("marks checksummed formats as checked and bare 32-byte values as raw", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    const string = await parseBackup(await encodeBackupString(stored));
    expect(string.checked).toBe(true);
    expect(string.address).toBe(wallet.address);
    expect((await parseBackup(encodeStrkeySecret(stored))).checked).toBe(true);
    expect((await parseBackup(JSON.stringify(await encodeBackupFile(stored)))).checked).toBe(true);
    const rawHex = await parseBackup(stored.secretKey);
    expect(rawHex.checked).toBe(false);
    expect(rawHex.address).toBe(wallet.address);
    expect((await parseBackup(toBase58(hexToBytes(stored.secretKey)))).checked).toBe(false);
  });
});

describe("key import refuses public values (review item 3)", () => {
  const stored = generateStoredWallet();
  const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
  const current = { address: wallet.address, pubkeyHex: wallet.pubkeyHex };
  const addressBytes = idBytes(wallet.address);
  const forms = {
    "address base58": wallet.address,
    "address hex": `0x${bytesToHexLocal(addressBytes)}`,
    "address hex, no 0x": bytesToHexLocal(addressBytes),
    "address C StrKey": addressToStrkey(addressBytes),
    "pubkey hex": wallet.pubkeyHex,
    "pubkey base58": toBase58(hexToBytes(wallet.pubkeyHex)),
    "pubkey G StrKey": wallet.publicKeyStrkey,
  };

  for (const [name, value] of Object.entries(forms)) {
    it(`rejects the current ${name}`, async () => {
      expect(isPublicValueOf(value, [current])).toBe(true);
      await expect(parseBackup(value, { current })).rejects.toThrow(/not a secret key/);
    });
  }

  it("still accepts the real secret of the current key", async () => {
    expect(isPublicValueOf(stored.secretKey, [current])).toBe(false);
    const parsed = await parseBackup(await encodeBackupString(stored), { current });
    expect(parsed.address).toBe(wallet.address);
  });

  it("without a current key, a pasted public value gives an unexpected address and stays raw", async () => {
    const parsed = await parseBackup(wallet.address);
    expect(parsed.checked).toBe(false);
    expect(parsed.address).not.toBe(wallet.address);
  });
});

function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
