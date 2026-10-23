import { KalienApi, type ApiConfig } from "./api/client";
import { currentSeedId } from "./constants";

export interface CliPreflightResult {
  config: ApiConfig;
  warnings: string[];
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

/**
 * Check that the Worker API is reachable and serves a usable config before
 * workers start. A missing seed is only a warning: the run loop keeps polling.
 */
export async function runCliPreflight(api: KalienApi): Promise<CliPreflightResult> {
  const warnings: string[] = [];

  let config: ApiConfig;
  try {
    config = await api.config(true);
  } catch (error) {
    throw new Error(`API ${api.baseUrl} is not reachable: ${safeErrorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    const seed = await api.currentSeed(8_000);
    const localSeedId = currentSeedId();
    if (Math.abs(seed.seedId - localSeedId) > 1) {
      warnings.push(
        `API seed_id ${seed.seedId} differs from local clock seed_id ${localSeedId}; check the system clock`,
      );
    }
  } catch (error) {
    warnings.push(`current seed not available yet (${safeErrorMessage(error)}); will keep polling`);
  }

  return { config, warnings };
}
