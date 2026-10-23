import type { WorkerEnv } from "../env";
import { blockTimeReader } from "./block-time";
import {
  chainClient,
  chainSettings,
  clientNetworkHash,
  type ChainClient,
  type ChainSettings,
} from "./network";
import { createScoreContract, type ScoreContract } from "./score-contract";

export interface ChainContext {
  settings: ChainSettings;
  client: ChainClient;
  networkHash: string;
  score: ScoreContract;
  blockTimeMs(height: bigint): Promise<number>;
}

type ChainContextFactory = (env: WorkerEnv) => Promise<ChainContext>;

const defaultFactory: ChainContextFactory = async (env) => {
  const settings = chainSettings(env);
  if (!settings.scoreContract) {
    throw new Error("SCORE_CONTRACT is not configured");
  }
  const client = await chainClient(settings);
  return {
    settings,
    client,
    networkHash: clientNetworkHash(client),
    score: createScoreContract(client, settings.scoreContract),
    blockTimeMs: blockTimeReader(client),
  };
};

let factory: ChainContextFactory = defaultFactory;

export function chainContext(env: WorkerEnv): Promise<ChainContext> {
  return factory(env);
}

/** Test hook: replace the chain with a fake. Pass null to restore. */
export function setChainContextFactory(next: ChainContextFactory | null): void {
  factory = next ?? defaultFactory;
}
