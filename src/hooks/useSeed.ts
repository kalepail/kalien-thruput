import { useSyncExternalStore } from "react";
import { onThruputConfigChange } from "../thruput/config";

const SEED_PERIOD_MS = 600_000; // 10 minutes
const NULL_SEED_RETRY_MS = 3_000;
const MAX_NULL_SEED_RETRY_MS = 12_000;
/** Ignore offset samples closer than this to the current offset (second-level precision). */
const OFFSET_JITTER_MS = 1_500;

// Epoch math runs on the Worker's clock, not the local one. A local clock that is
// minutes off would otherwise never match the server seed_id (review item 6).
// `serverOffsetMs` is the server time minus the local time.
let serverOffsetMs = 0;

function serverNow(localNowMs = Date.now()): number {
  return localNowMs + serverOffsetMs;
}

export function seedIdAt(serverNowMs: number): number {
  return Math.floor(serverNowMs / SEED_PERIOD_MS);
}

function currentSeedId(localNowMs = Date.now()): number {
  return seedIdAt(serverNow(localNowMs));
}

function getSecondsUntilNext(localNowMs = Date.now()): number {
  const now = serverNow(localNowMs);
  const ms = SEED_PERIOD_MS - (now % SEED_PERIOD_MS);
  return Math.ceil(ms / 1000);
}

/**
 * Server clock minus local clock, from one `/api/seed/current` answer. The Worker
 * sends `secondsLeft = 600 - (floor(now_s) % 600)`, so its time is
 * `((seedId + 1) * 600 - secondsLeft) s` plus less than one second.
 */
export function estimateServerOffsetMs(
  seedId: number,
  secondsLeft: number,
  localNowMs: number,
): number {
  const serverMs = ((seedId + 1) * (SEED_PERIOD_MS / 1000) - secondsLeft) * 1000 + 500;
  return serverMs - localNowMs;
}

/** Keep the current offset unless the new sample differs by more than the jitter. */
export function nextServerOffsetMs(currentMs: number, sampleMs: number): number {
  return Math.abs(sampleMs - currentMs) > OFFSET_JITTER_MS ? sampleMs : currentMs;
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

// After a Futurenet reset the old epoch seeds belong to the old contract.
onThruputConfigChange(() => {
  seedCache = null;
  state = { seed: null, seedId: null, secondsLeft: getSecondsUntilNext() };
  notify();
  if (listeners.size > 0) {
    void refreshSeed();
  }
});

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
  let seedId = currentSeedId();

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
    if (response.ok && data) {
      // Sync to the Worker clock first, so epoch math agrees with the server.
      const serverSeedId = typeof data.seedId === "number" ? data.seedId : data.seed_id;
      const serverSecondsLeft =
        typeof data.secondsLeft === "number" ? data.secondsLeft : data.seconds_left;
      if (typeof serverSeedId === "number" && typeof serverSecondsLeft === "number") {
        serverOffsetMs = nextServerOffsetMs(
          serverOffsetMs,
          estimateServerOffsetMs(serverSeedId >>> 0, serverSecondsLeft, Date.now()),
        );
        observedSeedId = currentSeedId();
      }
      if (typeof serverSeedId === "number") {
        // The server's epoch is the truth, even without `secondsLeft`.
        seedId = serverSeedId >>> 0;
      }
    }
    const current = response.ok ? readSeedResponse(data) : null;
    if (current) {
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
