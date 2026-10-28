import { describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fromBase58, toBase58 } from "@thruputchain/client";
import {
  bytesToHex,
  claimMessage,
  claimMessageFromTapeHash,
  decodeBytes32,
  hexToBytes,
  sha256,
} from "./claim";
import {
  addressFromPublicKey,
  exportSecret,
  exportSecretHex,
  parseSecretKey,
  identityFromSecret,
  importIdentity,
  loadOrCreateIdentity,
  readKeyFile,
  signClaim,
} from "./keyfile";

const repoRoot = resolve(import.meta.dir, "../../..");
const shortTape = new Uint8Array(readFileSync(join(repoRoot, "test-fixtures/test-short.tape")));

// RFC 8032 section 7.1, test 1. Public test key, not a secret.
const RFC_SECRET = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC_EMPTY_SIG =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
// From `thruput keys import` + `keys ls --json` (thruput 0.36.0, Futurenet wire 14) for RFC_SECRET.
const RFC_PUBLIC_B58 = "FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z";
const RFC_PUBLIC_KEY_HASH_B58 = "9xarfCYUWxzeV2RSX5B9h6fZK4CoR2WfVvBf2rfvc1yB";
const RFC_ADDRESS = "D4E11uoczkwDh6eUMTXs29SrALae4yn6g8xYQtP1bDiQ";

function toB58(bytes: Uint8Array): string {
  return toBase58(bytes);
}

describe("claimMessage", () => {
  // Expected digests computed independently with Python hashlib.
  test("matches the plan layout for a fixture tape", () => {
    const msg = claimMessage({
      networkHash: `0x${"11".repeat(32)}`,
      scoreContract: "22".repeat(32),
      seedId: 0x01020304,
      tape: shortTape,
    });
    expect(bytesToHex(msg)).toBe(
      "32a1906ffbcc657d3f07bdf2e5a73a778e2a2a5068b0d37097a32e33e1c52f30",
    );
  });

  test("matches the all-zero vector", () => {
    const msg = claimMessage({
      networkHash: new Uint8Array(32),
      scoreContract: new Uint8Array(32),
      seedId: 0,
      tape: new Uint8Array(0),
    });
    expect(bytesToHex(msg)).toBe(
      "132544dc35351a1be51ea52b1a227ab1051d7dabb9a0f847935c2d75803bc0d4",
    );
  });

  test("rejects bad inputs", () => {
    const base = {
      networkHash: new Uint8Array(32),
      scoreContract: new Uint8Array(32),
      seedId: 1,
      tape: shortTape,
    };
    expect(() => claimMessage({ ...base, networkHash: new Uint8Array(31) })).toThrow();
    expect(() => claimMessage({ ...base, scoreContract: "0x1234" })).toThrow();
    expect(() => claimMessage({ ...base, seedId: -1 })).toThrow();
    expect(() => claimMessage({ ...base, seedId: 2 ** 32 })).toThrow();
    expect(() => hexToBytes("0xzz")).toThrow();
  });

  // Cross-check against the shared helper (owned by the contract agent) once it lands.
  const sharedPath = join(repoRoot, "shared/thruput/claim.ts");
  test.skipIf(!existsSync(sharedPath))(
    "matches shared/thruput/claim.ts byte for byte",
    async () => {
      const shared = (await import(sharedPath)) as {
        claimMessage: (input: {
          networkHash: string;
          scoreContract: string;
          seedId: number;
          tape: Uint8Array;
        }) => Uint8Array;
      };
      for (const seedId of [0, 1, 0x01020304, 0xffffffff]) {
        const input = {
          networkHash: `0x${"ab".repeat(32)}`,
          scoreContract: `0x${"cd".repeat(32)}`,
          seedId,
          tape: shortTape,
        };
        expect(bytesToHex(shared.claimMessage(input))).toBe(bytesToHex(claimMessage(input)));
      }
    },
  );
});

