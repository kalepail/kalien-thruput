import { describe, expect, it } from "bun:test";
import {
  CHUNK_RELOAD_CLEAR_MS,
  CHUNK_RELOAD_KEY,
  installChunkReload,
  type ChunkReloadHost,
} from "../../src/lib/chunkReload";

function fakeHost(store = new Map<string, string>()) {
  const listeners = new Map<string, (event: Event) => void>();
  const timers: Array<{ handler: () => void; ms: number }> = [];
  let reloads = 0;
  const host: ChunkReloadHost = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (handler, ms) => timers.push({ handler, ms }),
    location: { reload: () => (reloads += 1) },
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
  };
  const preloadError = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    listeners.get("vite:preloadError")?.(event);
    return event.defaultPrevented;
  };
  const load = () => listeners.get("load")?.(new Event("load"));
  return { host, store, timers, preloadError, load, reloads: () => reloads };
}

describe("installChunkReload", () => {
  it("reloads once on a stale chunk and sets the guard", () => {
    const t = fakeHost();
    installChunkReload(t.host);
    expect(t.preloadError()).toBe(true);
    expect(t.reloads()).toBe(1);
    expect(t.store.has(CHUNK_RELOAD_KEY)).toBe(true);
  });

  it("does not loop: a failure while the guard is set shows the error", () => {
    const t = fakeHost(new Map([[CHUNK_RELOAD_KEY, "1"]]));
    installChunkReload(t.host);
    expect(t.preloadError()).toBe(false);
    expect(t.reloads()).toBe(0);
  });

  it("clears the guard after a good load, so a later deploy can reload again", () => {
    const t = fakeHost(new Map([[CHUNK_RELOAD_KEY, "1"]]));
    installChunkReload(t.host);
    t.load();
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0].ms).toBe(CHUNK_RELOAD_CLEAR_MS);
    t.timers[0].handler();
    expect(t.store.has(CHUNK_RELOAD_KEY)).toBe(false);
    expect(t.preloadError()).toBe(true);
    expect(t.reloads()).toBe(1);
  });

  it("does not reload when sessionStorage is blocked", () => {
    const t = fakeHost();
    t.host.sessionStorage.setItem = () => {
      throw new Error("blocked");
    };
    installChunkReload(t.host);
    expect(t.preloadError()).toBe(false);
    expect(t.reloads()).toBe(0);
  });
});
