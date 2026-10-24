// Claim message and player-key helpers. The byte layouts live in
// shared/thruput/claim.ts (pinned to the contract by claim-vectors.json).
import {
  claimMessage as sharedClaimMessage,
  pubkeyAccountAddress as sharedPubkeyAccountAddress,
} from "../shared/thruput/claim";
import { id58, parseId32 } from "./ids";

/** The 32-byte digest a player signs. Ids are base58 (or hex) strings or bytes. */
export function claimMessage(input: {
  networkHash: string | Uint8Array;
  scoreContract: string | Uint8Array;
  seedId: number;
  tape: Uint8Array;
}): Uint8Array {
  const bytes = (value: string | Uint8Array, name: string) => {
    const out = typeof value === "string" ? parseId32(value) : value;
    if (!out || out.length !== 32) {
      throw new Error(`${name} must be a 32-byte id`);
    }
    return out;
  };
  return sharedClaimMessage({
    networkHash: bytes(input.networkHash, "networkHash"),
    scoreContract: bytes(input.scoreContract, "scoreContract"),
    seedId: input.seedId,
    tape: input.tape,
  });
}

/** Address (base58) of the nonce-0 pubkey account for an Ed25519 key. */
export function pubkeyAccountAddress(pubkey: Uint8Array): string {
  return id58(parseId32(sharedPubkeyAccountAddress(pubkey)) ?? new Uint8Array());
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
