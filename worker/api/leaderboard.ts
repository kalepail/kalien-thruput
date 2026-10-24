import { Hono } from "hono";
import { pubkeyAccountAddress, verifyEd25519 } from "../claim";
import { chainContext } from "../chain/context";
import { LEADERBOARD_CACHE_CONTROL, LEADERBOARD_PRIVATE_CACHE_CONTROL } from "../cache-control";
import { bytesToHex, parseFixedHex } from "../hex";
import {
  DEFAULT_LEADERBOARD_LIMIT,
  getIndexerState,
  getLeaderboardPage,
  getPlayer,
  getProfile,
  MAX_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_OFFSET,
  parseLeaderboardWindow,
  upsertProfile,
} from "../leaderboard/store";
import {
  PROFILE_SIGNATURE_MAX_SKEW_MS,
  profileMessage,
  sanitizeLinkUrl,
  sanitizeUsername,
} from "../profile";
import { safeErrorMessage } from "../utils";
import {
  clientIp,
  jsonError,
  normalizeAddress,
  RateLimiter,
  rateLimited,
  readBodyLimited,
  type AppEnv,
} from "./http";

const readLimiter = new RateLimiter(120, 60_000);
const MAX_PROFILE_BODY_BYTES = 4_096;
const writeLimiter = new RateLimiter(10, 60_000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, min), max);
}

async function etagFor(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"lb-${bytesToHex(new Uint8Array(digest.slice(0, 8)))}"`;
}

export function createLeaderboardRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // GET /api/leaderboard?window=10m|day|all&limit&offset&address
  router.get("/", async (c) => {
    const retry = readLimiter.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const windowRaw = c.req.query("window");
    const window = parseLeaderboardWindow(windowRaw);
    if (!window) {
      return jsonError(c, 400, `invalid window: ${windowRaw}`);
    }
    const addressRaw = c.req.query("address");
    const address = addressRaw ? normalizeAddress(addressRaw) : null;
    if (addressRaw && !address) {
      return jsonError(c, 400, "invalid address");
    }

    try {
      const [page, ingestion] = await Promise.all([
        getLeaderboardPage(c.env, {
          window,
          limit: clampInt(
            c.req.query("limit"),
            DEFAULT_LEADERBOARD_LIMIT,
            1,
            MAX_LEADERBOARD_LIMIT,
          ),
          offset: clampInt(c.req.query("offset"), 0, 0, MAX_LEADERBOARD_OFFSET),
          playerAddress: address,
        }),
        getIndexerState(c.env),
      ]);
      const payload = {
        success: true,
        window: page.window,
        generatedAt: page.generatedAt,
        windowRange: page.windowRange,
        pagination: {
          limit: page.limit,
          offset: page.offset,
          total: page.total,
          nextOffset: page.nextOffset,
        },
        entries: page.entries,
        me: page.me,
        ingestion: {
          lastSyncedAt: ingestion?.lastSyncedAt ?? null,
          latestBlock: ingestion?.latestBlock ?? null,
          totalEvents: ingestion?.totalEvents ?? 0,
        },
      };
      const cacheControl = address ? LEADERBOARD_PRIVATE_CACHE_CONTROL : LEADERBOARD_CACHE_CONTROL;
      const etag = await etagFor(
        JSON.stringify({ ...payload, generatedAt: null, windowRange: null }),
      );
      if (c.req.header("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { "Cache-Control": cacheControl, ETag: etag },
        });
      }
      c.header("Cache-Control", cacheControl);
      c.header("ETag", etag);
      return c.json(payload);
    } catch (error) {
      console.error(`[leaderboard] GET / error: ${safeErrorMessage(error)}`);
      return jsonError(c, 503, "leaderboard temporarily unavailable");
    }
  });

  // GET /api/leaderboard/player/:address?runs_limit&runs_offset
  router.get("/player/:address", async (c) => {
    const retry = readLimiter.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const address = normalizeAddress(c.req.param("address"));
    if (!address) {
      return jsonError(c, 400, "invalid player address");
    }
    try {
      const player = await getPlayer(c.env, address, {
        limit: clampInt(c.req.query("runs_limit"), 25, 1, 100),
        offset: clampInt(c.req.query("runs_offset"), 0, 0, MAX_LEADERBOARD_OFFSET),
      });
      c.header("Cache-Control", LEADERBOARD_PRIVATE_CACHE_CONTROL);
      return c.json({ success: true, player: { address, ...player } });
    } catch (error) {
      console.error(`[leaderboard] GET /player error: ${safeErrorMessage(error)}`);
      return jsonError(c, 503, "leaderboard temporarily unavailable");
    }
  });

  // PUT /api/leaderboard/player/:address/profile
  // Body: { pubkey, username, linkUrl, timestamp, signature }, signed with the
  // player's Ed25519 key over profileMessage(...).
  router.put("/player/:address/profile", async (c) => {
    const retry = writeLimiter.take(clientIp(c));
    if (retry > 0) {
      return rateLimited(c, retry);
    }
    const address = normalizeAddress(c.req.param("address"));
    if (!address) {
      return jsonError(c, 400, "invalid player address");
    }
    let body: Record<string, unknown>;
    try {
      const raw = await readBodyLimited(c.req.raw, MAX_PROFILE_BODY_BYTES);
      if (!raw) {
        return jsonError(c, 413, `profile body is larger than ${MAX_PROFILE_BODY_BYTES} bytes`);
      }
      body = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    } catch {
      return jsonError(c, 400, "body must be JSON");
    }
    const pubkey = parseFixedHex(typeof body.pubkey === "string" ? body.pubkey : null, 32);
    const signature = parseFixedHex(typeof body.signature === "string" ? body.signature : null, 64);
    if (!pubkey || !signature) {
      return jsonError(c, 400, "pubkey (32 bytes) and signature (64 bytes) are required as hex");
    }
    if (pubkeyAccountAddress(pubkey) !== address) {
      return jsonError(c, 403, "pubkey does not own this address");
    }
    const timestamp = typeof body.timestamp === "number" ? body.timestamp : Number.NaN;
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > PROFILE_SIGNATURE_MAX_SKEW_MS
    ) {
      return jsonError(c, 400, "timestamp must be the current time in ms");
    }
    const username = sanitizeUsername(body.username);
    if (username === undefined) {
      return jsonError(
        c,
        400,
        "username must be 1-32 characters: letters, digits, space, _ . @ # -",
      );
    }
    const linkUrl = sanitizeLinkUrl(body.linkUrl);
    if (linkUrl === undefined) {
      return jsonError(c, 400, "linkUrl must be an http(s) URL of at most 240 characters");
    }

    let networkHash: string;
    try {
      networkHash = (await chainContext(c.env)).networkHash;
    } catch (error) {
      console.error(`[leaderboard] chain unavailable: ${safeErrorMessage(error)}`);
      return jsonError(c, 503, "chain is not available");
    }
    const message = profileMessage({
      networkHash,
      playerAddress: address,
      timestamp,
      username,
      linkUrl,
    });
    if (!(await verifyEd25519(pubkey, message, signature))) {
      return jsonError(c, 403, "profile signature does not verify");
    }

    const written = await upsertProfile(c.env, {
      playerAddress: address,
      playerPubkey: bytesToHex(pubkey),
      username,
      linkUrl,
      signedAt: timestamp,
    });
    if (!written) {
      return jsonError(c, 409, "this profile update or a newer one was already applied");
    }
    return c.json({ success: true, profile: await getProfile(c.env, address) });
  });

  return router;
}
