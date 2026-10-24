# Thruput JSON-RPC: alpha migration guide

**Wire format 14.0.0 · Updated 21 October 2026**

## What you need to change

1. **Use a matching endpoint and SDK.** Confirm the URL and network with the team. Check `getVersionInfo.wireFormat` and `supportedMethods`, then verify `getNetworkInfo.networkHash` before signing. The TypeScript baseline for this guide is `@thruputchain/client` **0.22.1**.
2. **Replace `groundhog_*` calls with the names below.** Send one named `params` object, without a `request` or `query` wrapper. There is no automatic fallback to the old API.
3. **Separate admission from execution.** `sendTransaction` acknowledges admission. Observe commitment with `getTransactionStatus`, then inspect the receipt's nested `execution` result.
4. **Update simulation and event fields.** Simulation uses `address`, `assumedAuth` and `minStateBlockHeight`. Event filters use `addresses`; emitted events use `address`.
5. **Update pagination.** Start explicitly, preserve cursors and continue until `nextCursor` is `null`, even after an empty page.

This is a breaking contract update, not an endpoint rollout announcement. Methods whose names stay the same still have new request or response shapes.

## Complete method map

Old names omit the `groundhog_` prefix. New names are exact wire names. `?` means optional: omit the member when unused.

| Old suffix | New method | `params` | Result |
| --- | --- | --- | --- |
| `version` | `getVersionInfo` | `{}` | `wireFormat`, `supportedMethods`, implementation and optional release diagnostics |
| `networkInfo` | `getNetworkInfo` | `{}` | `{ networkHash }` |
| `chainTip` | `getChainTip` | `{}` | `{ blockHeight, blockHash }` |
| `chainConfig` | `getChainConfig` | `{}` | Chain configuration and observation provenance |
| `serverLimits` | `getServerLimits` | `{}` | Endpoint simulation and page limits |
| `sendRawTransaction` | `sendTransaction` | `{ signedTransaction }` | `{ transactionHash, admission: "accepted" }` |
| `getTransactionStatus` | `getTransactionStatus` | `{ transactionHash }` | Lifecycle observation; see below |
| `getTransactionReceipt` | `getTransactionReceipt` | `{ transactionHash }` | Receipt or `null` |
| `view` | `simulateInvocation` | `{ address, entrypoint, calldata, caller?, assumedAuth?, gasLimit?, minStateBlockHeight? }` | `{ stateBlockHeight, output, events, gasUsed }` |
| `viewBatch` | `simulateInvocations` | `{ invocations, minStateBlockHeight? }` | `{ stateBlockHeight, results }` |
| `getStorageAt` | `getStorage` | `{ address, key }` | `{ stateBlockHeight, item }`; `item` can be `null` |
| `getBalance` | `getBalance` | `{ address }` | `{ address, stateBlockHeight, rawBalance }` |
| `getAddressAuthData` | `getRegisteredAuth` | `{ address }` | `{ address, stateBlockHeight, configuration }`; configuration can be `null` |
| `getEvents` | `getEvents` | `{ filters, start?, cursor?, limit? }` | Event page, coverage bounds and `nextCursor` |
| `getTransactionsByAddress` | `getTransactionsByRootAddress` | `{ address, start?, cursor?, limit? }` | Transaction-reference page, coverage bounds and `nextCursor` |
| `getBlockByNumber` | `getBlockByHeight` | `{ blockHeight }` | Committed block metadata or `null` |
| `getTransactionsByBlock` | `getTransactionsByBlock` | `{ blockHeight, start?, cursor?, limit? }` | Transaction-reference page for one block |
| `requestAirdrop` | `faucet_requestAirdrop` | `{ recipient, clientNonce }` | Pending or succeeded funding attempt |
| `fundAccount` | `dev_fundAccount` | `{ recipient, rawAmount, clientNonce, faucet }` | Funding submission evidence |
| `pendingTransactionCount` | `dev_getPendingTransactionCount` | `{}` | `{ count }` |

The final three methods are optional faucet/local services. Check `supportedMethods` for availability; it describes configuration, not live health.

