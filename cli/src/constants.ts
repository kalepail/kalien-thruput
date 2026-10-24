// Default Kalien Worker API. Override with --api-url or KALIEN_API_URL.
export const DEFAULT_API_URL = "https://thruput.kalien.xyz";

// Seed epoch length. Must match the score contract (seed_id = block_timestamp / 600).
export const SEED_INTERVAL_SECONDS = 600;

// Maximum number of tape submissions per seed_id interval (client-side budget).
export const MAX_SUBMISSIONS_PER_EPOCH = 10;

// Wait this long after finding a new best score before submitting.
// Gives the score time to stop climbing before we burn a submission slot.
export const SETTLE_DELAY_MS = 30_000;

// Maximum game frames before forcing a game-over (caps runaway games)
export const MAX_FRAMES = 36_000;

// Explorer workers restart from a random config after this many games without
// improvement, breaking out of local maxima.
export const EXPLORER_RESTART_THRESHOLD = 150;

export function currentSeedId(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / SEED_INTERVAL_SECONDS) >>> 0;
}
