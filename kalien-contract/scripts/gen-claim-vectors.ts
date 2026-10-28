// Regenerate shared/thruput/claim-vectors.json from the TS implementation (wire 14).
// Usage (repo root): bun kalien-contract/scripts/gen-claim-vectors.ts
// The Rust test `claim_and_address_vectors_match_shared_ts` and
// shared/thruput/claim.test.ts both check the file. Identifiers are given as base58
// (the wire form) and as `...Hex` (what the Rust test reads).
import { ed25519 } from "@noble/curves/ed25519.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bytes32,
  claimMessage,
  claimPreimageFromHash,
  publicKeyHash,
  pubkeyAccountAddress,
  pubkeyAccountAddressBytes,
  tapeHash,
  toBase58,
  toHex,
} from "../../shared/thruput/claim";

const root = join(import.meta.dir, "../..");
const fixtures = join(root, "kalien-contract/fixtures");
const secret = (fill: number) => new Uint8Array(32).fill(fill);

const addressCase = (secretKey: string, pubkey: Uint8Array) => ({
  secretKey,
  pubkey: toHex(pubkey),
  pubkeyHash: toHex(publicKeyHash(pubkey)),
  address: pubkeyAccountAddress(pubkey),
  addressHex: toHex(pubkeyAccountAddressBytes(pubkey)),
});
const addresses = [0x01, 0x07, 0xab, 0xff].map((fill) => addressCase(toHex(secret(fill)), ed25519.getPublicKey(secret(fill))));
// The all-0x07 *public key* (no secret).
addresses.push(addressCase("", new Uint8Array(32).fill(7)));

const claimCases = [
  {
    tape: "test-short.tape",
    // Futurenet network hash after the 2026-10-24 reset.
    networkHash: "DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj",
    scoreContract: toBase58(new Uint8Array(32).fill(0x11)),
    seedId: 2_999_999,
    fill: 0x01,
  },
  {
    tape: "test-medium.tape",
    networkHash: toBase58(new Uint8Array(32).fill(0x42)),
    scoreContract: toBase58(bytes32("0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")),
    seedId: 0xffff_ffff,
    fill: 0xab,
  },
];

const claims = claimCases.map((c) => {
  const tape = new Uint8Array(readFileSync(join(fixtures, c.tape)));
  const sk = secret(c.fill);
  const digest = claimMessage({ networkHash: c.networkHash, scoreContract: c.scoreContract, seedId: c.seedId, tape });
  return {
    tape: c.tape,
    networkHash: c.networkHash,
    networkHashHex: toHex(bytes32(c.networkHash)),
    scoreContract: c.scoreContract,
    scoreContractHex: toHex(bytes32(c.scoreContract)),
    seedId: c.seedId,
    tapeHash: toHex(tapeHash(tape)),
    preimage: toHex(claimPreimageFromHash({ ...c, tapeHash: tapeHash(tape) })),
    digest: toHex(digest),
    secretKey: toHex(sk),
    pubkey: toHex(ed25519.getPublicKey(sk)),
    signature: toHex(ed25519.sign(digest, sk)),
  };
});

const out = {
  comment:
    "Test vectors (wire 14) for shared/thruput/claim.ts and kalien_score claim.rs. Tapes live in kalien-contract/fixtures/. Regenerate with: bun kalien-contract/scripts/gen-claim-vectors.ts",
  addresses,
  claims,
};
writeFileSync(join(root, "shared/thruput/claim-vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote shared/thruput/claim-vectors.json");
