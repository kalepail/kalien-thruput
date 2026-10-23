// Claim message and player-key helpers. The byte layouts live in
// shared/thruput/claim.ts (pinned to the contract by claim-vectors.json).
export { claimMessage, pubkeyAccountAddress } from "../shared/thruput/claim";

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
