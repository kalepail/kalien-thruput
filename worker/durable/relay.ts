import { DurableObject } from "cloudflare:workers";
import { chainContext } from "../chain/context";
import { createRelayWallet, parseRelaySecret, relayChain } from "../chain/relay-wallet";
import type { WorkerEnv } from "../env";
import { scoreEventRow } from "../leaderboard/indexer";
import { recordSeed, upsertScoreEvent } from "../leaderboard/store";
import { relayPolicy } from "../relay/policy";
import { RelayService } from "../relay/service";
import type { NewRun } from "../relay/store";
import { getTape } from "../tapes";
import { safeErrorMessage } from "../utils";

/**
 * Relay wallet. Holds RELAY_SECRET, and signs and submits `submit_score`
 * and `current_seed` transactions for one relay key. All calls for the key
 * go through this one object, so nonces and in-flight gas stay serialized.
 */
export class RelayDO extends DurableObject<WorkerEnv> {
  private readonly service: RelayService;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.service = new RelayService(
      ctx.storage.sql,
      async () => {
        const chain = await chainContext(env);
        const wallet = createRelayWallet(chain.client, parseRelaySecret(env.RELAY_SECRET));
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
          log: (message) => console.log(message),
        };
      },
      async (at) => {
        const current = await ctx.storage.getAlarm();
        if (current === null || current > at) {
          await ctx.storage.setAlarm(at);
        }
      },
    );
  }

  submitRun(run: NewRun) {
    return this.service.submitRun(run);
  }

  getRun(runId: string) {
    return this.service.getRun(runId);
  }

  listRuns(playerAddress: string, limit: number) {
    return this.service.listRuns(playerAddress, limit);
  }

  touchSeed(seedId: number) {
    return this.service.touchSeed(seedId);
  }

  status() {
    return this.service.status();
  }

  async alarm(): Promise<void> {
    await this.service.tick().catch((error: unknown) => {
      console.error(`[relay] tick failed: ${safeErrorMessage(error)}`);
    });
  }
}
