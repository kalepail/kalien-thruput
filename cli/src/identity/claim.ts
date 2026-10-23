import { createHash } from "node:crypto";

// Claim message bound into every run submission. The score contract verifies
// an Ed25519 signature over this digest, so the relay cannot redirect a run.
//
//   sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))
//
// This mirrors `claimMessage` in shared/thruput/claim.ts (owned by the contract
// agent) byte for byte. Keep both in sync; cli/src/identity/claim.test.ts checks
// the shared vectors when they exist.

export const CLAIM_DOMAIN = "kalien-claim-v1";

export interface ClaimMessageInput {
  /** 32-byte network hash, raw bytes or 0x/plain hex. */
  networkHash: Uint8Array | string;
  /** 32-byte score contract address, raw bytes or 0x/plain hex. */
  scoreContract: Uint8Array | string;
  seedId: number;
  tape: Uint8Array;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function bytes32(value: Uint8Array | string, name: string): Uint8Array {
  const bytes = typeof value === "string" ? hexToBytes(value) : value;
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return new Uint8Array(h.digest());
}

export function claimMessage(input: ClaimMessageInput): Uint8Array {
  return claimMessageFromTapeHash({ ...input, tapeHash: sha256(input.tape) });
}

/** Same digest as `claimMessage`, from a precomputed `sha256(tape)`. */
export function claimMessageFromTapeHash(
  input: Omit<ClaimMessageInput, "tape"> & { tapeHash: Uint8Array | string },
): Uint8Array {
  if (!Number.isInteger(input.seedId) || input.seedId < 0 || input.seedId > 0xffffffff) {
    throw new Error(`seedId must be a u32, got ${input.seedId}`);
  }
  const seedId = new Uint8Array(4);
  new DataView(seedId.buffer).setUint32(0, input.seedId >>> 0, true);
  return sha256(
    new TextEncoder().encode(CLAIM_DOMAIN),
    bytes32(input.networkHash, "networkHash"),
    bytes32(input.scoreContract, "scoreContract"),
    seedId,
    bytes32(input.tapeHash, "tapeHash"),
  );
}
