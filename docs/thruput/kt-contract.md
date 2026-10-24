# kt-contract report

Agent: `kt-contract`. Owns `kalien-contract/`, `shared/thruput/`, devnet keys and deploys.

## Round 4 (2026-10-24): review fixes (gas bound, fixture hygiene) — no redeploy

- **Gas:** `submitGasLimit(frames, { baseGas?, gasPerFrame? })` in `shared/thruput/kalien.ts` is now
  `5,000,000 + 4,500 × frames` (36,000 frames: 167M), the Worker's bound. It covers the densest
  corpus tape (2,716 gas/frame) and the searched worst case (3,073, 110.6M). `submitScore` still
  takes `{ gasLimit }`. Constants `SUBMIT_BASE_GAS`, `SUBMIT_GAS_PER_FRAME`. A relay must hold
  ≥ 16.7 HOG free for a full tape.
- **Fixture epochs of the live v3 deploy** (checked on-chain): 2988058 (`0x5F41772E`, active until
  2026-10-25 09:40 UTC), 2988059 (`0x43C9C6CD`, 09:50), 2988060 (`0xDEADBEEF`, 10:00). They are now
  in `shared/thruput/deployments/devnet.json` as `fixtureSeedIds` and `fixtureEpochs`. The public
  tapes `autopilot/fixtures/public/kalien-911260-seed1598125870-single-mutation.tape` and
  `asteroids-core/tests/fixtures/local/offline-supernova-hunt-seed5f41772e-score35850-frames11390.tape`
  are still unclaimed for 2988058, so the Worker block (kt-worker) is what protects them. A
  no-op-mutated copy of any fixture tape would also pass the contract, so the block must cover
  the whole epoch, not single tapes.
- `KalienConfig.fixtureSeedIds?` and `isFixtureSeedId(config, seedId)` in `kalien.ts`.
- **Deploy script (`deploy-devnet.sh`, `kalien.ts fixtures`), for future deploys:**
  - fixture epochs are 3 unseeded epochs starting 4 epochs above the oldest active one
    (`--epoch-margin`), so they expire within about 40–60 minutes;
  - after the fixture runs, every git-tracked `.tape` whose seed matches a fixture epoch is
    claimed with a throwaway key (results in `devnet-fixture-runs.json` → `claims`);
  - `fixtureSeedIds` / `fixtureEpochs` are written to `devnet.json`;
  - review item 13: the script refuses when `devnet.json` already names the live network
    (`--force` overrides); secret files are written to a temp file and moved (no truncation);
  - overrides for a rehearsal: `KALIEN_RPC_URL`, `KALIEN_DEPLOYMENT_FILE`, `KALIEN_FIXTURE_RUNS_FILE`,
    `KALIEN_SECRETS_DIR`, `KALIEN_FUND_TIMES`; new tool commands `balance`, `network-hash`.
- **Tested:** full rehearsal of `deploy-devnet.sh` on an isolated local node (own `XDG_CONFIG_HOME`
  and `XDG_CACHE_HOME`, port 9645): fixture epochs 2987961–63 (current 2988100); four fixtures
  confirmed (gas limits now 8.15M … 167M); both extra `0x5F41772E` tapes claimed; `fixtureSeedIds`
  written; re-run refused by the guard; `kalien.ts integration` passed on the same node. The node is
  stopped. `bun test shared/thruput/` 15 pass; `KALIEN_LIVE=1` 7 pass (the event test now checks
  only the first four rows, because live player runs follow them); tsc clean. Contracts unchanged.

## Round 3 (2026-10-24): wire-14 migration and v3 deploy — current

### Devnet v3 (current; wire 14.1.0, implementation 0.36.0)

| item | value |
|---|---|
| network hash | `DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj` |
| RPC | `https://rpc.thruput.network` |
| score contract | `8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT` |
| token contract | `AZGTgZfoVoLZpTquPLpPpA1pUbvC4SRfLc5tjWXfHk87` |
| admin (`kalien-deployer`) | `5y9nbDvLXhF87vezDQQKKfHd9DccibjUutkHrhE5UojK` (≈ 799 HOG) |
| relays (allowlist, relay-only on) | `kalien-relay` `94febNxmANEba5YFYVrrKvYEpTq7dEXzhqPARRCnUkMJ`, `kalien-relay-2` `63sSHUhsshPPYc6HATTfiJKBChhhUEpTnuMGvUBjXqYT`, `kalien-relay-3` `9U7TwtWnL8mg2XYwf6L4R5TAzGnsYVwMxaPaM1Loj7PD`, `kalien-relay-4` `6uHAVi82rWirY492rSmd2oUXpmvUfmTBfiSBXdZtVrP8` (999 HOG each) |
| test player (`kalien-test-player`) | `5KWwyykYcxUEmDFdA8sgUX7BbiXL3VtiYS8KdBRp4nwi` (937,200 KALIEN) |
| settings | `relay_only = true`, `seeding_locked = true`, `paused = false`; each contract holds ≈ 50 HOG for storage |