describe("identity", () => {
  test("derives the RFC 8032 public key and the thruput CLI address", () => {
    const id = identityFromSecret(hexToBytes(RFC_SECRET));
    expect(id.publicKeyHex).toBe(RFC_PUBLIC);
    expect(id.publicKeyBase58).toBe(RFC_PUBLIC_B58);
    expect(id.address).toBe(RFC_ADDRESS);
    expect(addressFromPublicKey(RFC_PUBLIC)).toBe(RFC_ADDRESS);
    expect(addressFromPublicKey(RFC_PUBLIC_B58)).toBe(RFC_ADDRESS);
  });

  test("address byte layout (wire 14): the account names its key by hash", () => {
    const enc = new TextEncoder();
    // publicKeyHash = sha256(cxs DomainSeparator "PublicKey" || cxs PublicKey{Ed25519 (0x00), pk})
    const pkHash = sha256(
      new Uint8Array([0x00, 0x09, ...enc.encode("PublicKey"), 0x00, ...hexToBytes(RFC_PUBLIC)]),
    );
    expect(pkHash).toEqual(decodeBytes32(RFC_PUBLIC_KEY_HASH_B58));
    // address = sha256(cxs DomainSeparator "PubkeyAccount" || pubkey_hash || nonce 0x00)
    const address = sha256(
      new Uint8Array([0x00, 0x0d, ...enc.encode("PubkeyAccount"), ...pkHash, 0x00]),
    );
    expect(address).toEqual(decodeBytes32(RFC_ADDRESS));
  });

  test("decodeBytes32 takes base58 and hex for the same bytes", () => {
    expect(decodeBytes32(RFC_PUBLIC_B58)).toEqual(hexToBytes(RFC_PUBLIC));
    expect(decodeBytes32(`0x${RFC_PUBLIC}`)).toEqual(hexToBytes(RFC_PUBLIC));
    expect(() => decodeBytes32("not-an-id")).toThrow();
  });

  test("claimMessage gives the same digest for base58 and hex identifiers", () => {
    const network = new Uint8Array(32).fill(3);
    const contract = new Uint8Array(32).fill(4);
    const a = claimMessage({
      networkHash: network,
      scoreContract: contract,
      seedId: 9,
      tape: shortTape,
    });
    const b = claimMessage({
      networkHash: toB58(network),
      scoreContract: toB58(contract),
      seedId: 9,
      tape: shortTape,
    });
    expect(bytesToHex(b)).toBe(bytesToHex(a));
  });

  test("signs raw messages per RFC 8032", async () => {
    const id = identityFromSecret(hexToBytes(RFC_SECRET));
    expect(bytesToHex(await signClaim(id, new Uint8Array(0)))).toBe(RFC_EMPTY_SIG);
  });

  test("claim signatures verify with node:crypto", async () => {
    const id = identityFromSecret(hexToBytes(RFC_SECRET));
    const msg = claimMessage({
      networkHash: new Uint8Array(32).fill(7),
      scoreContract: new Uint8Array(32).fill(9),
      seedId: 42,
      tape: shortTape,
    });
    const sig = await signClaim(id, msg);
    expect(sig.length).toBe(64);
    // SPKI DER prefix for a raw Ed25519 public key.
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(id.publicKey),
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(verify(null, msg, key, sig)).toBe(true);
    msg[0] ^= 1;
    expect(verify(null, msg, key, sig)).toBe(false);
  });
});

// Vectors published by the contract agent (shared/thruput/claim-vectors.json).
// They pin the CLI, the shared TS helper, and the contract's claim.rs together.
interface AddressVector {
  secretKey: string;
  pubkey: string;
  /** Wire 14: sha256(DomainSeparator "PublicKey" || cxs PublicKey). */
  pubkeyHash?: string;
  address: string;
}
interface ClaimVector {
  tape: string; // file name in kalien-contract/fixtures/
  networkHash: string;
  networkHashHex?: string;
  scoreContract: string;
  scoreContractHex?: string;
  seedId: number;
  tapeHash: string;
  digest: string;
  secretKey: string;
  pubkey: string;
  signature: string;
}
const vectorsPath = join(repoRoot, "shared/thruput/claim-vectors.json");
const vectors = existsSync(vectorsPath)
  ? (JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
      addresses: AddressVector[];
      claims: ClaimVector[];
    })
  : { addresses: [], claims: [] };
/** Vector values are hex (0x) before the wire-14 migration and may be base58 after it. */
const bytesOf = (text: string): Uint8Array =>
  /^0x[0-9a-fA-F]*$/.test(text) || /^[0-9a-f]+$/.test(text)
    ? hexToBytes(text)
    : fromBase58(text, 64);

