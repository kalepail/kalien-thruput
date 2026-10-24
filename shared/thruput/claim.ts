/**
 * Kalien claim message and pubkey-account address helpers (wire format 14).
 *
 * These byte layouts must match `kalien-contract/contracts/kalien_score/src/claim.rs`
 * exactly. `claim-vectors.json` pins both sides; `claim.test.ts` and the Rust test
 * `claim_and_address_vectors_match_shared_ts` check it.
 *
 * Identifiers (addresses, hashes, network hash) are base58 on the wire. Every 32-byte
 * input here accepts raw bytes, base58 text, or `0x` hex. Addresses come back as base58.
 *
 * Used by the browser, the Worker and the CLI. Synchronous, no I/O.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase58, toBase58 } from "@thruputchain/protocol/utils";

export { fromBase58, toBase58 };

/** Domain tag at the start of every claim preimage (15 ASCII bytes). */
export const CLAIM_DOMAIN = "kalien-claim-v1";

const ascii = (text: string) => new TextEncoder().encode(text);
/** CXS bytes of `DomainSeparator { ext: 0, domain_separator: "PublicKey" }`. */
const PUBLIC_KEY_SEPARATOR = new Uint8Array([0x00, 0x09, ...ascii("PublicKey")]);
/** CXS bytes of `DomainSeparator { ext: 0, domain_separator: "PubkeyAccount" }`. */
const PUBKEY_ACCOUNT_SEPARATOR = new Uint8Array([0x00, 0x0d, ...ascii("PubkeyAccount")]);

/** 32 raw bytes, base58 text, or `0x` hex. */
export type Bytes32Input = Uint8Array | string;

export interface ClaimInput {
  /** Network hash from `getNetworkInfo` (base58 on the wire). */
  networkHash: Bytes32Input;
  /** Score contract address (base58 on the wire). */
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

/** 32 bytes from raw bytes, `0x` hex, or base58 text. */
export function bytes32(value: Bytes32Input, name = "value"): Uint8Array {
  const bytes =
    typeof value !== "string" ? value : value.startsWith("0x") || value.startsWith("0X") ? fromHex(value) : fromBase58(value, 32);
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
  out.set(ascii(CLAIM_DOMAIN), 0);
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

/** `sha256(cxs(DomainSeparator("PublicKey")) || cxs(PublicKey::Ed25519(pubkey)))`. */
export function publicKeyHash(pubkey: Bytes32Input): Uint8Array {
  const key = bytes32(pubkey, "pubkey");
  const preimage = new Uint8Array(PUBLIC_KEY_SEPARATOR.length + 1 + 32);
  preimage.set(PUBLIC_KEY_SEPARATOR, 0);
  preimage[11] = 0x00; // PublicKey::Ed25519
  preimage.set(key, 12);
  return sha256(preimage);
}

/** Raw 32-byte address of the nonce-0 Ed25519 pubkey account. */
export function pubkeyAccountAddressBytes(pubkey: Bytes32Input): Uint8Array {
  const preimage = new Uint8Array(PUBKEY_ACCOUNT_SEPARATOR.length + 32 + 1);
  preimage.set(PUBKEY_ACCOUNT_SEPARATOR, 0);
  preimage.set(publicKeyHash(pubkey), 15);
  preimage[47] = 0x00; // nonce 0 (compact CXS u64)
  return sha256(preimage);
}

/**
 * Base58 address of the nonce-0 Ed25519 pubkey account for `pubkey`:
 * `sha256(cxs(DomainSeparator("PubkeyAccount")) || cxs({ pubkey_hash: publicKeyHash(pk), nonce: 0 }))`.
 *
 * Equal to `derivePubkeyAccountAddress(pubkeyAccountPreimage(key, 0n))` and to
 * `createPubkeyAccount({ signer }).address` in `@thruputchain/client` 0.23. The score
 * contract mints to this address.
 */
export function pubkeyAccountAddress(pubkey: Bytes32Input): string {
  return toBase58(pubkeyAccountAddressBytes(pubkey));
}
