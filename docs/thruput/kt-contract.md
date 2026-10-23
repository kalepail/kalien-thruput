# kt-contract report

Agent: `kt-contract`. Owns `kalien-contract/`, `shared/thruput/`, devnet keys and deploys.

## Status

Round 1 (contracts, shared TS, local node, devnet) and round 2 (read helpers, adversarial
review, hardened redeploy) are done.

- Contracts `kalien_score` and `kalien_token`: 34 native tests and 7 RV32 tests pass.
- `shared/thruput/`: `claim.ts`, `kalien.ts` (read, event and relay helpers), bindings,
  `deployments/devnet.json`. 25 bun tests pass offline; the live devnet test passes.
- **The score contract changed (interface v2) and is redeployed on devnet. New addresses
  below. The v1 contracts are superseded.** The Worker config must move to the v2 addresses.
- One transaction replays a full 36,000-frame tape. No chunked replay.

## Devnet deployment v2 (2026-10-23T22:37Z, current)

| item | value |
|---|---|
| network hash | `0xb69ec9c688b3936b5bcbfc4eebc355d39aa9e5c6f6f072cc4a05564a07435047` |
| RPC | `https://rpc.thruput.network` |
| score contract | `0x94204675c7a31180d05a494de80679ea9be84adee0ffaac1f2dcd03f4e5216bc` |
| token contract | `0xddf7dd05230d877cb3635392f5fde0af3f9eb0cf406f1a05146403710f98c0d8` |
| admin (`kalien-deployer`) | `0xa5fdc7005f99e06d3c8c869e811d08b9a2fe7145627b4d9d31e81fd58528a100` |
| relay (`kalien-relay`, the only allowed submitter) | `0xc954cc1b7aa81a3873c0baeabafd477a964a1850e6e392e4c74ecef5bf2abafd` |
| test player (`kalien-test-player`) | `0xc63641b2af03f929bd6715f15b1b9b30de390c76c03e76831f3c92320cf08280` |
| settings | `relay_only = true`, `seeding_locked = true`, `paused = false` |

Each contract got 50 HOG for storage deposits. Deployer ≈ 800 HOG, relay ≈ 1,000 HOG left.
Deploy and settings transactions: `shared/thruput/deployments/devnet.json` and the deploy log.

Fixture submissions on v2 (relay submits, test player signs;
`kalien-contract/deployments/devnet-fixture-runs.json`):

| tape | seed_id | frames | score | gas used | gas limit | tx |
|---|---:|---:|---:|---:|---:|---|
| test-short | 2987990 | 700 | 1,480 | 1,543,539 | 4,540,000 | `0xc9e31bca5fd07c09019a6819a073cf7d69d38d23ef35b2243d89da194832ade1` |
| test-medium | 2987990 | 5,000 | 11,190 | 9,789,657 | 14,000,000 | `0x6be974d9fcc50cbcc1668b8fbd83ce0155d9160f9d6742952c366c24821f3aea` |
| test-real-game | 2987989 | 6,643 | 14,870 | 14,305,513 | 17,614,600 | `0xe007c8de5fba380eb68645766e0612308c7ecd2500908f7ed00ee7b6f2d5083c` |
| kalien-911140 | 2987988 | 36,000 | 911,140 | 67,424,832 | 82,200,000 | `0x347593cd83c4b905f8249c57a90f0438aaaeed00c3ab9cce58db2fa81efa621b` |

Checks on v2 devnet: a submission from the deployer (not a relay) was rejected `NotRelay`
(79,296 gas, tx `0x572c0f035690357735010846576b6a154fca8672c2aaacec525c2a130db41f51`).
`set_seed` after the lock was rejected `SeedingLocked` (error 13).
Explorer: `https://explorer.thruput.network/tx/<hash>` (basic auth).

Superseded v1 (score `0xed51…ed81`, token `0x6782…4844`): its files are kept as
`kalien-contract/deployments/devnet-v1-*.json`. The offline test data
`shared/thruput/test-data/devnet-rpc.json` was recorded against v1 and is self-contained.

## Measured numbers

RV32 executor, the whole `submit_score` call (v2 code). Devnet adds about 250 gas (wallet root).

| tape | frames | bytes | gas |
|---|---:|---:|---:|
| test-short | 700 | 374 | 1,504,620 |
| test-medium | 5,000 | 2,524 | 9,750,381 |
| test-real-game | 6,643 | 3,346 | 14,266,578 |
| test-long | 36,000 | 18,024 | 74,293,677 |
| kalien-911140 | 36,000 | 18,024 | 67,385,897 |

Gas of each rejection with a full 18,024-byte tape (`rv32_rejection_gas`):

