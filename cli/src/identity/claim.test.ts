import { describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bytesToHex, claimMessage, claimMessageFromTapeHash, hexToBytes, sha256 } from "./claim";
import {
  addressFromPublicKey,
  exportSecretHex,
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
// Address from `thruput keys import` (thruput 0.29.2) for RFC_PUBLIC, nonce 0.
const RFC_ADDRESS = "0xc9770e44593153c55045c4abd80234834272752f37cd3c3791f3ff0504ccc7db";

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
    expect(id.address).toBe(RFC_ADDRESS);
    expect(addressFromPublicKey(RFC_PUBLIC)).toBe(RFC_ADDRESS);
  });

  test("address matches the contract's byte layout (kalien_score claim.rs)", () => {
    // sha256(CXS DomainSeparator "PubkeyAccount" || scheme 0x00 || pubkey || nonce 0x00)
    const preimage = new Uint8Array([
      0x00,
      0x0d,
      ...new TextEncoder().encode("PubkeyAccount"),
      0x00,
      ...hexToBytes(RFC_PUBLIC),
      0x00,
    ]);
    expect(`0x${bytesToHex(sha256(preimage))}`).toBe(RFC_ADDRESS);
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
  address: string;
}
interface ClaimVector {
  tape: string; // file name in kalien-contract/fixtures/
  networkHash: string;
  scoreContract: string;
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
const strip = (hex: string) => hex.replace(/^0x/, "").toLowerCase();

describe.skipIf(!existsSync(vectorsPath))("shared/thruput/claim-vectors.json", () => {
  test("has address and claim vectors", () => {
    expect(vectors.addresses.length).toBeGreaterThan(0);
    expect(vectors.claims.length).toBeGreaterThan(0);
  });

  test("pubkeys and pubkey account addresses match", () => {
    for (const v of vectors.addresses) {
      expect(addressFromPublicKey(v.pubkey)).toBe(v.address.toLowerCase());
      if (v.secretKey) {
        const id = identityFromSecret(hexToBytes(v.secretKey));
        expect(id.publicKeyHex).toBe(strip(v.pubkey));
        expect(id.address).toBe(v.address.toLowerCase());
      }
    }
  });

  test("claim digests and signatures match", async () => {
    for (const v of vectors.claims) {
      const tape = new Uint8Array(readFileSync(join(repoRoot, "kalien-contract/fixtures", v.tape)));
      expect(bytesToHex(sha256(tape))).toBe(strip(v.tapeHash));
      const digest = claimMessage({
        networkHash: v.networkHash,
        scoreContract: v.scoreContract,
        seedId: v.seedId,
        tape,
      });
      expect(bytesToHex(digest)).toBe(strip(v.digest));
      expect(
        bytesToHex(
          claimMessageFromTapeHash({
            networkHash: v.networkHash,
            scoreContract: v.scoreContract,
            seedId: v.seedId,
            tapeHash: v.tapeHash,
          }),
        ),
      ).toBe(strip(v.digest));
      const id = identityFromSecret(hexToBytes(v.secretKey));
      expect(id.publicKeyHex).toBe(strip(v.pubkey));
      // Ed25519 is deterministic, so the signature must match byte for byte.
      expect(bytesToHex(await signClaim(id, digest))).toBe(strip(v.signature));
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
});
