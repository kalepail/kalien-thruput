import {
  blockHeight,
  createPubkeyAccount,
  createWalletClient,
  deserializeSignedTransaction,
  fromHex0x,
  gasAmount,
  hashFromHex,
  hashSignedTransaction,
  JsonRpcError,
  PrivateKeySigner,
  randomNonce,
  serializeSignedTransaction,
  ThruputRpcErrorCode,
  toHex0x,
} from "@thruputchain/client";
import type { BroadcastResult, RelayChain } from "../relay/engine";
import { safeErrorMessage } from "../utils";
import type { ChainClient } from "./network";

/** Parses RELAY_SECRET: a 32-byte Ed25519 seed as hex, with or without 0x. */
export function parseRelaySecret(raw: string | undefined): Uint8Array {
  const clean = raw?.trim().replace(/^0x/iu, "") ?? "";
  if (!/^[0-9a-f]{64}$/iu.test(clean)) {
    throw new Error("RELAY_SECRET must be a 32-byte hex Ed25519 seed");
  }
  return fromHex0x(`0x${clean}`);
}

export function createRelayWallet(client: ChainClient, secret: Uint8Array) {
  return createWalletClient({
    client,
    account: createPubkeyAccount({ signer: new PrivateKeySigner(secret) }),
  });
}

export type RelayWallet = ReturnType<typeof createRelayWallet>;

const NANOS_PER_MS = 1_000_000n;

export function relayChain(client: ChainClient, wallet: RelayWallet): RelayChain {
  const blockTimes = new Map<bigint, number>();
  return {
    address: toHex0x(wallet.account.address),
    async tip() {
      return (await client.getChainTip()).height;
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
        txHash: toHex0x(hashSignedTransaction(signed)),
        signedTx: toHex0x(serializeSignedTransaction(signed)),
      };
    },
    async broadcast(signedTx): Promise<BroadcastResult> {
      try {
        await client.sendTransaction(deserializeSignedTransaction(fromHex0x(signedTx)));
        return { kind: "accepted" };
      } catch (error) {
        if (
          error instanceof JsonRpcError &&
          (error.code === ThruputRpcErrorCode.TxInvalid ||
            error.code === ThruputRpcErrorCode.TxRejected)
        ) {
          return { kind: "rejected", reason: safeErrorMessage(error) };
        }
        return { kind: "unknown", reason: safeErrorMessage(error) };
      }
    },
    receipt(txHash) {
      return client.getTransactionReceipt(hashFromHex(txHash));
    },
    status(txHash) {
      return client.getTransactionStatus(hashFromHex(txHash));
    },
    async blockTimeMs(height) {
      const cached = blockTimes.get(height);
      if (cached !== undefined) {
        return cached;
      }
      const block = await client.getBlockByNumber(height);
      if (!block) {
        throw new Error(`block ${height} not found`);
      }
      const ms = Number(block.blockTimepoint / NANOS_PER_MS);
      if (blockTimes.size > 256) {
        blockTimes.clear();
      }
      blockTimes.set(height, ms);
      return ms;
    },
  };
}