Deploy transactions are in `shared/thruput/deployments/devnet.json`. Fixture runs
(`kalien-contract/deployments/devnet-fixture-runs.json`), through `kalien-relay`:

| tape | seed_id | frames | score | gas used | gas limit | tx |
|---|---:|---:|---:|---:|---:|---|
| test-short | 2988060 | 700 | 1,480 | 1,550,301 | 4,540,000 | `23mYLNEXjsSdAHZqgBKcQESYmF9xT1bWJtKwN1fjXZiG` |
| test-medium | 2988060 | 5,000 | 11,190 | 9,817,917 | 14,000,000 | `DR9stXEM4BrxsjTUX9RaEPuQ6AbbmdGzj169qCsaPo5s` |
| test-real-game | 2988059 | 6,643 | 14,870 | 14,341,977 | 17,614,600 | `E5L9BD6CW3TsLoVtwtAH2V77F8WYaKUKriPPLW2TdGJx` |
| kalien-911140 | 2988058 | 36,000 | 911,140 | 67,608,056 | 82,200,000 | `6BncKoSmPSbp6DWBSY2SpYMhJ9z5CAiVYwiseXsKXgTy` |

Note: the first v3 deploy attempt today (score `67QdfbkX…HLS42`, token `HgYSzDan…J6kM`) stopped
after its first fixture run because of a receipt-decoding bug in my helper (fixed in `5c9924a`).
Those contracts are unused; ignore them.

### What changed in round 3

- `aaf9b10`: the v3 layout (relay set, `relay`/`submitted_at` in `ScoreSubmitted`, claimed tapes keep
  their epoch, `prune_run`/`prune_seed`, `handover_token`). See "Interface v3" in the plan.
- `42d0b48`: `thruput-sdk =0.54.0` (from a fresh CLI 0.36.0 scaffold; only my three config
  additions differ), `thruput-erc20-if`/`-metadata-if =0.1.65` (the first versions on sdk 0.54),
  test dev-dep `thruput-trace =0.57.0`. **Wire 14 changed the pubkey account address:** the
  preimage now holds `pubkey_hash = sha256(sep("PublicKey") || 0x00 || pk)`, not the key.
  `claim.rs` and `claim.ts` follow it; vectors are pinned to `derivePubkeyAccountAddress` and
  `createPubkeyAccount` of client 0.23. `claim.ts` takes and returns base58.
- `b66b64a`, `5c9924a`, `c9d1930`: `shared/thruput/kalien.ts` rewritten for client 0.23 and the
  wire-14 guide; `scripts/kalien.ts` uses it; kt-core's 4 strict-regression tapes run through the
  contract (native and RV32); new `kalien.test.ts`; v3 deployed.
- `asteroids-core` at `c8d6644` (rule fix) is in the build: the regression tapes pass.

### Tests (round 3)

```bash
kalien-contract/scripts/test.sh      # cargo: adversarial 12, test 26; RV32 8 (gas lines); bun claim 11
bun test shared/thruput/                                  # 15 pass, 3 skip (live)
KALIEN_LIVE=1 bun test shared/thruput/kalien.test.ts      # 7 pass against devnet v3
node_modules/.bin/tsc -p kalien-contract/tsconfig.json    # clean
```

RV32 gas (sdk 0.54): short 1,549,986; medium 9,817,247; real-game 14,341,656; long 74,515,543;
911,140-point 67,607,763; regression tapes 7.2M (3,956 frames) to 23.2M (10,757 frames).
Rejections: `UnknownSeed` 88,703; `NotImproved` 381,545; `AlreadyClaimed` 426,088;
`BadSignature` 444,495; `ScoreMismatch` (full replay) 74,388,070.
Memory with the 18,024-byte tape: peak 46,080–47,104 bytes of 65,536 with the 16 KiB stack
(≈ 18 KiB spare). With the default 30 KiB stack it is 60–61 KiB, so the 16 KiB rule stays.

### For kt-worker, kt-client, kt-cli (shared/thruput is committed and green)

