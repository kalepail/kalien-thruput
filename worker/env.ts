import type { RelayDO } from "./durable/relay";

export interface WorkerEnv {
  ASSETS: Fetcher;
  RELAY: DurableObjectNamespace<RelayDO>;
  TAPES: R2Bucket;
  LEADERBOARD_DB: D1Database;
  // Thruput network and contracts (vars; see shared/thruput/deployments/devnet.json)
  THRUPUT_RPC_URL?: string;
  THRUPUT_NETWORK_HASH?: string;
  SCORE_CONTRACT?: string;
  TOKEN_CONTRACT?: string;
  EXPLORER_URL?: string;
  // Relay keys, one per lane: comma-separated 32-byte Ed25519 seeds as hex (secret)
  RELAY_SECRETS?: string;
  // Relay gas and pacing (vars, all optional)
  RELAY_GAS_BASE?: string;
  RELAY_GAS_PER_FRAME?: string;
  RELAY_GAS_MAX?: string;
  RELAY_GAS_RETRY_MAX?: string;
  RELAY_WALLET_GAS_OVERHEAD?: string;
  RELAY_SEED_GAS?: string;
  RELAY_EXPIRY_BLOCKS?: string;
  RELAY_MAX_IN_FLIGHT?: string;
  // Leaderboard indexer
  LEADERBOARD_SYNC_ENABLED?: string;
  LEADERBOARD_SYNC_MAX_PAGES?: string;
  // Guards /api/admin/* (secret)
  DEV_API_KEY?: string;
}