describe.skipIf(!existsSync(vectorsPath))("shared/thruput/claim-vectors.json", () => {
  test("has address and claim vectors", () => {
    expect(vectors.addresses.length).toBeGreaterThan(0);
    expect(vectors.claims.length).toBeGreaterThan(0);
  });

  test("pubkeys and pubkey account addresses match", () => {
    for (const v of vectors.addresses) {
      // A 0x address is a pre-upgrade vector (old derivation); only check the key then.
      const legacy = v.address.startsWith("0x");
      if (!legacy)
        expect(decodeBytes32(addressFromPublicKey(v.pubkey))).toEqual(bytesOf(v.address));
      if (v.pubkeyHash) {
        const enc = new TextEncoder();
        const pkHash = sha256(
          new Uint8Array([0x00, 0x09, ...enc.encode("PublicKey"), 0x00, ...bytesOf(v.pubkey)]),
        );
        expect(pkHash).toEqual(bytesOf(v.pubkeyHash));
      }
      if (v.secretKey) {
        const id = identityFromSecret(bytesOf(v.secretKey));
        expect(id.publicKey).toEqual(bytesOf(v.pubkey));
        if (!legacy) expect(id.address).toBe(addressFromPublicKey(v.pubkey));
      }
    }
  });

  test("claim digests and signatures match", async () => {
    for (const v of vectors.claims) {
      const tape = new Uint8Array(readFileSync(join(repoRoot, "kalien-contract/fixtures", v.tape)));
      expect(sha256(tape)).toEqual(bytesOf(v.tapeHash));
      const digest = claimMessage({
        networkHash: v.networkHash,
        scoreContract: v.scoreContract,
        seedId: v.seedId,
        tape,
      });
      expect(digest).toEqual(bytesOf(v.digest));
      if (v.networkHashHex && v.scoreContractHex) {
        const fromHex = claimMessage({
          networkHash: v.networkHashHex,
          scoreContract: v.scoreContractHex,
          seedId: v.seedId,
          tape,
        });
        expect(fromHex).toEqual(digest);
      }
      expect(
        bytesToHex(
          claimMessageFromTapeHash({
            networkHash: v.networkHash,
            scoreContract: v.scoreContract,
            seedId: v.seedId,
            tapeHash: v.tapeHash,
          }),
        ),
      ).toBe(bytesToHex(bytesOf(v.digest)));
      const id = identityFromSecret(bytesOf(v.secretKey));
      expect(id.publicKey).toEqual(bytesOf(v.pubkey));
      // Ed25519 is deterministic, so the signature must match byte for byte.
      // eslint-disable-next-line no-await-in-loop -- vectors are checked one by one
      expect(bytesToHex(await signClaim(id, digest))).toBe(bytesToHex(bytesOf(v.signature)));
    }
  });
});

describe("key file", () => {
  test("is made on first run with mode 0600 and reloads the same identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "kalien-key-"));
    const path = join(dir, "nested", "key.json");
    const first = loadOrCreateIdentity(path);
    expect(first.created).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    const second = loadOrCreateIdentity(path);
    expect(second.created).toBe(false);
    expect(second.identity.address).toBe(first.identity.address);
    expect(readKeyFile(path).publicKeyHex).toBe(first.identity.publicKeyHex);
  });

  test("export and import round trip, and import never overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "kalien-key-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    const made = loadOrCreateIdentity(a).identity;
    const secret = exportSecretHex(a);
    expect(secret).toMatch(/^0x[0-9a-f]{64}$/);
    const imported = importIdentity(b, hexToBytes(secret));
    expect(imported.address).toBe(made.address);
    expect(() => importIdentity(b, hexToBytes(secret))).toThrow(/already exists/);
  });

  test("upgrades a pre-wire-14 key file in place and keeps mode 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "kalien-key-"));
    const path = join(dir, "legacy.json");
    const legacy = {
      version: 1,
      secretKey: `0x${RFC_SECRET}`,
      publicKey: `0x${RFC_PUBLIC}`,
      address: "0xc9770e44593153c55045c4abd80234834272752f37cd3c3791f3ff0504ccc7db",
      createdAt: "2026-10-23T00:00:00.000Z",
    };
    writeFileSync(path, JSON.stringify(legacy), { mode: 0o600 });
    expect(readKeyFile(path).address).toBe(RFC_ADDRESS);
    const updated = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
    expect(updated).toMatchObject({
      secretKey: `0x${RFC_SECRET}`,
      publicKey: RFC_PUBLIC_B58,
      address: RFC_ADDRESS,
      createdAt: legacy.createdAt,
    });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("rejects a key file whose base58 address does not match", () => {
    const dir = mkdtempSync(join(tmpdir(), "kalien-key-"));
    const path = join(dir, "bad.json");
    writeFileSync(
      path,
      JSON.stringify({ version: 1, secretKey: RFC_SECRET, address: RFC_PUBLIC_B58 }),
    );
    expect(() => readKeyFile(path)).toThrow(/does not match/);
  });

  test("parses every secret format and exports round trip", () => {
    const secret = hexToBytes(RFC_SECRET);
    const checksum = bytesToHex(sha256(secret).subarray(0, 4));
    const dir = mkdtempSync(join(tmpdir(), "kalien-key-"));
    const path = join(dir, "key.json");
    importIdentity(path, secret);
    const forms = [
      RFC_SECRET,
      `0x${RFC_SECRET}`,
      exportSecret(path, "base58"),
      exportSecret(path, "strkey"),
      `kalien-key-v1:${RFC_SECRET}:${checksum}`,
      JSON.stringify({ format: "kalien-key-v1", secretKey: RFC_SECRET }),
      readFileSync(path, "utf-8"),
    ];
    expect(exportSecret(path, "strkey")).toMatch(/^S[A-Z2-7]{55}$/);
    for (const form of forms) expect(parseSecretKey(form)).toEqual(secret);
    expect(() => parseSecretKey(`kalien-key-v1:${RFC_SECRET}:00000000`)).toThrow(/checksum/);
    expect(() => parseSecretKey("nope")).toThrow();
  });
});