| rejection | gas |
|---|---:|
| `UnknownSeed` | 88,437 |
| `NotRelay` (devnet, short tape) | 79,296 |
| `TapeCrcMismatch` / `SeedMismatch` | ≈341,700 |
| `NotImproved` | 381,023 |
| `AlreadyClaimed` | 425,549 |
| `BadSignature` | 443,977 |
| `ScoreMismatch` (needs the full replay) | 74,207,545 |

- Wallet root gas limit: `3_000_000 + 2_200 * frame_count` (max 82.2M = 8.22 HOG free balance).
- Memory: peak 54–55 KiB of 64 KiB with an 18,024-byte tape (16 KiB stack reserve included).
- Storage deposits (devnet balances): about 0.0036 HOG on the score contract per accepted
  submission that creates a new best entry, plus about 0.002 HOG on the token per new holder.
  50 HOG covers about 14,000 such submissions.
- Artifacts: `kalien_score.rv32a` 54,788 bytes (code 51,436), `kalien_token.rv32a` 27,248 bytes.

## Shared helpers (`shared/thruput/kalien.ts`) — for kt-worker, kt-client, kt-cli

Pure fetch-based functions over `@thruputchain/client` 0.18.0. They run in a Worker, a
browser and Bun. Pass the parsed `deployments/devnet.json` as `config`.

- `connectKalien(config, { transport? })`: client pinned to `config.networkHash`. A wiped devnet
  throws `NetworkMismatchError`.
- Reads: `readPlayerState(client, config, player, seedId?)` (one snapshot: seed, active, best,
  KALIEN balance), `getBestScore`, `getCurrentSeed` (`null` before `ensure_current_seed`),
  `getSeed`, `getCurrentSeedId`, `isTapeClaimed(tape | {hash})`, `getKalienBalance`,
  `getTokenMetadata` (name, symbol, decimals, totalSupply), `getScoreConfig`, `isRelay`.
- Events (`groundhog_getEvents`): `getScoreSubmittedPage(client, config, { cursor, fromHeight,
  order, limit, player, seedId })` → `{ rows, cursor (0x hex, "0x" = exhausted), exhausted,
  latestBlock, oldestBlock }`. Rows: `txHash, blockHeight, sequenceNumber, player, playerPubkey,
  seedId, seed, frameCount, finalScore, previousBest, newBest, mintedDelta, tapeHash`.
  Identity is `(txHash, sequenceNumber)`. `iterateScoreSubmitted` walks pages. For the cron:
  store rows + cursor together; when exhausted, start a new walk with `fromHeight` = last stored
  row height and dedupe that block; alert if `oldestBlock` > your checkpoint.
- Relay writes: `createRelayWallet(client, env.RELAY_SECRET)`;
  `submitScore(wallet, config, { playerPubkey, seedId, tape, signature }, { onSigned, timeoutMs })`
  → `{ status: confirmed | rejected | failed | unknown, txHash, gasLimit, gasUsed, height,
  execResult, errorCode, errorName, run }`. `onSigned({ txHash, signedTx })` runs before broadcast:
  persist the hash there. On `unknown`, poll `getSubmitResult(client, config, txHash)`.
  `ensureCurrentSeed(wallet, config)` for the cron.
- Constants and checks: `submitGasLimit(frames)`, `SCORE_ERRORS`, `seedIdAt(unixSeconds)`,
  `tapePaddingOk(tape)` (pre-check for `TapeBadPadding`), `UNITS_PER_POINT`, `KALIEN_DECIMALS`.
- Tests: `bun test shared/thruput/` (offline, replays recorded devnet RPC);
  `KALIEN_LIVE=1 bun test shared/thruput/kalien.test.ts` (live devnet reads).
  `kalien-contract/scripts/record-rpc-fixtures.ts` re-records them.

Verified on devnet: `submitScore` confirmed `test-long.tape` (74,293,437 gas) and then rejected
the same tape again as `NotImproved` (380,901 gas); `onSigned` saw both hashes before broadcast.

## Adversarial review of `kalien_score`

Tests: `contracts/kalien_score/tests/adversarial.rs` (9), plus the rejection tests in `test.rs`
and `rv32_rejection_gas`.