- `shared/thruput/kalien.ts` API (all identifiers base58 strings; payload bytes `0x` hex):
  - `connectKalien(config)`; `parseAddress(text)`.
  - Reads: `readPlayerState(client, config, player, seedId?, { minStateBlockHeight? })`,
    `getBestScore`, `getCurrentSeed`, `getSeed`, `getCurrentSeedId`, `isTapeClaimed`,
    `getClaimedSeedId`, `getKalienBalance`, `getTokenMetadata`, `getScoreConfig`, `isRelay`,
    `getRelays`, `getBlockTime(client, blockHeight)` (unix seconds via `getBlockByHeight`).
  - Events: `getScoreSubmittedPage(client, config, { start: { order, fromHeight? } | cursor, player?, seedId?, limit? })`
    → `{ rows, nextCursor, oldestIndexedBlockHeight, latestIndexedBlockHeight }`; continue with
    `cursor` and the same filters until `nextCursor === null`. Rows: `transactionHash, blockHeight,
    sequenceNumber, player, playerPubkey, relay, submittedAt, seedId, seed, frameCount, finalScore,
    previousBest, newBest, mintedDelta, tapeHash`. Cron: `walkScoreSubmitted(client, config,
    { fromHeight }, onPage)` → `{ watermarkBlockHeight, completedThroughBlockHeight }`; persist rows
    in `onPage`, save `completedThroughBlockHeight` only after it resolves, start the next walk there.
  - Relay: `createRelayWallet(client, env.RELAY_SECRET)`; `submitScore(wallet, config,
    { playerPubkey, seedId, tape, signature }, { onSigned, onStatus, timeoutMs })` → `{ status:
    confirmed | rejected | failed | notAdmitted | unknown, transactionHash, gasUsed, blockHeight,
    executionResult, errorCode, errorName, rpcErrorKind?, admission?, knownCommitmentHeight?, run }`.
    `onSigned({ transactionHash, signedTransaction })` runs before `sendTransaction`; persist both.
    It never resubmits; on `unknown`, poll `getSubmitResult(client, config, transactionHash)`.
    `ensureCurrentSeed(wallet, config)` for the cron.
- `claim.ts`: `claimMessage` accepts base58 (as in `devnet.json`) or hex; `pubkeyAccountAddress`
  returns base58; `publicKeyHash` and `pubkeyAccountAddressBytes` are new.
- Relay secrets (kt-worker): unchanged files `~/.config/kalien-thruput/relay.secret` and
  `relay-2..4.secret` (64 hex chars, 32-byte seed). The deploy script writes `relay-N.secret` only
  when missing. Load with `Ed25519Signer.fromSeed(fromHex(secret))`.
- Worker config: `SCORE_CONTRACT=8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT`,
  `TOKEN_CONTRACT=AZGTgZfoVoLZpTquPLpPpA1pUbvC4SRfLc5tjWXfHk87`,
  `THRUPUT_NETWORK_HASH=DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj`.

### Copycat tapes: design note for a later decision (kept as a residual risk)

The lead decided to keep one shared seed per epoch. The test
`residual_copycat_with_a_no_op_input_change_is_accepted` documents the risk. Options for a later fix:

1. **Per-player seed.** `tape_seed = sha256(epoch_seed || player_pubkey)[0..4]`. A tape replays only
   for its player. Strong, simple in the contract. Cost: players no longer share one asteroid field,
   so the "same seed for everyone" leaderboard idea changes; client, Worker pre-check, CLI and
   autopilot must derive the seed.
2. **Commit-reveal.** The player first commits `sha256(tape || pubkey)` on-chain, and reveals the tape
   in a later block. A copycat sees the tape only at reveal, after the author's commitment. Keeps the
   shared seed. Cost: two transactions per run, a commitment window, and storage for commitments.
3. **First-claimer priority by commitment time.** As 2, but only for runs above a threshold
   (for example the top 10 of the epoch), so normal runs stay one transaction.
4. **Delay publication.** The Worker serves tapes only after the epoch closes, and relays only
   through its own lanes (relay-only is already on). This stops casual copying through the API, but
   not someone who reads calldata on-chain.
5. **Canonical tapes.** Reject inputs that cannot matter (after game over, during respawn). This
   removes the easy no-op edits, but not every equivalent tape; it needs care in the sim.

My recommendation if the risk matters later: option 2 for the top of the leaderboard (option 3),
plus option 4 now (Worker-only, no contract change).

---

## Round 2 (2026-10-23) — superseded deployments, kept for history

### Status (round 2)

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
