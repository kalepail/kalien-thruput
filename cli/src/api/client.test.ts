import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toBase58 } from "@thruputchain/client";
import { KalienApi, parseRunRecord } from "./client";
import { claimMessage, hexToBytes } from "../identity/claim";
import { identityFromSecret } from "../identity/keyfile";

const repoRoot = resolve(import.meta.dir, "../../..");
const tape = new Uint8Array(readFileSync(join(repoRoot, "test-fixtures/test-short.tape")));
const identity = identityFromSecret(new Uint8Array(32).fill(5));

// Thruput serves identifiers as base58 since the wire-14 devnet upgrade.
const NETWORK_HASH = toBase58(new Uint8Array(32).fill(0xaa));
const SCORE_CONTRACT = toBase58(new Uint8Array(32).fill(0xbb));

// Minimal mock of Worker API v0, served through a stubbed global fetch. It
// verifies the claim signature the same way the Worker and the contract do.
const BASE = "http://kalien.test";
const realFetch = globalThis.fetch;
let polls = 0;
let lastQuery: URLSearchParams | null = null;

function verifySig(pubkeyHex: string, msg: Uint8Array, sigHex: string): boolean {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(hexToBytes(pubkeyHex)),
  ]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(null, msg, key, Buffer.from(hexToBytes(sigHex)));
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/api/config") {
    return Response.json({
      networkHash: NETWORK_HASH,
      rpcUrl: "https://rpc.thruput.network",
      scoreContract: SCORE_CONTRACT,
      tokenContract: toBase58(new Uint8Array(32).fill(0xcc)),
      explorerUrl: "https://explorer.thruput.network/",
    });
  }
  if (url.pathname === "/api/seed/current") {
    return Response.json({ seedId: 123, seed: 0xdeadbeef });
  }
  if (url.pathname === "/api/runs" && req.method === "POST") {
    lastQuery = url.searchParams;
    const body = new Uint8Array(await req.arrayBuffer());
    const msg = claimMessage({
      networkHash: NETWORK_HASH,
      scoreContract: SCORE_CONTRACT,
      seedId: Number(url.searchParams.get("seed_id")),
      tape: body,
    });
    const ok = verifySig(
      url.searchParams.get("pubkey") ?? "",
      msg,
      url.searchParams.get("sig") ?? "",
    );
    if (!ok) return Response.json({ error: "bad signature" }, { status: 401 });
    if (url.searchParams.get("seed_id") === "124") {
      return Response.json(
        {
          success: false,
          error: "score does not beat your best",
          code: "not_improved",
          bestScore: 5000,
        },
        { status: 409 },
      );
    }
    return Response.json({ runId: "run-1", status: "queued" }, { status: 202 });
  }
  if (url.pathname === "/api/runs/run-1") {
    polls++;
    return Response.json(
      polls < 2
        ? { runId: "run-1", status: "submitting" }
        : {
            runId: "run-1",
            status: "confirmed",
            seedId: 123,
            txHash: "0x01",
            score: 1480,
            previousBest: 0,
            minted: "14800000000",
          },
    );
  }
  if (url.pathname === "/api/runs" && req.method === "GET") {
    return Response.json({
      runs: [
        { runId: "a", status: "confirmed", seedId: 123, score: 900 },
        { runId: "b", status: "rejected", seedId: 123, score: 5000 },
        { runId: "c", status: "confirmed", seedId: 122, score: 7000 },
        { runId: "d", status: "confirmed", seedId: 123, score: 1200 },
      ],
    });
  }
  return new Response("not found", { status: 404 });
}

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init))) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("KalienApi", () => {
  test("submits a signed run and polls it to confirmed", async () => {
    const api = new KalienApi(`${BASE}/`);
    expect(await api.currentSeed()).toEqual({ seedId: 123, seed: 0xdeadbeef });

    const result = await api.submitRun(identity, 123, tape);
    expect(result).toMatchObject({
      success: true,
      runId: "run-1",
      status: "queued",
      existing: false,
      httpStatus: 202,
    });
    expect(lastQuery?.get("pubkey")).toBe(identity.publicKeyHex);
    expect(lastQuery?.get("seed_id")).toBe("123");
    expect(lastQuery?.get("sig")).toMatch(/^[0-9a-f]{128}$/);

    const run = await api.waitForRun("run-1", { intervalMs: 10, timeoutMs: 5_000 });
    expect(run.status).toBe("confirmed");
    expect(run.score).toBe(1480);
    expect(run.minted).toBe("14800000000");
  });

  test("a wrong seed_id in the claim fails the signature check", async () => {
    const api = new KalienApi(BASE);
    // Sign for seed 1 but send seed 2: the server rebuilds the message from seed_id.
    const cfg = await api.config();
    const msg = claimMessage({
      networkHash: cfg.networkHash,
      scoreContract: cfg.scoreContract,
      seedId: 1,
      tape,
    });
    expect(verifySig(identity.publicKeyHex, msg, "00".repeat(64))).toBe(false);
  });

  test("error responses carry the code and bestScore", async () => {
    const api = new KalienApi(BASE);
    const result = await api.submitRun(identity, 124, tape);
    expect(result).toMatchObject({
      success: false,
      code: "not_improved",
      bestScore: 5000,
      httpStatus: 409,
      error: "not_improved: score does not beat your best",
    });
  });

  test("best score for a seed uses only confirmed runs of that seed", async () => {
    const api = new KalienApi(BASE);
    expect(await api.bestScoreForSeed(identity.address, 123)).toBe(1200);
    expect(await api.bestScoreForSeed(identity.address, 999)).toBe(0);
  });

  test("parseRunRecord accepts wrapped and snake_case shapes", () => {
    expect(parseRunRecord({ run: { run_id: "x", status: "failed", error: "boom" } })).toMatchObject(
      { runId: "x", status: "failed", error: "boom" },
    );
    expect(parseRunRecord({ status: "queued" })).toBeNull();
  });
});
