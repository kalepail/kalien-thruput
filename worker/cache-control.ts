// Default for mutation / error / unknown API responses.
export const API_CACHE_CONTROL = "no-store";

export const HEALTH_CACHE_CONTROL = "public, max-age=5, s-maxage=10";
export const CONFIG_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const SEED_CACHE_CONTROL = "public, max-age=5, s-maxage=5";

// Run status polling — very short TTL while in progress.
export const RUN_STATUS_CACHE_CONTROL = "public, max-age=2, s-maxage=2";
// Terminal runs never change.
export const RUN_TERMINAL_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=30";

// Tape binary — never changes once written to R2.
export const TAPE_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, immutable";

export const LEADERBOARD_CACHE_CONTROL =
  "public, max-age=5, s-maxage=15, stale-while-revalidate=30";
export const LEADERBOARD_PRIVATE_CACHE_CONTROL = "private, max-age=5, stale-while-revalidate=15";

// ---------------------------------------------------------------------------
// Fallback: sets "no-store" on responses that did not set their own header
// (e.g. POST, error responses, unknown routes).
// ---------------------------------------------------------------------------
export function applyApiCacheControl(response: Response): Response {
  if (response.headers.has("cache-control")) {
    return response;
  }

  try {
    response.headers.set("cache-control", API_CACHE_CONTROL);
    return response;
  } catch {
    // Some response objects (for example cached/fetched responses) expose
    // immutable headers. Re-wrap with copied headers before setting fallback.
    const headers = new Headers(response.headers);
    headers.set("cache-control", API_CACHE_CONTROL);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
