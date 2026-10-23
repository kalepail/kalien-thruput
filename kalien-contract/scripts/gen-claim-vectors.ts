// Regenerate shared/thruput/claim-vectors.json from the TS implementation.
// Usage (repo root): bun kalien-contract/scripts/gen-claim-vectors.ts
// The Rust test `claim_and_address_vectors_match_shared_ts` and
// shared/thruput/claim.test.ts both check the file.
import { ed25519 } from "@noble/curves/ed25519";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimMessage,
  claimPreimageFromHash,
  pubkeyAccountAddress,
  tapeHash,
  toHex,
} from "../../shared/thruput/claim";

const root = join(import.meta.dir, "../..");
const fixtures = join(root, "kalien-contract/fixtures");

const secret = (fill: number) => new Uint8Array(32).fill(fill);

const addresses: { secretKey: string; pubkey: string; address: string }[] = [0x01, 0x07, 0xab, 0xff].map((fill) => {
  const pubkey = ed25519.getPublicKey(secret(fill));
  return { secretKey: toHex(secret(fill)), pubkey: toHex(pubkey), address: pubkeyAccountAddress(pubkey) };
});
// The all-0x07 *public key* vector used by the TS client docs.
addresses.push({
  secretKey: "",
  pubkey: toHex(new Uint8Array(32).fill(7)),
  address: pubkeyAccountAddress(new Uint8Array(32).fill(7)),
});

const claimCases = [
  {
    tape: "test-short.tape",
    networkHash: "0xb69ec9c688b3936b5bcbfc4eebc355d39aa9e5c6f6f072cc4a05564a07435047",
    scoreContract: "0x" + "11".repeat(32),
    seedId: 2_999_999,
    fill: 0x01,
  },
  {
    tape: "test-medium.tape",
    networkHash: "0x" + "42".repeat(32),
    scoreContract: "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
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
    scoreContract: c.scoreContract,
    seedId: c.seedId,
    tapeHash: toHex(tapeHash(tape)),
    preimage: toHex(
      claimPreimageFromHash({ networkHash: c.networkHash, scoreContract: c.scoreContract, seedId: c.seedId, tapeHash: tapeHash(tape) }),
    ),
    digest: toHex(digest),
    secretKey: toHex(sk),
    pubkey: toHex(ed25519.getPublicKey(sk)),
    signature: toHex(ed25519.sign(digest, sk)),
  };
});

const out = {
  comment:
    "Test vectors for shared/thruput/claim.ts and kalien_score claim.rs. Tapes live in kalien-contract/fixtures/. Regenerate with: bun kalien-contract/scripts/gen-claim-vectors.ts",
  addresses,
  claims,
};
writeFileSync(join(root, "shared/thruput/claim-vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote shared/thruput/claim-vectors.json");
