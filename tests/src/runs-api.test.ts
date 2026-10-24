import { afterEach, describe, expect, it } from "bun:test";
import { toBase58 } from "@thruputchain/client";
import {
  getRun,
  isTerminalRunStatus,
  listRuns,
  parseRunRecord,
  RunApiError,
  submitRun,
} from "../../src/runs/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

const TX = toBase58(new Uint8Array(32).fill(0xab));

describe("parseRunRecord", () => {
  it("reads the API v0 camelCase shape", () => {
    const run = parseRunRecord({
      runId: "r1",
      status: "confirmed",
      txHash: TX,
      score: 1500,
      previousBest: 900,
      minted: "6000000000",
      error: null,
      seedId: 2999999,
    });
    expect(run).toMatchObject({
      runId: "r1",
      status: "confirmed",
      txHash: TX,
      score: 1500,
      previousBest: 900,
      minted: 6_000_000_000n,
      seedId: 2999999,
    });
  });

  it("reads snake_case and a nested run object", () => {
    const run = parseRunRecord({
      run: { run_id: "r2", status: "submitting", tx_hash: null, previous_best: 0, seed_id: "7" },
    });
    expect(run.runId).toBe("r2");
    expect(run.status).toBe("submitting");
    expect(run.seedId).toBe(7);
    expect(run.minted).toBeNull();
  });

  it("maps unknown statuses to queued and rejects missing ids", () => {
    expect(parseRunRecord({ runId: "r3", status: "mystery" }).status).toBe("queued");
    expect(() => parseRunRecord({ status: "queued" })).toThrow();
  });

  it("knows the terminal statuses", () => {
    expect(isTerminalRunStatus("confirmed")).toBe(true);
    expect(isTerminalRunStatus("rejected")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("queued")).toBe(false);
    expect(isTerminalRunStatus("submitting")).toBe(false);
  });
});

describe("runs API requests", () => {
  it("posts the raw tape with pubkey, seed_id and sig query params", async () => {
    let seenUrl = "";
    let seenBody: ArrayBuffer | null = null;
    mockFetch((url, init) => {
      seenUrl = url;
      seenBody = init?.body as ArrayBuffer;
      return Response.json({ runId: "r9", status: "queued" });
    });
    const run = await submitRun({
      tape: new Uint8Array([1, 2, 3]),
      pubkeyHex: "aa".repeat(32),
      seedId: 42,
      signatureHex: "bb".repeat(64),
    });
    expect(run.runId).toBe("r9");
    const url = new URL(seenUrl, "http://x");
    expect(url.pathname).toBe("/api/runs");
    expect(url.searchParams.get("pubkey")).toBe("aa".repeat(32));
    expect(url.searchParams.get("seed_id")).toBe("42");
    expect(url.searchParams.get("sig")).toBe("bb".repeat(64));
    expect(new Uint8Array(seenBody as unknown as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("surfaces the API error text", async () => {
    mockFetch(() => Response.json({ error: "score does not beat best" }, { status: 409 }));
    const error = await getRun("r1").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(RunApiError);
    expect((error as RunApiError).message).toBe("score does not beat best");
    expect((error as RunApiError).status).toBe(409);
  });

  it("lists runs from an object or a bare array", async () => {
    mockFetch(() =>
      Response.json({ runs: [{ runId: "a", status: "confirmed" }, { bad: 1 }], total: 1 }),
    );
    const page = await listRuns("0xplayer");
    expect(page.runs.map((run) => run.runId)).toEqual(["a"]);
    expect(page.total).toBe(1);

    mockFetch(() => Response.json([{ runId: "b", status: "failed" }]));
    expect((await listRuns("0xplayer")).runs[0]?.runId).toBe("b");
  });
});
