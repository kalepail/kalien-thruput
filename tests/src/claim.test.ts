import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { claimMessage } from "../../src/thruput/claim";
import { bytesToHex } from "../../src/lib/hex";

const VECTORS_PATH = new URL("../../shared/thruput/claim-vectors.json", import.meta.url);
const FIXTURES = new URL("../../kalien-contract/fixtures/", import.meta.url);

interface ClaimVector {
  tape: string;
  networkHash: string;
  scoreContract: string;
  seedId: number;
  digest: string;
}

describe("claimMessage", () => {
  it("is sha256 over the 115-byte preimage", async () => {
    const digest = await claimMessage({
      networkHash: `0x${"11".repeat(32)}`,
      scoreContract: "22".repeat(32),
      seedId: 0x01020304,
      tape: new Uint8Array([1, 2, 3]),
    });
    expect(digest.length).toBe(32);
  });

  it("rejects hashes that are not 32 bytes", async () => {
    await expect(
      claimMessage({
        networkHash: "0x11",
        scoreContract: "22".repeat(32),
        seedId: 1,
        tape: new Uint8Array(),
      }),
    ).rejects.toThrow();
  });

  it.skipIf(!existsSync(VECTORS_PATH))("matches the shared claim vectors", async () => {
    const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { claims: ClaimVector[] };
    expect(vectors.claims.length).toBeGreaterThan(0);
    for (const vector of vectors.claims) {
      const tape = new Uint8Array(readFileSync(new URL(vector.tape, FIXTURES)));
      const digest = await claimMessage({
        networkHash: vector.networkHash,
        scoreContract: vector.scoreContract,
        seedId: vector.seedId,
        tape,
      });
      expect(`0x${bytesToHex(digest)}`).toBe(vector.digest.toLowerCase());
    }
  });
});