| attack | result | evidence |
|---|---|---|
| Relay redirects the reward | Blocked. The reward address is derived from `player_pubkey`, and the signature must be by that key. The relay gets nothing. | `relay_cannot_redirect_the_reward` |
| Replay a signed claim in another epoch / network / contract | Blocked. The digest binds network hash, contract address and `seed_id`; the tape hash blocks reuse in the same contract. A second deployment rejects it. | `signed_claim_does_not_replay_*`, `rejects_bad_signature` |
| Exact copy of another player's tape | Blocked (`AlreadyClaimed`). | `rejects_duplicate_tape_from_another_player` |
| Copy with flipped padding bits (odd frame count) | **Was possible (16 encodings per game); fixed in v2** (`TapeBadPadding`). | `padding_nibble_variants_are_rejected` |
| Copy with a no-op input change | **Residual risk** (see below). | `residual_copycat_with_a_no_op_input_change_is_accepted` |
| Seed grinding through `ensure_current_seed` | **Was possible in v1**: the caller chooses the tx hash, so it could grind offline for a seed it had prepared tapes for. **Fixed in v2**: block height and nanosecond block timepoint enter the hash; the caller cannot know them in advance. | `derive_seed_matches_spec` |
| Admin `set_seed` abuse | **Reduced in v2**: `lock_seeding()` is one-way and the deploy calls it after the fixtures. Before the lock, and through `set_admin`/`set_paused`, the admin stays trusted. | `lock_seeding_disables_set_seed_for_good`, devnet check |
| Overflow in mint | Not possible. Max improvement `u32::MAX × 10^7` ≪ `i128::MAX`; the subtraction runs only after `final > previous`. Token supply uses checked `Balance`. | `mint_amount_cannot_overflow` |
| Gas griefing | Gas is not burned, but a declared limit reserves the sender's scheduling capacity. All cheap checks run before the replay: every rejection except a lying footer score costs ≤ 0.45M gas. Only `ScoreMismatch` costs a full replay (74M). | `rv32_rejection_gas` |
| Draining storage deposits by spam | **Reduced in v2**: `relay_only` mode, only `kalien-relay` may submit, so spam must pass the Worker. Each accepted submission still costs the contract ≈ 0.0036 HOG. | `relay_only_mode_blocks_other_callers`, devnet `NotRelay` |
| Tape length / header edge cases | Rejected: 0 frames, > 36,000 frames, `u32::MAX` frames, truncated, extra byte, header frame count ±2, short tape, bad magic / version / rules / reserved / CRC, footer score above the replay, a valid prefix that claims the full score. A 30 KB+ calldata faults the call (heap), which writes nothing. | `tape_length_edge_cases`, `rejects_bad_tape_container` |
| Reentrancy | Not possible: the token does not call back; `mint` is the last call before the event. | review |
| Concurrent same-player submissions | Both write `best[player][seed_id]`; one is excluded and re-runs in a later block (then may fail `NotImproved`). No double mint. | storage model |

### Residual risks

1. **Copycat tapes (most important).** Everyone plays the same seed in an epoch, and tapes are
   public (on-chain calldata and the Worker replay endpoint). A copycat can take a top tape,
   change an input that has no effect (for example a frame after the last scoring event, or a
   frame during respawn), sign it with their own key, and get the same score and the same
   KALIEN. The tape-hash check only stops exact copies. The test above shows it works today.
   A front-runner can also submit an exact copy first, so the author's transaction fails
   `AlreadyClaimed`; relay-only mode makes this harder (the copy must go through the Worker).
   **Fix (needs a product decision, so I did not do it):** a per-player sim seed, for example
   `tape_seed = sha256(epoch_seed || player_pubkey)[0..4]`. Then a tape only replays for its
   player. Cost: players no longer share one asteroid layout per epoch; the browser, the Worker
   pre-check, the CLI and autopilot must derive the player seed. Cheaper partial step: the Worker
   serves tapes only after their epoch closes (calldata stays public on-chain).
2. **Admin trust.** The admin can pause, change the admin, and add relays. Seeding is locked.
3. **Relay key.** `relay_only` makes the relay key the only submit path. If it leaks, an attacker
   can submit (still only valid, player-signed runs) and spam storage. Rotate with
   `set_relay(old, false)` + `set_relay(new, true)`.
4. **Storage funding.** The contracts pay storage deposits from their own HOG (50 HOG each now).
   When it runs out, new submissions are excluded from blocks (not failed) and stall. The Worker
   should alert when `groundhog_getBalance(scoreContract)` drops below 5 HOG; top up with
   `thruput transfer`.
5. **Block-producer bias.** The proposer sets the block timepoint, so a malicious proposer could
   bias new seeds. On devnet the proposer is the operator.
6. **Zero-seed fallback.** A derived word of 0 (chance 2^-32) maps to `0xDEADBEEF`, the seed of the
   public short/medium fixtures. Kept as specified.

## What changed in round 2

- Contract (v2): `derive_seed` adds block height and timepoint; `TapeBadPadding`; `relay_only` +
  `set_relay` / `set_relay_only` / `is_relay`; `lock_seeding`; `Config` gains `relay_only` and
  `seeding_locked`; `SettingsChanged` replaces `PausedChanged`; new `RelayChanged`; errors 13, 14, 28.
