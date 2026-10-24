import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  Ed25519Signer,
  createPubkeyAccount,
  derivePubkeyAccountAddress,
  derivePublicKeyHash,
  pubkeyAccountPreimage,
  toBase58,
  toHex0x,
} from "@thruputchain/client";
import { CryptographicScheme, ed25519PublicKey } from "@thruputchain/protocol";
import {
  bytes32,
  claimMessage,
  claimPreimageFromHash,
  fromHex,
  publicKeyHash,
  pubkeyAccountAddress,
  pubkeyAccountAddressBytes,
  tapeHash,
  toHex,
} from "./claim";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "claim-vectors.json"), "utf8"));
const fixtures = join(import.meta.dir, "../../kalien-contract/fixtures");
const ed25519Key = (hex: string) => ({ scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(fromHex(hex)) });

describe("pubkeyAccountAddress (wire 14)", () => {
  for (const v of vectors.addresses) {
    test(`matches vector and @thruputchain/client for ${v.pubkey.slice(0, 10)}`, () => {
      expect(toHex(publicKeyHash(v.pubkey))).toBe(v.pubkeyHash);
      expect(pubkeyAccountAddress(v.pubkey)).toBe(v.address);
      expect(toHex(pubkeyAccountAddressBytes(v.pubkey))).toBe(v.addressHex);
      const key = ed25519Key(v.pubkey);
      expect(toHex0x(derivePublicKeyHash(key as never))).toBe(v.pubkeyHash);
      const derived = derivePubkeyAccountAddress(pubkeyAccountPreimage(key as never, 0n));
      expect(toBase58(derived)).toBe(v.address);
    });
  }

  test("matches createPubkeyAccount (default nonce 0)", () => {
    for (const v of vectors.addresses.filter((a: { secretKey: string }) => a.secretKey)) {
      const account = createPubkeyAccount({ signer: Ed25519Signer.fromSeed(fromHex(v.secretKey)) });
      expect(account.nonce).toBe(0n);
      expect(toBase58(account.address)).toBe(v.address);
    }
  });

  test("accepts base58, hex and bytes", () => {
    const v = vectors.addresses[0];
    const pk = fromHex(v.pubkey);
    expect(pubkeyAccountAddress(pk)).toBe(v.address);
    expect(pubkeyAccountAddress(toBase58(pk))).toBe(v.address);
    expect(toHex(bytes32(v.address))).toBe(v.addressHex);
  });
});

describe("claimMessage", () => {
  for (const c of vectors.claims) {
    test(`matches vector for ${c.tape}`, async () => {
      const tape = new Uint8Array(readFileSync(join(fixtures, c.tape)));
      expect(toHex(tapeHash(tape))).toBe(c.tapeHash);
      expect(toHex(bytes32(c.networkHash))).toBe(c.networkHashHex);
      expect(toHex(bytes32(c.scoreContract))).toBe(c.scoreContractHex);
      const preimage = claimPreimageFromHash({ ...c, tapeHash: c.tapeHash });
      expect(toHex(preimage)).toBe(c.preimage);
      expect(preimage.length).toBe(115);
      const digest = claimMessage({ networkHash: c.networkHash, scoreContract: c.scoreContract, seedId: c.seedId, tape });
      expect(toHex(digest)).toBe(c.digest);
      // Hex inputs give the same digest as base58 inputs.
      expect(toHex(claimMessage({ networkHash: c.networkHashHex, scoreContract: c.scoreContractHex, seedId: c.seedId, tape }))).toBe(c.digest);

      // Raw Ed25519 over the 32-byte digest, as the contract verifies it.
      expect(toHex(ed25519.sign(digest, fromHex(c.secretKey)))).toBe(c.signature);
      // The client's Ed25519Signer produces the same signature.
      const signer = Ed25519Signer.fromSeed(fromHex(c.secretKey));
      const sig = await signer.sign(digest);
      const raw = (sig as unknown as { ed25519: Uint8Array }).ed25519;
      expect(toHex(new Uint8Array(raw))).toBe(c.signature);
      expect(ed25519.verify(fromHex(c.signature), digest, fromHex(c.pubkey))).toBe(true);
    });
  }

  test("binds every field", () => {
    const c = vectors.claims[0];
    const tape = new Uint8Array(readFileSync(join(fixtures, c.tape)));
    const base = toHex(claimMessage({ ...c, tape }));
    expect(toHex(claimMessage({ ...c, seedId: c.seedId + 1, tape }))).not.toBe(base);
    expect(toHex(claimMessage({ ...c, networkHash: "0x" + "00".repeat(32), tape }))).not.toBe(base);
    expect(toHex(claimMessage({ ...c, scoreContract: "0x" + "00".repeat(32), tape }))).not.toBe(base);
    const edited = tape.slice();
    edited[20]! ^= 1;
    expect(toHex(claimMessage({ ...c, tape: edited }))).not.toBe(base);
  });

  test("rejects bad sizes", () => {
    const c = vectors.claims[0];
    expect(() => claimMessage({ ...c, networkHash: "0x00", tape: new Uint8Array(1) })).toThrow();
    expect(() => claimMessage({ ...c, seedId: -1, tape: new Uint8Array(1) })).toThrow();
    expect(() => pubkeyAccountAddress(new Uint8Array(31))).toThrow();
  });
});
