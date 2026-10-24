import { describe, expect, it } from "bun:test";
import { JsonRpcError, NativeRpcError, toBase58 } from "@thruputchain/client";
import { classifySendError, toChainReceipt, toChainStatus } from "../../worker/chain/relay-wallet";
import { addressToStrkey } from "@thruputchain/client";
import { normalizeAddressInput, normalizeId, parseId32 } from "../../worker/ids";

const hash = new Uint8Array(32).fill(7);

describe("wire-14 mapping", () => {
  it("maps receipt execution results; unknown variants are never success", () => {
    const base = { transactionHash: hash, blockHeight: 9n, events: [], gasUsed: 12n };
    const ok = toChainReceipt({
      ...base,
      execution: { result: "return", returnData: new Uint8Array() },
    } as never);
    expect(ok).toMatchObject({
      txHash: toBase58(hash),
      blockHeight: 9n,
      outcome: "return",
      abortData: null,
    });
    const abort = toChainReceipt({
      ...base,
      execution: { result: "abort", abortData: new Uint8Array([1, 2]) },
    } as never);
    expect(abort.outcome).toBe("abort");
    expect(abort.abortData).toEqual(new Uint8Array([1, 2]));
    expect(toChainReceipt({ ...base, execution: { result: "brandNew" } } as never).outcome).toBe(
      "other",
    );
  });

  it("maps statuses", () => {
    expect(toChainStatus({ status: "committed", blockHeight: 5n } as never)).toEqual({
      status: "committed",
      blockHeight: 5n,
    });
    expect(
      toChainStatus({ status: "dropped", error: { source: "scheduler", code: 3 } } as never),
    ).toEqual({
      status: "dropped",
      error: { source: "scheduler", code: 3 },
    });
    expect(toChainStatus({ status: "somethingNew" } as never)).toEqual({ status: "other" });
  });

  it("treats only rejected/notAttempted admission as a refusal", () => {
    const err = (data: unknown) =>
      new NativeRpcError(new JsonRpcError(-32001, "refused", data), "sendTransaction");
    expect(
      classifySendError(err({ kind: "transactionRejected", admission: "rejected" })).kind,
    ).toBe("rejected");
    expect(classifySendError(err({ kind: "backendTimeout", admission: "unknown" })).kind).toBe(
      "unknown",
    );
    expect(classifySendError(new Error("socket hang up")).kind).toBe("unknown");
  });

  it("parses ids as base58 or hex", () => {
    const b58 = toBase58(hash);
    expect(normalizeId(b58)).toBe(b58);
    expect(normalizeId(`0x${"07".repeat(32)}`)).toBe(b58);
    expect(parseId32("not-an-id")).toBeNull();
    expect(parseId32(toBase58(new Uint8Array(16).fill(1)))).toBeNull();
    // Legacy C StrKey addresses come out as base58; case is kept.
    expect(normalizeAddressInput(addressToStrkey(hash as never))).toBe(b58);
    expect(normalizeAddressInput(b58.toLowerCase())).not.toBe(b58);
  });
});
