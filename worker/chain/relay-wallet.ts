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
import { blockTimeReader } from "./block-time";
import type { ChainClient } from "./network";

export function createRelayWallet(client: ChainClient, secret: Uint8Array) {
  return createWalletClient({
    client,
    account: createPubkeyAccount({ signer: new PrivateKeySigner(secret) }),
  });
}

export type RelayWallet = ReturnType<typeof createRelayWallet>;

export function relayChain(client: ChainClient, wallet: RelayWallet): RelayChain {
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
    blockTimeMs: blockTimeReader(client),
  };
}
