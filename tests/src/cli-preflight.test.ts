import { describe, expect, test } from "bun:test";
import type { ApiConfig, CurrentSeed, KalienApi } from "../../cli/src/api/client";
import { currentSeedId } from "../../cli/src/constants";
import { runCliPreflight } from "../../cli/src/preflight";

const CONFIG: ApiConfig = {
  networkHash: `0x${"11".repeat(32)}`,
  rpcUrl: "https://rpc.thruput.network",
  scoreContract: `0x${"22".repeat(32)}`,
  tokenContract: `0x${"33".repeat(32)}`,
  explorerUrl: "https://explorer.thruput.network/",
};

function fakeApi(opts: {
  config?: () => Promise<ApiConfig>;
  seed?: () => Promise<CurrentSeed>;
}): KalienApi {
  return {
    baseUrl: "http://kalien.test",
    config: opts.config ?? (async () => CONFIG),
    currentSeed: opts.seed ?? (async () => ({ seedId: currentSeedId(), seed: 0xdeadbeef })),
  } as unknown as KalienApi;
}

describe("runCliPreflight", () => {
  test("passes with no warnings when config and seed are served", async () => {
    const result = await runCliPreflight(fakeApi({}));
    expect(result.config).toEqual(CONFIG);
    expect(result.warnings).toEqual([]);
  });

  test("throws a clear error when the API is not reachable", async () => {
    const api = fakeApi({
      config: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await expect(runCliPreflight(api)).rejects.toThrow(
      /API http:\/\/kalien\.test is not reachable: connect ECONNREFUSED/,
    );
  });

  test("warns but passes when the seed is not available yet", async () => {
    const api = fakeApi({
      seed: async () => {
        throw new Error("seed not available yet");
      },
    });
    const result = await runCliPreflight(api);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("will keep polling");
  });

  test("warns when the API seed_id is far from the local clock", async () => {
    const api = fakeApi({ seed: async () => ({ seedId: currentSeedId() + 5, seed: 1 }) });
    const result = await runCliPreflight(api);
    expect(result.warnings[0]).toContain("check the system clock");
  });
});
