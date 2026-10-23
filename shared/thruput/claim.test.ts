import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import {
  PrivateKeySigner,
  createPubkeyAccount,
  derivePubkeyAccountAddress,
  toHex0x,
} from "@thruputchain/client";
import { CryptographicScheme, ed25519PublicKey } from "@thruputchain/protocol";
import {
  claimMessage,
  claimPreimageFromHash,
  fromHex,
  pubkeyAccountAddress,
  tapeHash,
  toHex,
} from "./claim";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "claim-vectors.json"), "utf8"));
const fixtures = join(import.meta.dir, "../../kalien-contract/fixtures");

describe("pubkeyAccountAddress", () => {
  for (const v of vectors.addresses) {
    test(`matches vector and @thruputchain/client for ${v.pubkey.slice(0, 10)}`, () => {
      expect(pubkeyAccountAddress(v.pubkey)).toBe(v.address);
      const derived = derivePubkeyAccountAddress({
        pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(fromHex(v.pubkey)) },
        nonce: 0n,
      });
      expect(toHex0x(derived)).toBe(v.address);
    });
  }

  test("matches createPubkeyAccount (default nonce)", () => {
    for (const v of vectors.addresses.filter((a: { secretKey: string }) => a.secretKey)) {
      const account = createPubkeyAccount({ signer: new PrivateKeySigner(fromHex(v.secretKey)) });
      expect(account.nonce).toBe(0n);
      expect(toHex0x(account.address)).toBe(v.address);
    }
  });
});

describe("claimMessage", () => {
  for (const c of vectors.claims) {
    test(`matches vector for ${c.tape}`, async () => {
      const tape = new Uint8Array(readFileSync(join(fixtures, c.tape)));
      expect(toHex(tapeHash(tape))).toBe(c.tapeHash);
      const preimage = claimPreimageFromHash({ ...c, tapeHash: c.tapeHash });
      expect(toHex(preimage)).toBe(c.preimage);
      expect(preimage.length).toBe(115);
      const digest = claimMessage({ networkHash: c.networkHash, scoreContract: c.scoreContract, seedId: c.seedId, tape });
      expect(toHex(digest)).toBe(c.digest);

      // Raw Ed25519 over the 32-byte digest, as the contract verifies it.
      expect(toHex(ed25519.sign(digest, fromHex(c.secretKey)))).toBe(c.signature);
      // The client's PrivateKeySigner produces the same signature.
      const signer = new PrivateKeySigner(fromHex(c.secretKey));
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
    edited[20] ^= 1;
    expect(toHex(claimMessage({ ...c, tape: edited }))).not.toBe(base);
  });

  test("rejects bad sizes", () => {
    const c = vectors.claims[0];
    expect(() => claimMessage({ ...c, networkHash: "0x00", tape: new Uint8Array(1) })).toThrow();
    expect(() => claimMessage({ ...c, seedId: -1, tape: new Uint8Array(1) })).toThrow();
    expect(() => pubkeyAccountAddress(new Uint8Array(31))).toThrow();
  });
});