- Tests: `tests/adversarial.rs`, `rv32_rejection_gas`, updated seed test.
- Tools: `kalien.ts harden` (allow relay, relay-only, optional `--lock-seeding`);
  `deploy-devnet.sh` runs it before and after the fixtures. `record-rpc-fixtures.ts`.
- Shared: `shared/thruput/kalien.ts`, `kalien.test.ts`, `test-data/devnet-rpc.json`;
  `SCORE_ERRORS` now lives in `kalien.ts`.
- Plan: "Interface v2" in `docs/thruput/PORT-PLAN.md`.
- Local node on 9645 stopped. `[local_runtime_state]` in `~/.config/thruput/config.toml` already
  pointed at another agent's node (port 9745), so I did not touch it.

## How I tested (round 2)

```bash
kalien-contract/scripts/test.sh
#  cargo test --workspace   -> adversarial 9, test 25 passed
#  thruput test -p kalien_score -> 7 passed (gas lines above)
#  bun test (claim)         -> 10 pass
bun test shared/thruput/                                   # 25 pass, 1 skip (live)
KALIEN_LIVE=1 bun test shared/thruput/kalien.test.ts -t live   # 1 pass against v2
node_modules/.bin/tsc -p kalien-contract/tsconfig.json         # clean
kalien-contract/scripts/deploy-devnet.sh                       # v2 table above
```

## For kt-worker

- **Update to v2:** `SCORE_CONTRACT=0x94204675c7a31180d05a494de80679ea9be84adee0ffaac1f2dcd03f4e5216bc`,
  `TOKEN_CONTRACT=0xddf7dd05230d877cb3635392f5fde0af3f9eb0cf406f1a05146403710f98c0d8`
  (network hash unchanged). Regenerate nothing else; bindings in `shared/thruput/bindings/` are v2.
- `RELAY_SECRET` is unchanged: `wrangler secret put RELAY_SECRET < ~/.config/kalien-thruput/relay.secret`
  (64 lowercase hex chars, the 32-byte Ed25519 seed, no newline). Only this relay can submit now.
- New errors to map: 13 `SeedingLocked`, 14 `NotRelay`, 28 `TapeBadPadding`. Pre-check
  `tapePaddingOk(tape)` before relaying. `SCORE_ERRORS` in `shared/thruput/kalien.ts` has all.
- Pre-check with the TS replay before relaying: a lying footer score is the only rejection that
  costs a full 74M-gas replay.
- Consider the shared helpers above instead of a second adapter: `submitScore` (with `onSigned`),
  `getSubmitResult`, `getScoreSubmittedPage` (cursor + `fromHeight`), `ensureCurrentSeed`.
- Alert on score/token contract HOG < 5 HOG (storage deposits).

## For kt-client

- Sign `claimMessage(...)` from `shared/thruput/claim.ts` (unchanged in v2).
- Player screen: `readPlayerState(client, config, address)` gives seed, active, best and KALIEN
  balance from one snapshot; `getTokenMetadata` for name/symbol/decimals.
- History: `getScoreSubmittedPage(client, config, { player, order: "descending", limit: 20 })`.
- Root `package.json` should list `@noble/hashes` (2.x); `claim.ts` imports it directly.

## For the lead

- Product decision needed for residual risk 1 (per-player seed or not). I can implement it in
  the contract quickly; it touches client, Worker, CLI and autopilot.
- My commit `3e453f8` included kt-worker's uncommitted "Worker API v0 (as built)" edit of
  `docs/thruput/PORT-PLAN.md` (same file, before the pathspec rule mattered for shared files).
  Their text is intact; nothing was lost.
- After a devnet wipe: `kalien-contract/scripts/deploy-devnet.sh`. It redeploys v2, runs the
  fixtures, turns on relay-only mode and locks seeding.

## Round 1 notes still valid

- `.cargo/config.toml`: 16 KiB stack `--defsym` before `-T`; an unused `groundhog` registry entry
  to avoid the `~/.cargo/config.toml` name clash. `kalien_score` needs sdk `alloc` (calldata > 4 KiB).
- The sandbox blocks writes to `~/.cargo-thruput` and gpg commit signing.
- Faucet: `groundhog_requestAirdrop` gives 1,000 HOG per call on devnet.
- The CLI allows one managed `thruput node` per machine; use another `XDG_CACHE_HOME` to run a
  second one, and expect it to rewrite `[local_runtime_state]` in the global config.
- `RuleViolation` / `FrameCountMismatch` are not reachable from inputs alone (deterministic sim,
  exact frame count), so they have no test.
- `shared/stellar/` is not mine and is Soroban-only; the coordinator can remove it.