## Requests and encoding

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBalance",
  "params": { "address": "<base58-address>" }
}
```

Examples with `<…>` require real encoded values.

- Send **named objects**. Unknown fields, positional arguments and explicit `null` optional fields are rejected. Use `params: {}` for no-argument methods.
- Typed addresses, keys, hashes and signatures retain wire 13's **case-sensitive Base58**. Do not lowercase them or send C/G StrKey on the wire.
- Signed XDR, calldata, selectors, return/abort data, storage keys and raw event topics/data use **lowercase `0x` hex**. `"0x"` is empty bytes; selectors contain eight bytes.
- Heights, gas and balances use **canonical decimal strings** in JSON, including `"0"`. Page limits and event sequence numbers are JSON numbers. Follow the schema for each field.
- Preserve cursors exactly. Accept added response fields, but treat unfamiliar outcome variants as unsupported, never as success or retry permission.

An address identifies a contract instance, including a pubkey wallet account. Code is identified separately by deployment hash and type.

| Height field | Meaning |
| --- | --- |
| `blockHeight` | Committed block containing a transaction, or a selected block |
| `stateBlockHeight` | Committed snapshot used for a read or simulation |
| `minStateBlockHeight` | Minimum acceptable simulation snapshot |
| `attemptBlockHeight` | Height of an advisory failed attempt; not proof of commitment |
| `oldestIndexedBlockHeight`, `latestIndexedBlockHeight` | History coverage advertised by that response |

## Submit and inspect the receipt

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "sendTransaction",
  "params": { "signedTransaction": "0x<signed-XDR>" }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "transactionHash": "<base58-transaction-hash>",
    "admission": "accepted"
  }
}
```

`accepted` means admission, not commitment or successful execution. Before sending, retain the body `transactionHash`, exact signed bytes and expected network so you can recover from a lost response.

Poll `getTransactionStatus({ transactionHash })`:

| `status` | Meaning |
| --- | --- |
| `pending` | Retained by the scheduler. |
| `committed` | Commitment known; includes `blockHeight`. |
| `retry` | Scheduler retry observation, with `error`; not a client resubmission instruction. |
| `dropped` | Scheduler dropped observation, with `error`; not proof of nonexecution. |
| `recentFailure` | Advisory failed attempt, with `attemptBlockHeight` and `cause`. |
| `unknown` | No retained observation; not proof of nonexecution. |

`pending`, `retry` and `dropped` can also carry a `recentFailure` diagnostic, such as a storage conflict. It need not describe the latest attempt and does not authorize resubmission.

Read `getTransactionReceipt({ transactionHash })`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "transactionHash": "<base58-transaction-hash>",
    "blockHeight": "812",
    "execution": { "result": "return", "returnData": "0x" },
    "events": [],
    "gasUsed": "12700"
  }
}
```

Check `execution.result`: `return` has `returnData`; `abort` has `abortData`. Other outcomes include `fault`, `nonDeterministicError` and `failedGasSponsorship`. A committed receipt can describe failed execution. Events and gas remain alongside `execution`.

A `null` receipt after commitment can mean indexer lag. Preserve known commitment through later misses or timeouts. Backend failures remain errors, not `null`.

## Simulate an invocation

`simulateInvocation` replaces `view`: `contract` → `address`, `authClaim` → `assumedAuth`, and `minHeight` → `minStateBlockHeight`.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "simulateInvocation",
  "params": {
    "address": "<base58-address>",
    "entrypoint": "0x0102030405060708",
    "calldata": "0x",
    "gasLimit": "500000",
    "minStateBlockHeight": "812"
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "stateBlockHeight": "813",
    "output": { "result": "return", "returnData": "0x" },
    "events": [],
    "gasUsed": "12700"
  }
}
```

Simulation discards writes and returns `return`, `abort` or `fault`. It needs no footprint preparation and does not validate a full signed transaction or guarantee admission.

`minStateBlockHeight` is a freshness floor, not a historical selector or wait request. Use a receipt's `blockHeight` for a simulated read that must include that transaction. A stale snapshot returns `stateHeightUnavailable`.

`assumedAuth` skips signature verification; contract permission checks still run. For a root DefaultWallet simulation, target its address, supply matching assumed authorization and omit `caller`.

`simulateInvocations` takes `invocations` plus an optional batch-wide `minStateBlockHeight`. Each entry uses the single-invocation fields without its own freshness floor. Entries run independently at one snapshot, preserve input order and cannot see each other's writes. Ordinary HTTP batching does not guarantee a shared snapshot.

Read `getServerLimits` for gas and batch bounds. **Gas meters work; it is not a token fee or burn.** Storage collateral is separate. `getBalance.rawBalance` reports free native HOG in base units, excluding locked collateral.

## History and pagination

`getTransactionsByRootAddress` returns transactions sent by that root address, including DefaultWallet accounts. It excludes internal calls and incoming transfers. For incoming native transfers, query the token's Transfer event and destination topic.

Event filters use `addresses`; emitted events use `address`. Topics remain raw 32-byte hex, including address topics. Prefer typed event helpers.

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "getEvents",
  "params": {
    "filters": [{ "addresses": ["<base58-token-address>"] }],
    "start": {
      "order": "ascending",
      "anchor": { "kind": "atHeight", "blockHeight": "812" }
    },
    "limit": 50
  }
}
```

Ascending starts accept `atBeginning` or inclusive `atHeight`; descending starts accept `atEnd` or inclusive `atHeight`. Root-address history uses the same start shape, with `address` instead of `filters`.

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "events": [{
      "transactionHash": "<base58-transaction-hash>",
      "blockHeight": "812",
      "sequenceNumber": 0,
      "event": { "address": "<base58-token-address>", "topics": [], "data": "0x" }
    }],
    "nextCursor": null,
    "oldestIndexedBlockHeight": "1",
    "latestIndexedBlockHeight": "814"
  }
}
```

