import { describe, expect, it } from "bun:test";
import deployment from "../../shared/thruput/deployments/devnet.json";
import { chainSettings } from "../../worker/chain/network";
import type { WorkerEnv } from "../../worker/env";

const env = (vars: Partial<WorkerEnv>) => vars as WorkerEnv;

describe("chainSettings", () => {
  it("defaults to the devnet deployment record", () => {
    const settings = chainSettings(env({ THRUPUT_RPC_URL: "", SCORE_CONTRACT: "" }));
    expect(settings.rpcUrl).toBe(deployment.rpcUrl);
    expect(settings.scoreContract).toBe(deployment.scoreContract.toLowerCase());
    expect(settings.tokenContract).toBe(deployment.tokenContract.toLowerCase());
    expect(settings.networkHash).toBe(deployment.networkHash.toLowerCase());
    expect(settings.explorerUrl.endsWith("/")).toBe(false);
  });

  it("lets vars override single fields", () => {
    const score = `0x${"ab".repeat(32)}`;
    expect(chainSettings(env({ SCORE_CONTRACT: score })).scoreContract).toBe(score);
  });

  it("drops devnet addresses for another RPC", () => {
    const settings = chainSettings(env({ THRUPUT_RPC_URL: "http://127.0.0.1:9745" }));
    expect(settings).toMatchObject({ scoreContract: null, tokenContract: null, networkHash: null });
  });
});
