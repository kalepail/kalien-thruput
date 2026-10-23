import { safeErrorMessage } from "../utils";
import { RelayEngine, type RelayDeps } from "./engine";
import { RelayStore, type NewRun, type RunCursor, type RunStatus, type SqlLike } from "./store";
import { runView, type RunView } from "./view";

export type RelayEngineDeps = Omit<RelayDeps, "store">;

export interface RelayStatus {
  address: string | null;
  counts: Record<RunStatus, number>;
  seedTouch: { seedId: number; txHash: string } | null;
  lastError: string | null;
}

/**
 * Everything the relay Durable Object does, without the Durable Object
 * runtime. `schedule` sets the next alarm.
 */
export class RelayService {
  readonly store: RelayStore;
  private engine: Promise<RelayEngine> | null = null;
  private address: string | null = null;
  private ticking: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    sql: SqlLike,
    private readonly makeDeps: () => Promise<RelayEngineDeps>,
    private readonly schedule: (at: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new RelayStore(sql);
  }

  private getEngine(): Promise<RelayEngine> {
    this.engine ??= this.makeDeps()
      .then((deps) => {
        this.address = deps.chain.address;
        return new RelayEngine({ ...deps, store: this.store });
      })
      .catch((error: unknown) => {
        this.engine = null;
        throw error;
      });
    return this.engine;
  }

  async submitRun(run: NewRun): Promise<{ run: RunView; created: boolean }> {
    const result = this.store.enqueue(run, this.now());
    if (result.run.status === "queued") {
      await this.schedule(this.now());
    }
    return { run: runView(result.run), created: result.created };
  }

  getRun(runId: string): RunView | null {
    const run = this.store.getRun(runId);
    return run ? runView(run) : null;
  }

  /** One lane's page of a player's runs, plus that lane's total. */
  listRuns(
    playerAddress: string,
    options: { limit: number; offset?: number; before?: RunCursor | null },
  ): { runs: RunView[]; total: number } {
    return {
      runs: this.store.listByPlayer(playerAddress, options).map(runView),
      total: this.store.countByPlayer(playerAddress),
    };
  }

  async touchSeed(seedId: number): Promise<{ seed: number | null; txHash: string | null }> {
    const engine = await this.getEngine();
    const result = await engine.touchSeed(seedId);
    if (result.txHash) {
      await this.schedule(this.now());
    }
    return result;
  }

  async status(): Promise<RelayStatus> {
    try {
      await this.getEngine();
    } catch (error) {
      this.lastError = safeErrorMessage(error);
    }
    const touch = this.store.getSeedTouch();
    return {
      address: this.address,
      counts: this.store.countByStatus(),
      seedTouch: touch ? { seedId: touch.seedId, txHash: touch.txHash } : null,
      lastError: this.lastError,
    };
  }

  /**
   * Re-arms the alarm when work is pending. Alarms can be lost (for example
   * across a local restart), so the minute cron and health checks call this.
   */
  async kick(): Promise<boolean> {
    const { store } = this;
    const pending =
      store.submitting().length > 0 ||
      store.getSeedTouch() !== null ||
      (store.nextQueuedAt() ?? Number.POSITIVE_INFINITY) <= this.now();
    if (pending) {
      await this.schedule(this.now());
    }
    return pending;
  }

  /** Runs one tick unless one is already running. Schedules the next one. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return this.ticking;
    }
    this.ticking = (async () => {
      try {
        const engine = await this.getEngine();
        const { nextAt } = await engine.tick();
        this.lastError = null;
        if (nextAt !== null) {
          await this.schedule(nextAt);
        }
      } catch (error) {
        this.lastError = safeErrorMessage(error);
        // Try again soon; the chain or config may recover.
        await this.schedule(this.now() + 30_000);
        throw error;
      } finally {
        this.ticking = null;
      }
    })();
    return this.ticking;
  }
}
