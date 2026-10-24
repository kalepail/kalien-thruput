import {
  blockHeight,
  createPubkeyAccount,
  createWalletClient,
  Ed25519Signer,
  fromHex0x,
  gasAmount,
  hashFromBase58,
  hashSignedTransaction,
  NativeRpcError,
  randomNonce,
  serializeSignedTransaction,
  toBase58,
  toHex0x,
  type RpcTransactionReceipt,
  type RpcTransactionStatus,
} from "@thruputchain/client";
import type { BroadcastResult, RelayChain } from "../relay/engine";
import { safeErrorMessage } from "../utils";
import { blockTimeReader } from "./block-time";
import type { ChainClient } from "./network";
import type { ChainReceipt, ChainStatus, ExecutionOutcome } from "./types";

export function createRelayWallet(client: ChainClient, secret: Uint8Array) {
  return createWalletClient({
    client,
    account: createPubkeyAccount({ signer: Ed25519Signer.fromSeed(secret) }),
  });
}

export type RelayWallet = ReturnType<typeof createRelayWallet>;

/** The pubkey-account address (base58) a relay key signs as. */
export function relayAddress(secret: Uint8Array): string {
  return toBase58(createPubkeyAccount({ signer: Ed25519Signer.fromSeed(secret) }).address);
}

const OUTCOMES = new Set<string>([
  "return",
  "abort",
  "fault",
  "nonDeterministicError",
  "failedGasSponsorship",
]);

export function toChainReceipt(receipt: RpcTransactionReceipt): ChainReceipt {
  const execution = receipt.execution as { result?: unknown; abortData?: Uint8Array };
  const result = typeof execution.result === "string" ? execution.result : "other";
  return {
    txHash: toBase58(receipt.transactionHash),
    blockHeight: receipt.blockHeight,
    // Unfamiliar variants are never success.
    outcome: (OUTCOMES.has(result) ? result : "other") as ExecutionOutcome,
    abortData: result === "abort" ? (execution.abortData ?? null) : null,
    gasUsed: BigInt(receipt.gasUsed),
    raw: receipt,
  };
}

export function toChainStatus(status: RpcTransactionStatus): ChainStatus {
  const value = status as {
    status?: unknown;
    blockHeight?: bigint;
    error?: { source?: unknown; code?: number };
  };
  switch (value.status) {
    case "pending":
    case "unknown":
    case "recentFailure":
      return { status: value.status };
    case "committed":
      return { status: "committed", blockHeight: value.blockHeight ?? 0n };
    case "retry":
    case "dropped":
      return {
        status: value.status,
        error: { source: String(value.error?.source ?? "other"), code: value.error?.code ?? 0 },
      };
    default:
      return { status: "other" };
  }
}

/**
 * A send that failed. Only an error whose data says this attempt was
 * `rejected` (or never attempted) proves the bytes were not admitted now;
 * anything else is unknown.
 */
export function classifySendError(error: unknown): BroadcastResult {
  if (error instanceof NativeRpcError && error.decoded.classification === "known") {
    const data = error.decoded.data as { kind?: string; admission?: string };
    if (data.admission === "rejected" || data.admission === "notAttempted") {
      return { kind: "rejected", reason: `${data.kind ?? "rejected"}: ${safeErrorMessage(error)}` };
    }
    return { kind: "unknown", reason: `${data.kind ?? "error"}: ${safeErrorMessage(error)}` };
  }
  return { kind: "unknown", reason: safeErrorMessage(error) };
}

export function relayChain(client: ChainClient, wallet: RelayWallet): RelayChain {
  return {
    address: toBase58(wallet.account.address),
    async tip() {
      return (await client.getChainTip()).blockHeight;
    },
    async sign(invocation, gasLimit, expiryHeight) {
      const transaction = await wallet.prepareExecution({
        invocation,
        gasLimit: gasAmount(gasLimit),
        nonce: randomNonce(),
        blockExpiryHeight: blockHeight(expiryHeight),
      });
      const signed = await wallet.signTransaction(transaction);
      return {
        txHash: toBase58(hashSignedTransaction(signed)),
        signedTx: toHex0x(serializeSignedTransaction(signed)),
      };
    },
    async broadcast(signedTx): Promise<BroadcastResult> {
      try {
        const result = await client.sendTransaction({ signedTransaction: fromHex0x(signedTx) });
        return result.admission === "accepted"
          ? { kind: "accepted" }
          : { kind: "unknown", reason: "unsupported admission value" };
      } catch (error) {
        return classifySendError(error);
      }
    },
    async receipt(txHash) {
      const receipt = await client.getTransactionReceipt({
        transactionHash: hashFromBase58(txHash),
      });
      return receipt ? toChainReceipt(receipt) : null;
    },
    async status(txHash) {
      return toChainStatus(
        await client.getTransactionStatus({ transactionHash: hashFromBase58(txHash) }),
      );
    },
    blockTimeMs: blockTimeReader(client),
  };
}
