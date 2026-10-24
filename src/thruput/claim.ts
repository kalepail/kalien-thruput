// Claim message the player key signs before a run is relayed on-chain:
//
//   sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))
//
// The byte layout lives in `shared/thruput/claim.ts` (pinned to the contract by
// `claim-vectors.json`). This wrapper keeps the browser call sites stable.

import { claimMessage as sharedClaimMessage } from "../../shared/thruput/claim";
import { idBytes } from "./ids";

export interface ClaimMessageInput {
  /** 32-byte network hash, base58 (or legacy hex). */
  networkHash: string;
  /** 32-byte score contract address, base58 (or legacy hex). */
  scoreContract: string;
  seedId: number;
  tape: Uint8Array;
}

export async function claimMessage(input: ClaimMessageInput): Promise<Uint8Array> {
  return sharedClaimMessage({
    networkHash: idBytes(input.networkHash),
    scoreContract: idBytes(input.scoreContract),
    seedId: input.seedId,
    tape: input.tape,
  });
}
