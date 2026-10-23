// Claim message and player-key helpers.
//
// TODO(kt-contract): switch to `shared/thruput/claim.ts` when it lands. This
// copy follows PORT-PLAN.md "Score contract" step 2 byte for byte:
// sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))
import { derivePubkeyAccountAddress, toHex0x } from "@thruputchain/client";
import { CryptographicScheme, ed25519PublicKey } from "@thruputchain/protocol";
import { CLAIM_DOMAIN } from "./constants";
import { hexToBytes, sha256, u32le } from "./hex";

const encoder = new TextEncoder();

export interface ClaimMessageInput {
  /** 32-byte network hash (hex or bytes). */
  networkHash: string | Uint8Array;
  /** 32-byte score contract address (hex or bytes). */
  scoreContract: string | Uint8Array;
  seedId: number;
  tape: Uint8Array;
}

function bytes32(value: string | Uint8Array, name: string): Uint8Array {
  const out = typeof value === "string" ? hexToBytes(value) : value;
  if (out.length !== 32) {
    throw new Error(`${name} must be 32 bytes`);
  }
  return out;
}

export async function claimMessage(input: ClaimMessageInput): Promise<Uint8Array> {
  return sha256(
    encoder.encode(CLAIM_DOMAIN),
    bytes32(input.networkHash, "networkHash"),
    bytes32(input.scoreContract, "scoreContract"),
    u32le(input.seedId),
    await sha256(input.tape),
  );
}

/** Address of the pubkey account for an Ed25519 key (nonce 0), as 0x hex. */
export function pubkeyAccountAddress(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) {
    throw new Error("pubkey must be 32 bytes");
  }
  return toHex0x(
    derivePubkeyAccountAddress({
      pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(pubkey) },
      nonce: 0n,
    }),
  );
}

export async function verifyEd25519(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (pubkey.length !== 32 || signature.length !== 64) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pubkey as Uint8Array<ArrayBuffer>,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      signature as Uint8Array<ArrayBuffer>,
      message as Uint8Array<ArrayBuffer>,
    );
  } catch {
    return false;
  }
}
