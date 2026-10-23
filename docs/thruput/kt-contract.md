# kt-contract report

Agent: `kt-contract`. Owns `kalien-contract/`, `shared/thruput/`, devnet keys and deploys.

## Status

All brief tasks are done.

1. Contracts `kalien_score` and `kalien_token` are written. 25 native tests and 6 RV32 tests pass.
2. `shared/thruput/` has `claim.ts`, test vectors, TS bindings, `deployments/devnet.json`, README.
3. The local-node integration test passes (deploy, 4 tapes, 3 rejections, events, balances).
4. Devnet: both contracts are deployed and linked. Four fixture tapes are confirmed on devnet,
   including the 36,000-frame, 911,140-point tape. `scripts/deploy-devnet.sh` repeats it all.
5. The relay secret is in `~/.config/kalien-thruput/relay.secret` (mode 600). Format below.

No chunked replay is necessary. One transaction replays a full 36,000-frame tape.

## Devnet deployment (2026-10-23)

| item | value |
|---|---|
| network hash | `0xb69ec9c688b3936b5bcbfc4eebc355d39aa9e5c6f6f072cc4a05564a07435047` |
| RPC | `https://rpc.thruput.network` |
| score contract | `0xed511226f0ac0d15c79d5ad85c086df105d08e93d7fa8c510b073b09e71ded81` |
| token contract | `0x6782bfd91f64afe26d540127e80d4c98842bfce8e43cb4b3ebb612a9f5ce4844` |
| admin (`kalien-deployer`) | `0xa5fdc7005f99e06d3c8c869e811d08b9a2fe7145627b4d9d31e81fd58528a100` |
| relay (`kalien-relay`) | `0xc954cc1b7aa81a3873c0baeabafd477a964a1850e6e392e4c74ecef5bf2abafd` |
| test player (`kalien-test-player`) | `0xc63641b2af03f929bd6715f15b1b9b30de390c76c03e76831f3c92320cf08280` |

Funding: deployer and relay got 1,000 HOG each from `groundhog_requestAirdrop`. Each contract
got 50 HOG for its storage deposits (about 0.0012 HOG per new storage item).

Deploy transactions: token `0x2577bd3d…8f97`, score `0x172ab2c0…9d46`,
`set_administrator` `0xc1624273…a964`. Full hashes: `shared/thruput/deployments/devnet.json`.

Fixture submissions on devnet (relay submits, test player signs). Results:
`kalien-contract/deployments/devnet-fixture-runs.json`.

| tape | seed_id | frames | score | gas used | gas limit | tx |
|---|---:|---:|---:|---:|---:|---|
| test-short | 2987989 | 700 | 1,480 | 1,504,343 | 4,540,000 | `0x06c499c58dbce0af71bdd57417739c32ee4c88881faf6b0ab800724fd86225eb` |
| test-medium | 2987989 | 5,000 | 11,190 | 9,750,461 | 14,000,000 | `0x603da7bef2c84585d7f289a089790fc349536856b70f526285bc7c18f5f69243` |
| test-real-game | 2987988 | 6,643 | 14,870 | 14,266,307 | 17,614,600 | `0x535dc6fd820ead1b0af3ec416b7edccfa53a790f995287606d61f04a9728ff76` |
| kalien-911140 | 2987987 | 36,000 | 911,140 | 67,385,636 | 82,200,000 | `0xd1e3acc9e95a667beaac1f47e12a07fb8bdafab3f9b6ffa57cb45c4447834876` |

