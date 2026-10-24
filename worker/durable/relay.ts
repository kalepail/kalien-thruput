import { DurableObject } from "cloudflare:workers";
import { chainContext } from "../chain/context";
import { createRelayWallet, relayChain } from "../chain/relay-wallet";
import type { WorkerEnv } from "../env";
import { scoreEventRow } from "../leaderboard/indexer";
import { recordSeed, upsertScoreEvent } from "../leaderboard/store";
import { relaySecrets } from "../relay/lanes";
import { relayPolicy } from "../relay/policy";
import { RelayService } from "../relay/service";
import type { NewRun, RunCursor, RunStatus } from "../relay/store";
import { getTape } from "../tapes";
import { safeErrorMessage } from "../utils";

const STALE_ALARM_MS = 10_000;

/**
 * One relay lane: one key from RELAY_SECRETS. It signs and submits
 * `submit_score` (and, on lane 0, `ensure_current_seed`) transactions. All
 * calls for the key go through this object, so its in-flight gas stays
 * bounded. Every call names the lane; the object keeps it for alarms.
 */
export class RelayDO extends DurableObject<WorkerEnv> {
  private readonly service: RelayService;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.service = new RelayService(
      ctx.storage.sql,
      async () => {
        const lane = this.lane();
        const secret = relaySecrets(env)[lane];
        if (!secret) {
          throw new Error(`RELAY_SECRETS has no entry for lane ${lane}`);
        }
        const chain = await chainContext(env);
        const wallet = createRelayWallet(chain.client, secret);
        return {
          chain: relayChain(chain.client, wallet),
          score: chain.score,
          policy: relayPolicy(env),
          loadTape: (runId) => getTape(env, runId),
          onConfirmed: async (confirmed) => {
            await upsertScoreEvent(
              env,
              scoreEventRow(confirmed.event, {
                txHash: confirmed.txHash,
                blockHeight: confirmed.blockHeight,
                closedAtMs: confirmed.closedAtMs,
                source: "relay",
              }),
            );
          },
          onSeed: (seedId, seed) => recordSeed(env, seedId, seed),
          now: Date.now,
          log: (message) => console.log(`[lane ${lane}] ${message}`),
        };
      },
      async (at) => {
        const current = await ctx.storage.getAlarm();
        // Keep an earlier alarm, unless it is overdue: then treat it as lost.
        if (current === null || current > at || current < Date.now() - STALE_ALARM_MS) {
          await ctx.storage.setAlarm(at);
        }
      },
    );
  }

  private lane(): number {
    const saved = this.service.store.getKv("lane");
    if (saved === null) {
      throw new Error("relay lane is not known yet");
    }
    return Number(saved);
  }

  private bind(lane: number): void {
    const saved = this.service.store.getKv("lane");
    if (saved === null) {
      this.service.store.setKv("lane", String(lane));
    } else if (Number(saved) !== lane) {
      throw new Error(`relay object for lane ${saved} was called as lane ${lane}`);
    }
  }

  submitRun(lane: number, run: NewRun) {
    this.bind(lane);
    return this.service.submitRun(run);
  }

  getRun(lane: number, runId: string) {
    this.bind(lane);
    return this.service.getRun(runId);
  }

  listRuns(
    lane: number,
    playerAddress: string,
    options: { limit: number; offset?: number; before?: RunCursor | null },
  ) {
    this.bind(lane);
    return this.service.listRuns(playerAddress, options);
  }

  retryFailed(lane: number, runId: string) {
    this.bind(lane);
    return this.service.retryFailed(runId);
  }

  runsByStatus(lane: number, statuses: RunStatus[], limit: number) {
    this.bind(lane);
    return this.service.runsByStatus(statuses, limit);
  }

  touchSeed(lane: number, seedId: number) {
    this.bind(lane);
    return this.service.touchSeed(seedId);
  }

  async status(lane: number) {
    this.bind(lane);
    await this.service.kick();
    return this.service.status();
  }

  kick(lane: number) {
    this.bind(lane);
    return this.service.kick();
  }

  async alarm(): Promise<void> {
    await this.service.tick().catch((error: unknown) => {
      console.error(`[relay] tick failed: ${safeErrorMessage(error)}`);
    });
  }
}
