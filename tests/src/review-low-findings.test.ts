import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { toBase58 } from "@thruputchain/client";
import {
  getThruputConfig,
  onThruputConfigChange,
  refreshThruputConfig,
  resetThruputConfigForTests,
} from "../../src/thruput/config";
import { nextPollStep, RUN_POLL_MAX_MS } from "../../src/hooks/useRunSubmission";
import { decideEndlessSubmit } from "../../src/runs/endlessGate";
import { resolveDevProxies } from "../../vite.config";

const id = (fill: number) => toBase58(new Uint8Array(32).fill(fill));

function configBody(networkFill: number, scoreFill: number) {
  return {
    success: true,
    networkHash: id(networkFill),
    rpcUrl: "https://rpc.thruput.network",
    scoreContract: id(scoreFill),
    tokenContract: id(0x22),
    explorerUrl: "https://explorer.thruput.network",
  };
}

describe("item 14: stale network config after a Futurenet reset", () => {
  const realFetch = globalThis.fetch;
  let unsubscribe: (() => void) | null = null;
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    globalThis.fetch = realFetch;
    resetThruputConfigForTests();
  });

  it("detects a new network hash or score contract and notifies subscribers", async () => {
    resetThruputConfigForTests();
    let body = configBody(0xaa, 0x11);
    globalThis.fetch = (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;
    const seen: string[] = [];
    unsubscribe = onThruputConfigChange((config) => seen.push(config.scoreContract));

    expect((await getThruputConfig()).networkHash).toBe(id(0xaa));
    expect(await refreshThruputConfig()).toBe(false);
    expect(seen).toEqual([]);

    body = configBody(0xbb, 0x33);
    expect(await refreshThruputConfig()).toBe(true);
    expect(seen).toEqual([id(0x33)]);
    expect((await getThruputConfig()).networkHash).toBe(id(0xbb));

    body = configBody(0xbb, 0x44);
    expect(await refreshThruputConfig()).toBe(true);
    expect(seen).toEqual([id(0x33), id(0x44)]);
  });
});

describe("item 15: run-status polling ends", () => {
  it("stops on 404", () => {
    const step = nextPollStep({ errorStatus: 404, consecutiveErrors: 1, elapsedMs: 1_000 });
    expect(step.action).toBe("stop");
  });

  it("backs off on errors, up to 60 s", () => {
    const delays = [1, 2, 3, 4, 5, 10].map((n) => {
      const step = nextPollStep({ errorStatus: 503, consecutiveErrors: n, elapsedMs: 1_000 });
      return step.action === "poll" ? step.delayMs : -1;
    });
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it("polls fast after a good answer and stops after the time limit", () => {
    expect(nextPollStep({ errorStatus: null, consecutiveErrors: 0, elapsedMs: 10_000 })).toEqual({
      action: "poll",
      delayMs: 2_000,
    });
    expect(
      nextPollStep({ errorStatus: null, consecutiveErrors: 0, elapsedMs: RUN_POLL_MAX_MS }).action,
    ).toBe("stop");
    expect(
      nextPollStep({ errorStatus: 0, consecutiveErrors: 2, elapsedMs: RUN_POLL_MAX_MS + 1 }).action,
    ).toBe("stop");
  });
});

describe("item 16: endless gate counts only confirmed scores", () => {
  const statusOf = (status: string | null) => () =>
    Promise.resolve(
      status as Parameters<typeof decideEndlessSubmit>[0]["getRunStatus"] extends (
        id: string,
      ) => Promise<infer S>
        ? S
        : never,
    );

  it("submits when the score beats the confirmed best and nothing is pending", async () => {
    const d = await decideEndlessSubmit({
      score: 900,
      confirmedBest: 500,
      pending: undefined,
      getRunStatus: statusOf(null),
    });
    expect(d.action).toBe("submit");
  });

  it("skips a score that does not beat the confirmed best", async () => {
    const d = await decideEndlessSubmit({
      score: 500,
      confirmedBest: 500,
      pending: undefined,
      getRunStatus: statusOf(null),
    });
    expect(d).toMatchObject({ action: "skip", reason: "not-better" });
  });

  it("skips a weaker score while a stronger run is still queued", async () => {
    for (const status of ["queued", "submitting"]) {
      const d = await decideEndlessSubmit({
        score: 700,
        confirmedBest: 0,
        pending: { score: 900, runId: "r1" },
        getRunStatus: statusOf(status),
      });
      expect(d).toMatchObject({ action: "skip", reason: "pending" });
    }
    const inFlight = await decideEndlessSubmit({
      score: 700,
      confirmedBest: 0,
      pending: { score: 900, runId: null },
      getRunStatus: statusOf(null),
    });
    expect(inFlight).toMatchObject({ action: "skip", reason: "pending" });
  });

  it("does not let a rejected or failed pending run block a weaker submit", async () => {
    for (const status of ["rejected", "failed", null]) {
      const d = await decideEndlessSubmit({
        score: 700,
        confirmedBest: 0,
        pending: { score: 900, runId: "r1" },
        getRunStatus: statusOf(status),
      });
      expect(d).toEqual({ action: "submit", clearPending: true });
    }
  });

  it("submits a score above the pending one without asking for its status", async () => {
    let asked = false;
    const d = await decideEndlessSubmit({
      score: 1_000,
      confirmedBest: 0,
      pending: { score: 900, runId: "r1" },
      getRunStatus: () => {
        asked = true;
        return Promise.resolve("queued");
      },
    });
    expect(d.action).toBe("submit");
    expect(asked).toBe(false);
  });
});

describe("item 17: dev proxies and CSP", () => {
  const env = {
    KALIEN_API_PROXY: "http://evil.example",
    KALIEN_RPC_PROXY: "http://evil.example",
  } as unknown as NodeJS.ProcessEnv;

  it("ignores proxy variables in a build", () => {
    expect(resolveDevProxies("build", env)).toEqual({ apiProxy: undefined, rpcProxy: undefined });
    expect(resolveDevProxies("serve", env)).toEqual({
      apiProxy: "http://evil.example",
      rpcProxy: "http://evil.example",
    });
    expect(resolveDevProxies("serve", {} as NodeJS.ProcessEnv)).toEqual({
      apiProxy: undefined,
      rpcProxy: undefined,
    });
  });

  it("ships a CSP that allows only self, the Futurenet RPC, and the music host", () => {
    const headers = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
    const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
    const directives = Object.fromEntries(
      csp.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }),
    );
    const deployment = JSON.parse(
      readFileSync(
        new URL("../../shared/thruput/deployments/futurenet.json", import.meta.url),
        "utf8",
      ),
    ) as { rpcUrl: string };
    expect(directives["script-src"]).toEqual(["'self'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["connect-src"]).toContain(new URL(deployment.rpcUrl).origin);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(headers).toMatch(/^\/\*$/m);
  });
});
