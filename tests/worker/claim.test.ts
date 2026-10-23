import { describe, expect, it } from "bun:test";
import { claimMessage, pubkeyAccountAddress, verifyEd25519 } from "../../worker/claim";
import { bytesToHex, concatBytes, sha256, u32le } from "../../worker/hex";
import { NETWORK_HASH, SCORE_ADDRESS, testPlayer } from "./helpers/fake-chain";

describe("claim message", () => {
  it("matches the plan layout", async () => {
    const tape = new Uint8Array([1, 2, 3]);
    const message = await claimMessage({
      networkHash: NETWORK_HASH,
      scoreContract: SCORE_ADDRESS,
      seedId: 42,
      tape,
    });
    const expected = await sha256(
      concatBytes(
        new TextEncoder().encode("kalien-claim-v1"),
        new Uint8Array(32).fill(0x11),
        new Uint8Array(32).fill(0x22),
        u32le(42),
        await sha256(tape),
      ),
    );
    expect(bytesToHex(message)).toBe(bytesToHex(expected));
  });

  it("verifies only the right key and message", async () => {
    const player = await testPlayer(3);
    const other = await testPlayer(4);
    const message = new Uint8Array([9, 9, 9]);
    const signature = await player.sign(message);
    expect(await verifyEd25519(player.pubkey, message, signature)).toBe(true);
    expect(await verifyEd25519(other.pubkey, message, signature)).toBe(false);
    expect(await verifyEd25519(player.pubkey, new Uint8Array([9]), signature)).toBe(false);
    expect(await verifyEd25519(player.pubkey, message, signature.slice(1))).toBe(false);
  });

  it("derives a stable 32-byte account address", async () => {
    const player = await testPlayer(3);
    expect(pubkeyAccountAddress(player.pubkey)).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(pubkeyAccountAddress(player.pubkey)).toBe(player.address);
    expect(pubkeyAccountAddress(player.pubkey)).not.toBe((await testPlayer(4)).address);
  });
});
