/**
 * Kalien claim message and pubkey-account address helpers.
 *
 * These byte layouts must match `kalien-contract/contracts/kalien_score/src/claim.rs`
 * exactly. `claim-vectors.json` pins both sides; `claim.test.ts` and the Rust
 * test `claim_and_address_vectors_match_shared_ts` check it.
 *
 * Used by the browser, the Worker and the CLI. Synchronous, no I/O.
 */
import { sha256 } from "@noble/hashes/sha2.js";

/** Domain tag at the start of every claim preimage (15 ASCII bytes). */
export const CLAIM_DOMAIN = "kalien-claim-v1";

/** CXS bytes of `DomainSeparator { ext: 0, domain_separator: "PubkeyAccount" }`. */
const PUBKEY_ACCOUNT_SEPARATOR = new Uint8Array([
  0x00, 0x0d, ...new TextEncoder().encode("PubkeyAccount"),
]);

export type Bytes32Input = Uint8Array | string;

export interface ClaimInput {
  /** Network hash from `groundhog_networkInfo` (32 bytes, or 0x hex). */
  networkHash: Bytes32Input;
  /** Score contract address (32 bytes, or 0x hex). */
  scoreContract: Bytes32Input;
  /** Seed epoch id (u32). */
  seedId: number;
  /** Raw tape bytes. */
  tape: Uint8Array;
}

/** `0x`-prefixed lowercase hex. */
export function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

/** Decode hex (with or without `0x`) into bytes. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytes32(value: Bytes32Input, name: string): Uint8Array {
  const bytes = typeof value === "string" ? fromHex(value) : value;
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  return bytes;
}

function u32le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`seedId must be a u32, got ${value}`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/** `sha256(tape)`: the id the contract uses to reject duplicate tapes. */
export function tapeHash(tape: Uint8Array): Uint8Array {
  return sha256(tape);
}

/**
 * `"kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || tape_hash`
 * (115 bytes). Takes the tape hash, not the tape.
 */
export function claimPreimageFromHash(input: {
  networkHash: Bytes32Input;
  scoreContract: Bytes32Input;
  seedId: number;
  tapeHash: Bytes32Input;
}): Uint8Array {
  const out = new Uint8Array(15 + 32 + 32 + 4 + 32);
  out.set(new TextEncoder().encode(CLAIM_DOMAIN), 0);
  out.set(bytes32(input.networkHash, "networkHash"), 15);
  out.set(bytes32(input.scoreContract, "scoreContract"), 47);
  out.set(u32le(input.seedId), 79);
  out.set(bytes32(input.tapeHash, "tapeHash"), 83);
  return out;
}

/**
 * The 32-byte message the player signs with Ed25519:
 * `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))`.
 */
export function claimMessage(input: ClaimInput): Uint8Array {
  return sha256(
    claimPreimageFromHash({
      networkHash: input.networkHash,
      scoreContract: input.scoreContract,
      seedId: input.seedId,
      tapeHash: tapeHash(input.tape),
    }),
  );
}

/**
 * The address of the nonce-0 Ed25519 pubkey account for `pubkey`:
 * `sha256(cxs(DomainSeparator("PubkeyAccount")) || cxs({ pubkey: Ed25519(pk), nonce: 0 }))`.
 *
 * Equal to `derivePubkeyAccountAddress` and to `createPubkeyAccount({ signer }).address`
 * (default nonce 0) in `@thruputchain/client`. The score contract mints to this address.
 */
export function pubkeyAccountAddress(pubkey: Bytes32Input): `0x${string}` {
  const key = bytes32(pubkey, "pubkey");
  const preimage = new Uint8Array(PUBKEY_ACCOUNT_SEPARATOR.length + 1 + 32 + 1);
  preimage.set(PUBKEY_ACCOUNT_SEPARATOR, 0);
  preimage[15] = 0x00; // PublicKey::Ed25519
  preimage.set(key, 16);
  preimage[48] = 0x00; // nonce 0 (compact CXS u64)
  return toHex(sha256(preimage));
}
