// A tab left open across a deploy still names the old lazy chunks (route pages),
// and the deploy removed them, so a later navigation fails to import its page.
// Reload once to fetch the new HTML and chunks. A sessionStorage guard stops a
// reload loop: a second failure soon after the reload shows the error instead.

export const CHUNK_RELOAD_KEY = "kalien:chunk-reload";
/** The guard is cleared this long after a good load, so a later deploy can reload again. */
export const CHUNK_RELOAD_CLEAR_MS = 10_000;

type GuardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ChunkReloadHost {
  addEventListener(type: string, listener: (event: Event) => void): void;
  setTimeout(handler: () => void, timeoutMs: number): unknown;
  location: { reload(): void };
  sessionStorage: GuardStorage;
}

function guardStorage(host: ChunkReloadHost): GuardStorage | null {
  try {
    return host.sessionStorage;
  } catch {
    return null;
  }
}

export function installChunkReload(host: ChunkReloadHost = window): void {
  const storage = guardStorage(host);

  host.addEventListener("vite:preloadError", (event) => {
    try {
      // No storage, or this tab already reloaded for a stale chunk: let the error show.
      if (storage === null || storage.getItem(CHUNK_RELOAD_KEY) !== null) {
        return;
      }
      storage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    host.location.reload();
  });

  host.addEventListener("load", () => {
    host.setTimeout(() => {
      try {
        storage?.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // Storage blocked: nothing to clear.
      }
    }, CHUNK_RELOAD_CLEAR_MS);
  });
}
