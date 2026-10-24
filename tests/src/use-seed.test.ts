import { afterEach, describe, expect, it } from "bun:test";
import {
  estimateServerOffsetMs,
  getSeedSnapshot,
  nextServerOffsetMs,
  seedIdAt,
  subscribeToSeed,
} from "../../src/hooks/useSeed";

const EPOCH_MS = 600_000;

/** What the Worker sends at server time `ms` (see worker/seed.ts). */
function serverAnswer(ms: number) {
  const seedId = Math.floor(ms / EPOCH_MS);
  const secondsLeft = 600 - (Math.floor(ms / 1000) % 600);
  return { seedId, secondsLeft };
}

describe("server clock offset (review item 6)", () => {
  const serverMs = Date.UTC(2026, 9, 24, 12, 3, 27, 400);

  for (const skewMinutes of [-25, -15, -10, -1, 0, 1, 10, 15, 25]) {
    it(`maps a local clock ${skewMinutes} min off to the server epoch`, () => {
      const localMs = serverMs + skewMinutes * 60_000;
      const { seedId, secondsLeft } = serverAnswer(serverMs);
      const offset = estimateServerOffsetMs(seedId, secondsLeft, localMs);
      expect(Math.abs(localMs + offset - serverMs)).toBeLessThan(1_000);
      expect(seedIdAt(localMs + offset)).toBe(seedId);
    });
  }

  it("ignores sub-second jitter but follows a real clock change", () => {
    expect(nextServerOffsetMs(1_000, 1_400)).toBe(1_000);
    expect(nextServerOffsetMs(1_000, 900_000)).toBe(900_000);
  });
});

describe("useSeed store with a skewed local clock", () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let unsubscribe: (() => void) | null = null;

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    globalThis.fetch = realFetch;
    Date.now = realNow;
  });

  it("loads the seed although the local clock is 15 minutes behind", async () => {
    const serverMs = Date.UTC(2026, 9, 24, 12, 3, 27, 400);
    Date.now = () => serverMs - 15 * 60_000;
    const { seedId, secondsLeft } = serverAnswer(serverMs);
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ success: true, seedId, seed: 0x1234abcd, indexed: true, secondsLeft }),
      )) as unknown as typeof fetch;

    unsubscribe = subscribeToSeed(() => {});
    for (let i = 0; i < 20 && getSeedSnapshot().seed === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const snapshot = getSeedSnapshot();
    expect(snapshot.seed).toBe(0x1234abcd);
    expect(snapshot.seedId).toBe(seedId);
    expect(Math.abs(snapshot.secondsLeft - secondsLeft)).toBeLessThanOrEqual(1);
  });
});
