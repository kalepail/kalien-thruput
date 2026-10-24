import { describe, expect, it } from "bun:test";
import { verifyAsync as verify } from "@noble/ed25519";
import { toBase58 } from "@thruputchain/client";
import {
  parseLeaderboardEntry,
  parseLeaderboardPage,
  parseLeaderboardPlayer,
  profileUpdateMessage,
  updateLeaderboardProfile,
} from "../../src/leaderboard/api";
import { generateStoredWallet, walletFromSecret } from "../../src/wallet/keyWallet";
import { hexToBytes } from "../../src/lib/hex";

const PLAYER_BYTES = new Uint8Array(32).fill(7);
const PLAYER = toBase58(PLAYER_BYTES);
const PLAYER_HEX = `0x${"07".repeat(32)}`;
const TX_HEX = `0x${"de".repeat(32)}`;
const TX_BASE58 = toBase58(new Uint8Array(32).fill(0xde));

describe("leaderboard parsing", () => {
  it("reads Thruput entries with base-unit minted amounts", () => {
    const entry = parseLeaderboardEntry({
      rank: 2,
      runId: "r1",
      player: PLAYER,
      score: 1200,
      minted: "12000000000",
      seed: 7,
      txHash: TX_HEX,
    });
    expect(entry).toMatchObject({
      rank: 2,
      runId: "r1",
      playerAddress: PLAYER,
      score: 1200,
      minted: 12_000_000_000n,
      txHash: TX_BASE58,
    });
  });

  it("reads a page and a player", () => {
    const page = parseLeaderboardPage(
      {
        window: "day",
        entries: [{ player: PLAYER, score: 3 }],
        pagination: { limit: 25, offset: 0, total: 1, next_offset: null },
        ingestion: { last_synced_at: "2026-10-23T00:00:00Z", total_events: 4 },
      },
      "all",
    );
    expect(page.window).toBe("day");
    expect(page.entries[0]?.rank).toBe(1);
    expect(page.ingestion?.totalEvents).toBe(4);

    const player = parseLeaderboardPlayer(
      {
        player: {
          player_address: PLAYER_HEX,
          stats: { total_runs: 2, best_score: 9, total_minted: "90000000" },
          ranks: { ten_min: 1, day: 2, all: null },
          recent_runs: [{ player: PLAYER, score: 9 }],
        },
      },
      "0xfallback",
    );
    // Legacy hex addresses become base58.
    expect(player.playerAddress).toBe(PLAYER);
    expect(player.stats.totalMinted).toBe(90_000_000n);
    expect(player.ranks.tenMin).toBe(1);
    expect(player.recentRuns).toHaveLength(1);
  });
});

describe("signed profile update", () => {
  it("signs the profile message with the player key", async () => {
    const stored = generateStoredWallet();
    const wallet = walletFromSecret(stored.secretKey, stored.createdAt);
    let body: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    const networkHash = toBase58(new Uint8Array(32).fill(0xab));
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/config") {
        return Promise.resolve(
          Response.json({
            networkHash,
            rpcUrl: "https://rpc.example",
            scoreContract: `0x${"11".repeat(32)}`,
            tokenContract: `0x${"22".repeat(32)}`,
            explorerUrl: "https://explorer.example",
          }),
        );
      }
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        Response.json({ profile: { username: "ace", link_url: null, updated_at: "now" } }),
      );
    }) as typeof fetch;
    try {
      const result = await updateLeaderboardProfile(
        wallet.address,
        { username: "ace", linkUrl: null },
        { pubkeyHex: wallet.pubkeyHex, sign: wallet.sign },
      );
      expect(result.profile.username).toBe("ace");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(body.pubkey).toBe(wallet.pubkeyHex);
    expect(body.linkUrl).toBeNull();
    const message = profileUpdateMessage({
      networkHash,
      address: wallet.address,
      username: "ace",
      linkUrl: null,
      timestamp: body.timestamp as number,
    });
    // Layout of profileMessage in worker/profile.ts, with base58 identifiers in
    // their exact case (base58 is case-sensitive).
    expect(message.split("\n")).toEqual([
      "kalien-profile-v1",
      networkHash,
      wallet.address,
      String(body.timestamp),
      "ace",
      "",
    ]);
    const ok = await verify(
      hexToBytes(body.signature as string),
      new TextEncoder().encode(message),
      hexToBytes(wallet.pubkeyHex),
    );
    expect(ok).toBe(true);
  });
});
