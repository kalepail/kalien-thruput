import { describe, expect, it } from "bun:test";
import { verify } from "@noble/ed25519";
import {
  parseLeaderboardEntry,
  parseLeaderboardPage,
  parseLeaderboardPlayer,
  profileUpdateMessage,
  updateLeaderboardProfile,
} from "../../src/leaderboard/api";
import { generateStoredWallet, walletFromSecret } from "../../src/wallet/keyWallet";
import { hexToBytes } from "../../src/lib/hex";
import { profileMessage } from "../../worker/profile";

describe("leaderboard parsing", () => {
  it("reads Thruput entries with base-unit minted amounts", () => {
    const entry = parseLeaderboardEntry({
      rank: 2,
      runId: "r1",
      player: "0xabc",
      score: 1200,
      minted: "12000000000",
      seed: 7,
      txHash: "0xdead",
    });
    expect(entry).toMatchObject({
      rank: 2,
      runId: "r1",
      playerAddress: "0xabc",
      score: 1200,
      minted: 12_000_000_000n,
      txHash: "0xdead",
    });
  });

  it("reads the old shape (claimantAddress, proofJobId, whole-KALIEN mintedDelta)", () => {
    const entry = parseLeaderboardEntry({
      claimantAddress: "0xold",
      proofJobId: "j1",
      mintedDelta: 5,
      score: 5,
    });
    expect(entry.playerAddress).toBe("0xold");
    expect(entry.runId).toBe("j1");
    expect(entry.minted).toBe(50_000_000n);
  });

  it("reads a page and a player", () => {
    const page = parseLeaderboardPage(
      {
        window: "day",
        entries: [{ player: "0x1", score: 3 }],
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
          player_address: "0x1",
          stats: { total_runs: 2, best_score: 9, total_minted: "90000000" },
          ranks: { ten_min: 1, day: 2, all: null },
          recent_runs: [{ player: "0x1", score: 9 }],
        },
      },
      "0xfallback",
    );
    expect(player.playerAddress).toBe("0x1");
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
    const networkHash = `0x${"ab".repeat(32)}`;
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
    // Same layout as profileMessage in worker/profile.ts.
    expect(message.split("\n")).toEqual([
      "kalien-profile-v1",
      networkHash,
      wallet.address,
      String(body.timestamp),
      "ace",
      "",
    ]);
    expect(new TextEncoder().encode(message)).toEqual(
      profileMessage({
        networkHash,
        playerAddress: wallet.address,
        timestamp: body.timestamp as number,
        username: "ace",
        linkUrl: null,
      }),
    );
    const ok = await verify(
      hexToBytes(body.signature as string),
      new TextEncoder().encode(message),
      hexToBytes(wallet.pubkeyHex),
    );
    expect(ok).toBe(true);
  });
});