To continue, repeat the filters/address, pass `cursor: previousPage.nextCursor` and omit `start`. Exactly one of `start` and a nonempty `cursor` is required. Page size may change within endpoint limits.

**Only `nextCursor: null` ends the walk.** Empty pages can have continuations. Cursors fix the query's upper watermark; coverage bounds are not processed checkpoints. Complete all pages before recording completion. Do not silently restart on cursor errors or advance checkpoints after failures. After a network reset, discard old cursors and re-establish checkpoints.

Events sort by height, decoded transaction-hash bytes and sequence number, not execution order. Transaction pages contain `{ transactionHash, blockHeight }` references; fetch receipts for execution details.

For one block:

- `getBlockByHeight({ blockHeight: "812" })` returns metadata, not transaction bodies. It returns `null` outside indexed coverage, including height zero.
- `getTransactionsByBlock({ blockHeight: "812", start: { order: "ascending" }, limit: 50 })` pages that block. Repeat the height on continuation; replace `start` with `cursor`. There is no range anchor.
- An empty transaction page does not prove the block exists. Check its metadata. Backend failures remain errors.

## Errors and uncertain submissions

Handle `error.data.kind`, not message text. Common kinds include `invalidParams`, `invalidCursor`, `transactionInvalid`, `transactionRejected`, `stateHeightUnavailable`, `historyUnavailable`, `backendUnavailable`, `backendTimeout`, `overloaded` and `backendDataInvalid`. The schema lists codes and per-method error shapes.

Submission errors separately describe this attempt's `admission`: `notAttempted`, `rejected` or `unknown`.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32051,
    "message": "Backend timeout",
    "data": {
      "kind": "backendTimeout",
      "admission": "unknown",
      "transactionHash": "<base58-transaction-hash>"
    }
  }
}
```

For an uncertain send, query the saved hash first. A later refusal, expiry or dropped/unknown status does not prove nonexecution. Do not automatically change the nonce, extend expiry or sign a replacement. Any deliberate redispatch must retain approved bytes and account for network identity, validity and known commitment. SDK waiters only read; they never resubmit.

The SDK calls `faucet_requestAirdrop` once. Pending with a hash starts read-only receipt waiting; an error or pending without a hash stops the flow. Keep the original funding request and nonce.

## TypeScript integration

The SDK uses `Uint8Array` for identifiers and payloads, `bigint` for wide integers, and opaque strings for cursors. It handles wire encoding: use `812n` in TypeScript where JSON uses `"812"`. Package installation currently requires Thruput GitHub Packages access.

```ts
import { createThruputClient, HttpTransport } from "@thruputchain/client";

const client = await createThruputClient({
  transport: new HttpTransport("https://rpc.example.com"), // Replace with your endpoint.
  requiredMethods: ["sendTransaction", "getTransactionReceipt"],
});

const version = await client.getVersionInfo();
const network = await client.getNetworkInfo();
// Verify network.networkHash against your expected network before signing.

// signedTransaction is the approved XDR envelope as Uint8Array.
const { transactionHash } = await client.sendTransaction({ signedTransaction });
const receipt = await client.waitForTransactionReceipt(transactionHash);
// Inspect receipt.execution, or use assertTransactionSuccess from the SDK.
// A receipt can contain failed execution.
```

This sketch assumes signing and persistence are handled by your application. Save the hash and approved bytes before sending.

`waitForCommitment` waits only for commitment. Generated contract `.view()` helpers remain available; `readViews` groups reads at one snapshot. Use `iterateEventPages`, `iterateTransactionsByRootAddress` and `iterateTransactionsByBlock` for page walks.

## Reference

Exact schemas and SDK details below require repository access.

- [Generated wire-14 OpenRPC schema](https://github.com/thruputchain/thruput-tools/blob/332eb3affe8dd5672c177c4bf9ed9dccf8925fb9/crates/json-rpc/open-rpc-spec/snapshots/thruput-spec.json): full request, result and per-method error schemas.
- [Native method catalog](https://github.com/thruputchain/thruput-tools/blob/332eb3affe8dd5672c177c4bf9ed9dccf8925fb9/crates/json-rpc/json-rpc-api/src/native.rs).
- [TypeScript client guide](https://github.com/thruputchain/thruput-sdk-ts/blob/2d2dd508a999dcecee05116e082c58560dbb1015/README.md).
