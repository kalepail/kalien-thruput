import { useSyncExternalStore } from "react";

const SEED_PERIOD_MS = 600_000; // 10 minutes
const NULL_SEED_RETRY_MS = 3_000;
const MAX_NULL_SEED_RETRY_MS = 12_000;

function currentSeedId(nowMs = Date.now()): number {
  return Math.floor(nowMs / SEED_PERIOD_MS);
}

function getSecondsUntilNext(nowMs = Date.now()): number {
  const ms = SEED_PERIOD_MS - (nowMs % SEED_PERIOD_MS);
  return Math.ceil(ms / 1000);
}

interface SeedState {
  seed: number | null;
  seedId: number | null;
  secondsLeft: number;
}

interface SeedCurrentResponse {
  seedId?: number;
  seed_id?: number;
  seed?: number | null;
  secondsLeft?: number;
  seconds_left?: number;
}

function readSeedResponse(
  data: SeedCurrentResponse | null,
): { seedId: number; seed: number; secondsLeft: number | null } | null {
  if (!data) return null;
  const seedId = typeof data.seedId === "number" ? data.seedId : data.seed_id;
  if (typeof seedId !== "number" || typeof data.seed !== "number") return null;
  const secondsLeft =
    typeof data.secondsLeft === "number" ? data.secondsLeft : (data.seconds_left ?? null);
  return {
    seedId: seedId >>> 0,
    seed: data.seed >>> 0,
    secondsLeft:
      typeof secondsLeft === "number" && Number.isFinite(secondsLeft) ? secondsLeft : null,
  };
}

// Seed-id-aligned cache so the same seed is returned within one 10-minute interval.
let seedCache: { seedId: number; seed: number } | null = null;

let state: SeedState = {
  seed: null,
  seedId: null,
  secondsLeft: getSecondsUntilNext(),
};
const listeners = new Set<() => void>();
let countdownIntervalId: ReturnType<typeof setInterval> | null = null;
let nullRetryTimerId: ReturnType<typeof setTimeout> | null = null;
let fetchPending = false;
let observedSeedId = currentSeedId();
let missingSeedRetryMs = NULL_SEED_RETRY_MS;

function notify(): void {
  listeners.forEach((fn) => fn());
}

function clearNullRetry(): void {
  if (nullRetryTimerId !== null) {
    clearTimeout(nullRetryTimerId);
    nullRetryTimerId = null;
  }
}

function scheduleMissingSeedRetry(): void {
  if (listeners.size === 0) return;
  clearNullRetry();
  nullRetryTimerId = setTimeout(() => {
    void refreshSeed();
  }, missingSeedRetryMs);
  missingSeedRetryMs = Math.min(MAX_NULL_SEED_RETRY_MS, missingSeedRetryMs + 1_000);
}

async function refreshSeed(): Promise<void> {
  if (fetchPending) return;
  const seedId = currentSeedId();

  // Cache is fresh for this seed_id — no network call needed.
  if (seedCache?.seedId === seedId) {
    if (state.seed !== seedCache.seed) {
      state = {
        seed: seedCache.seed,
        seedId,
        secondsLeft: getSecondsUntilNext(),
      };
      notify();
    }
    return;
  }

  fetchPending = true;
  clearNullRetry();
  try {
    const response = await fetch("/api/seed/current", {
      method: "GET",
      cache: "no-store",
    });

    const data = (await response.json().catch(() => null)) as SeedCurrentResponse | null;
    const current = response.ok ? readSeedResponse(data) : null;
    if (current) {
      if (current.seedId !== seedId) {
        // The chain clock has not reached this epoch yet (or our clock is off).
        // The Worker cron creates each seed; retry until it matches.
        state = {
          seed: null,
          seedId: null,
          secondsLeft: getSecondsUntilNext(),
        };
        notify();
        scheduleMissingSeedRetry();
        return;
      }
      seedCache = { seedId, seed: current.seed };
      const secondsLeft =
        current.secondsLeft !== null
          ? Math.max(0, Math.ceil(current.secondsLeft))
          : getSecondsUntilNext();
      state = { seed: current.seed, seedId, secondsLeft };
      missingSeedRetryMs = NULL_SEED_RETRY_MS;
      notify();
    } else {
      const hasCurrentEpochSeed = state.seed !== null && state.seedId === seedId;
      if (hasCurrentEpochSeed) {
        state = { ...state, secondsLeft: getSecondsUntilNext() };
      } else {
        state = { seed: null, seedId: null, secondsLeft: getSecondsUntilNext() };
      }
      notify();
      scheduleMissingSeedRetry();
    }
  } catch {
    // Network error — invalidate stale seed if the epoch changed
    const currentEpochSeedId = currentSeedId();
    if (state.seedId !== null && state.seedId !== currentEpochSeedId) {
      state = { seed: null, seedId: null, secondsLeft: getSecondsUntilNext() };
    } else {
      state = { ...state, secondsLeft: getSecondsUntilNext() };
    }
    notify();
    scheduleMissingSeedRetry();
  } finally {
    fetchPending = false;
  }
}

// Tick countdown and detect epoch boundaries.
function tick(): void {
  const now = Date.now();
  const seedId = currentSeedId(now);
  const seedIdChanged = seedId !== observedSeedId;
  observedSeedId = seedId;

  if (seedIdChanged) {
    // New 10-minute seed_id started — invalidate cache and fetch the new seed
    // right away so the next game can start quickly.
    seedCache = null;
    clearNullRetry();
    missingSeedRetryMs = NULL_SEED_RETRY_MS;
    state = { seed: null, seedId: null, secondsLeft: getSecondsUntilNext(now) };
    notify();
    void refreshSeed();
  } else {
    state = { ...state, secondsLeft: getSecondsUntilNext(now) };
    notify();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    observedSeedId = currentSeedId();
    countdownIntervalId = setInterval(tick, 1000);
    void refreshSeed();
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      if (countdownIntervalId !== null) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
      }
      clearNullRetry();
    }
  };
}

function getSnapshot(): SeedState {
  return state;
}

export function useSeed(): SeedState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function getSeedSnapshot(): SeedState {
  return getSnapshot();
}

export function subscribeToSeed(cb: () => void): () => void {
  return subscribe(cb);
}