Explorer links: `https://explorer.thruput.network/tx/<hash>` (the explorer asks for basic auth).
The test player holds 937,200 KALIEN (11,190 + 14,870 + 911,140; medium replaced short's best).

## Measured numbers

RV32 executor (`thruput test -p kalien_score`), whole `submit_score` call including signature
check, CRC, replay, storage and mint. Devnet and the local node give the same numbers + ~250 gas
(wallet root).

| tape | frames | bytes | gas |
|---|---:|---:|---:|
| test-short | 700 | 374 | 1,504,099 |
| test-medium | 5,000 | 2,524 | 9,749,860 |
| test-real-game | 6,643 | 3,346 | 14,266,047 |
| test-long | 36,000 | 18,024 | 74,293,156 |
| kalien-911140 | 36,000 | 18,024 | 67,385,376 |

- Gas per frame: about 1.87k–2.06k, plus about 0.2M fixed.
- Recommended wallet root gas limit: `3_000_000 + 2_200 * frame_count` (max 82.2M = 8.22 HOG of
  free balance in the sender). Gas is not burned.
- Memory, full `submit_score` path with an 18,024-byte tape: peak 54,272–55,296 bytes of 65,536
  (measured by lowering `initial_memory_bytes` until it faults: 55,296 passes, 54,272 fails).
  This counts the full 16 KiB stack reserve. The replay itself needs 4–8 KiB of stack
  (4 KiB faults, 8 KiB passes). Spare: about 10 KiB.
- Artifacts: `kalien_score.rv32a` 50,812 bytes (code 47,532), `kalien_token.rv32a` 27,248 bytes.

## What I changed

- Removed the Soroban contract (`kalien-contract/contracts/asteroids_score`, scripts). Note: the
  staged deletion was swept into the kt-core commit `581dbfa` before the pathspec rule.
- `kalien-contract/` is a new Cargo workspace from the `thruput new` scaffold:
  - `contracts/kalien_token`: ERC20 (`thruput-erc20-if` 0.1.56) + `ERC20Metadata` + `KalienTokenAdmin`.
  - `contracts/kalien_score`: `implementation.rs` (contract), `claim.rs` (claim digest, address
    rule), `replay.rs` (container checks and replay behind one small interface).
  - `fixtures/`: copies of the 5 tapes used by the tests (so `test-fixtures/` cleanup cannot break them).
  - `scripts/`: `build.sh`, `test.sh`, `deploy-devnet.sh`, `kalien.ts` (deploy, seeds, submit,
    fixtures, integration), `gen-claim-vectors.ts`, `env.sh`, `bun-shim.d.ts`; `tsconfig.json`.
- `shared/thruput/`: `claim.ts`, `claim.test.ts`, `claim-vectors.json`, `bindings/*.ts`,
  `deployments/devnet.json`, `README.md`.
- `docs/thruput/PORT-PLAN.md`: "Interface v0" is now "Interface v1" (only that section).

## Design decisions

- `current_seed()` is a view and cannot write. So `ensure_current_seed()` (a transaction) creates
  the seed. `current_seed()` returns `None` until then.
- `set_seed(seed_id, seed)` (admin, active epoch without a seed) exists so fixed-seed fixture tapes
  can be replayed on devnet. It lets the admin choose a seed for an empty epoch. That is
  acceptable on devnet. Remove it for a production deploy if this trust is not wanted.
- Cheap checks run before the replay: seed, container, claimed score > previous best, duplicate
  tape, signature. A bad submission costs little gas.
- The player signs the 32-byte digest, not the 115-byte preimage.
- Rewards go to the nonce-0 pubkey account of `player_pubkey`, the address that
  `createPubkeyAccount({ signer })` gives the browser wallet. Checked three ways: Rust vector
  test, TS test against `derivePubkeyAccountAddress` and `createPubkeyAccount`, and the
  `thruput keys generate` output for the three devnet keys.
- Token admin hand-off: the token cannot know the score address before the score deploy, so the
  deployer initializes it as admin and then calls `set_administrator(score)`.
- Duplicate tapes: `sha256(tape)` is global. A copied public tape cannot be claimed by another
  player. A front-runner who sees a tape in the mempool before it lands could still claim it
  first. That is acceptable on devnet.

## How I tested (commands and results)

```bash
kalien-contract/scripts/test.sh
#  cargo test --workspace              -> 25 passed
#  thruput test -p kalien_score        -> 6 passed (prints GAS lines above)
#  bun test shared/thruput/claim.test.ts -> 10 pass
node_modules/.bin/tsc -p kalien-contract/tsconfig.json   # clean
bun kalien-contract/scripts/kalien.ts integration --rpc http://127.0.0.1:9645
#  -> INTEGRATION PASSED (kalien-contract/deployments/local-integration.json)
kalien-contract/scripts/deploy-devnet.sh   # -> table above
```

Native tests cover: exact replay of all 5 fixtures, events and mint amounts, improvement-only
minting, per-player and per-epoch bests, bad signature (wrong key, wrong epoch, wrong network,
wrong contract, flipped bit), wrong seed, unknown seed, inactive seed (window edge), zero score,
not improved, duplicate tape from another player, paused / unpause / non-admin, bad magic,
version, rules tag, reserved bytes, CRC (footer and body), truncated, too short, too many frames,
footer score above the replay, seed creation and its rules, claim-message view, vectors, token
mint authority, metadata, transfer, admin change, double initialize.

Not tested: `RuleViolation` and `FrameCountMismatch`. Inputs alone cannot make the deterministic
sim break its own rules, and the replay always runs exactly `frame_count` frames.

## For the Worker agent

- Load the relay key as the secret `RELAY_SECRET`:
  `wrangler secret put RELAY_SECRET < ~/.config/kalien-thruput/relay.secret`.
  Format: 64 lowercase hex characters, no `0x`, no newline: the 32-byte Ed25519 seed.
  Use it as `createPubkeyAccount({ signer: new PrivateKeySigner(fromHex(env.RELAY_SECRET)), nonce: 0n })`.
  The address must be `0xc954cc1b7aa81a3873c0baeabafd477a964a1850e6e392e4c74ecef5bf2abafd`.
  The relay holds about 1,000 HOG.
- Submit path: see `submit()` in `kalien-contract/scripts/kalien.ts` and `shared/thruput/README.md`.
  Gas limit `3_000_000 + 2_200 * frames`. Read the `ScoreSubmitted` event with
  `kalien_score.v0_1.implementation.ScoreSubmitted.allFromReceipt(receipt, { contractAddress })`.
  On failure, `TransactionExecutionError.receipt.abortData` holds the `ScoreError`
  (`SCORE_ERRORS` table in `kalien.ts`).
- Pre-checks before you spend a submission: `seed(seed_id)`, `is_seed_active`, `best_score`,
  `is_claimed(sha256(tape))`, and verify the signature off-chain over `claimMessage(...)`.
- Cron: call `ensure_current_seed()` once per epoch (any funded key; the relay works).
  `current_seed()` (view) returns `None` until then. Index `ScoreSubmitted` with
  `client.getContractEvents({ event, contractAddresses: [score] })`; the integration test shows it.
- Two submissions for the same player and epoch in one block conflict (same `best` slot). One is
  returned to the mempool and runs again in a later block, where it may fail `NotImproved`.

## For the client agent

- Sign `claimMessage({ networkHash, scoreContract, seedId, tape })` from `shared/thruput/claim.ts`
  with the browser Ed25519 key. Send `pubkey`, `seed_id`, `signature` (hex) to the Worker.
- The KALIEN balance: `ERC20.v0_1.getBalanceOf.view({ client, contract: tokenContract, args: { addr } })`
  from `shared/thruput/bindings/kalien-token.ts`; 7 decimals.
- `claim.ts` imports `@noble/hashes/sha2.js`. It resolves today only as a transitive dependency
  of `@thruputchain/client`. Please add `@noble/hashes` (2.x) to the root `package.json`.
  `claim.test.ts` and `kalien.ts` also use `@noble/curves` (already installed transitively).

## Open issues and notes

- Local node: the CLI allows one managed `thruput node` per machine (PID file under
  `~/.cache/thruput`). I ran mine with `XDG_CACHE_HOME=$HOME/.cache/kalien-contract-node`
  (its `toolchain` is a symlink to the shared one). Starting it rewrote `[local_runtime_state]`
  in the global `~/.config/thruput/config.toml` to `http://127.0.0.1:9645`. The 9545 node was not
  running then. Another agent that starts `thruput node` rewrites it again. My scripts pass
  `--rpc` and do not depend on that entry.
- The sandbox blocks writes to `~/.cargo-thruput` and gpg commit signing; those commands need
  the sandbox off.
- `thruput airdrop` is not used. `groundhog_requestAirdrop` (through `client.requestAirdrop`)
  gave 1,000 HOG per call on devnet and 10 HOG on the local node.
- `shared/stellar/` is not mine. It is Soroban-only now; the coordinator can remove it.
- After a devnet wipe: run `kalien-contract/scripts/deploy-devnet.sh`. Then the Worker must
  pick up the new `shared/thruput/deployments/devnet.json` (network hash and addresses change).
