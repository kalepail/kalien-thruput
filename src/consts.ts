// Frontend + browser runtime defaults and polling intervals.
// Keep operational literals here so they are easy to audit.

// Fallbacks only. The Worker's `/api/config` is the source of truth.
export const DEFAULT_THRUPUT_RPC_URL = "https://rpc.thruput.network";
export const DEFAULT_EXPLORER_URL = "https://explorer.thruput.network";

export const RUN_STATUS_INITIAL_POLL_DELAY_MS = 1_000;
export const RUN_STATUS_POLL_INTERVAL_MS = 2_000;
export const RUN_STATUS_ERROR_POLL_INTERVAL_MS = 5_000;

export const API_TIMEOUT_SUBMIT_RUN_MS = 30_000;
export const API_TIMEOUT_GET_RUN_MS = 10_000;
export const API_TIMEOUT_GET_TAPE_MS = 15_000;
export const API_TIMEOUT_LIST_RUNS_MS = 20_000;

export const HIGH_SCORE_THRESHOLD = 5_000;
export const AUTO_REFRESH_RUNS_MS = 15_000;
export const AUTO_REFRESH_LEADERBOARD_MS = 60_000;
export const RELATIVE_TIME_REFRESH_MS = 15_000;
export const BALANCE_REFRESH_MS = 30_000;
