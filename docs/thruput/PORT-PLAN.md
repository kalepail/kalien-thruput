# Kalien on Thruput devnet: port plan

Working plan for the port (agents used it as their shared brief). Some sections are historical;
the "Interface v3" section is current. Repo `kalepail/kalien-thruput`, Worker `kalien-thruput` at
`https://thruput.kalien.xyz` (custom domain; also `https://kalien-thruput.sdf-ecosystem.workers.dev`) (Cloudflare account "Ecosystem - Stellar",
`ba55b7ae9acfb3ed152103e3497c0752`).

## Goal

Run Kalien on the Thruput devnet with no ZK. A Thruput contract replays the tape on-chain with
the Rust `asteroids-core` simulation, checks the claimed score, records the best score per player
per seed epoch, and mints KALIEN. Everything else (leaderboard, profiles, tape storage and replay,
CLI, autopilot) stays unless it only existed for proving.

Remove: RISC Zero guest/host/api-server, Boundless, Vast.ai, proof queues, the proof coordinator's
ZK job machinery, OpenZeppelin Channels relay, smart-account-kit passkeys, Soroswap KALE swap,
Soroban contract, Stellar mainnet env, SEP-1 `stellar.toml`.

## Devnet upgrade on 2026-10-24 (read first)

Devnet was wiped and upgraded overnight. Everything we deployed is gone (contracts, balances,
relay funds). Current devnet (from `getVersionInfo`): wire format **14.1.0**, implementation
**0.36.0**, release 0.1.31-rc.15, network hash `DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj`
(base58), height ~17k.

- RPC methods are renamed (no `groundhog_` prefix): `getVersionInfo`, `getNetworkInfo`,
  `getChainTip`, `getChainConfig`, `getServerLimits`, `sendTransaction`, `getTransactionStatus`,
  `getTransactionReceipt`, `getBalance`, `getStorage`, `simulateInvocation(s)`, `getEvents`,
  `getBlockByHeight` (block times now exist), `getTransactionsByBlock`, `faucet_requestAirdrop`.
  Doc: https://www.thruput.network/docs/reference/json-rpc-api/.
- Identifiers (addresses, hashes, network hash) are **base58** on the wire and in tools.
- CLI: `thruput 0.36.0` is installed (matches devnet). Local node bundle: `hog-devnode
  0.1.31-rc.14` installed and active. The devnet profile has the new network hash.
- Contract SDK: the crate is now **`thruput-sdk` `=0.54.0`** (registry `thruput`); see a fresh
  `thruput new` scaffold for the exact `Cargo.toml`, `.cargo/config.toml`, `build.rs` layout.
- TS: root deps are now **`@thruputchain/client@0.23.0` + `@thruputchain/protocol@0.18.0`**
  (wire 14). `PrivateKeySigner` is renamed `Ed25519Signer` (with `fromSeed`); `createRpcClient`
  exposes the native wire-14 methods. Docs: https://www.thruput.network/docs/typescript/.
- Keys in `~/.config/thruput/keys` still exist; their devnet accounts are empty. Refund with
  `faucet_requestAirdrop`. Network hash and all contract addresses must come from config.

- **JSON-RPC reference:** https://www.thruput.network/docs/reference/json-rpc-api/
  (wire 14 method map, named `params` objects, base58 identifiers, lowercase `0x` hex payloads,
  decimal-string heights/gas, admission vs commitment, `execution.result` in receipts,
  cursor pagination that ends only at `nextCursor: null`, `error.data.kind` handling).
- **Firehose:** `wss://firehose.thruput.network` streams committed block records (XDR) with
  resumable replay from a height and per-block ACK. Docs: https://www.thruput.network/docs/reference/firehose/.
- Devnet now has some support for Stellar G/C StrKey addresses (Ed25519 keys only; ML-DSA-65
  keys exist too but have no StrKey form). We keep Ed25519 browser keys.

## Thruput facts that shape the design

- Docs authority: https://www.thruput.network/docs/. Agent skill: `thruput skill show`.
- Contracts: Rust `no_std`, RV32IM, no floats, `sdk =0.51.1` from registry `thruput`.
  Guest memory is **64 KiB total** (stack + statics + heap + calldata). The allocator is a
  **bump allocator that never frees**. So the replay must not allocate per frame and must not
  unpack the tape into a one-byte-per-frame `Vec` (36 KB). Read nibbles from the packed tape.
- Calldata is copied whole into guest memory. A max tape is 18,024 bytes, which should fit.
  `Bytestring` storage items are capped at 4,096 bytes.
- Gas is not burned. The sender must hold free HOG >= declared gas limit (1 gas = 1 base unit,
  1 HOG = 1e7 base units). `maxViewGas` is 10M, so a full replay cannot be previewed by `view`.
- No randomness syscall. There is `GetSourceTransactionHash`, `GetNetworkHash`, block timestamp,
  SHA-256, and `verify_signature_ed25519`.
- No passkeys. Accounts are Ed25519 pubkey accounts: address = derived from
  `PubkeyAccountPreimage { pubkey, nonce }`; an undeployed pubkey account falls back to the
  network DefaultWallet.
- Contracts are immutable. Redeploy to change. Devnet gets wiped: network hash, addresses and
  wallets change. Read the network hash from `groundhog_networkInfo`; never hard-code it in code
  paths that cannot be updated by config.
- Devnet RPC `https://rpc.thruput.network` (CORS ok, Worker fetch ok). Explorer
  `https://explorer.thruput.network/`. Faucet: `thruput airdrop`, `wallet.requestAirdrop()`,
  `https://thruput-faucet.up.railway.app` (about 10 HOG / address / 24 h).
- TS client: pin `@thruputchain/client@0.18.0` + `@thruputchain/protocol@0.15.0` (devnet wire
  format 11.x). Do **not** upgrade to 0.20+.

## Environment rules (every agent)

- **Cargo:** always run cargo / `thruput build` / `thruput test` / `thruput deploy` with
  `CARGO_HOME=$HOME/.cargo-thruput`. The global `~/.cargo` names the registry
  `groundhog`, which clashes with `thruput`. Do not edit `~/.cargo`.
- **npm/bun:** `export GH_NPM_TOKEN="$(gh auth token)"` before `bun install`/`bun add`. The repo
  `.npmrc` maps `@thruputchain` to GitHub Packages and reads the token from `GH_NPM_TOKEN`.
- CLI: `thruput 0.36.0` and `hog-devnode 0.1.31-rc.14` match devnet (wire 14.1.0).
- Keys: devnet only. Keep secrets out of git (`.dev.vars`, `.env`, `~/.config/thruput`). Never
  print secret keys in logs or commit them.
- **Git:** all agents share this one worktree and branch. Commit often, but only your own paths:
  `git add <your paths>` then `git commit`. Never `git add -A`, `git stash`, `git reset`,
  `git checkout -- <others' files>`, `git rebase`, or `git push`. If `index.lock` exists, wait a
  few seconds and retry. Use Conventional Commit messages, e.g. `feat(contract): ...`.
- Do not edit files that another agent owns. If you need a change there, say so in your final
  report and the coordinator relays it.
- Ports: client agent Vite 5173; worker agent Vite/wrangler 5174 and 8787; local Thruput nodes:
  core agent 9545, contract agent 9645 (or whatever `--port` the CLI allows; avoid collisions).
- Write in ASD-STE100 Simplified Technical English in docs and reports (short active sentences).

## Ownership

| Agent | Owns |
|---|---|
| `core` | `kalien-verifier/asteroids-core/` (move to `asteroids-core/` at repo root), `autopilot/` Cargo wiring, removal of the rest of `kalien-verifier/`, `src/game/` only for parity fixes |
| `contract` | `kalien-contract/` (rewrite as Thruput contracts: score + KALIEN token), `shared/thruput/` (bindings, claim-message helper, deployments), devnet keys and deploys |
| `worker` | `worker/`, `wrangler.jsonc`, `worker-configuration.d.ts`, `.dev.vars.example`, D1 migrations |
| `client` | `src/` (except `src/game/`), `index.html`, `public/`, `vite.config.ts`, `.env.example`, root `package.json` deps for the browser |
| `cli` | `cli/`, `scripts/`, `benchmarks/`, `autopilot/` submit paths (not its Cargo deps), `test-fixtures/` cleanup |

Root `README.md` and `docs/`: the coordinator merges at the end; each agent may add
`docs/thruput/<agent>.md`.

## Interface v3 (the `contract` agent owns it and may change it; record changes here)

v3 is built on `thruput-sdk` 0.54.0, tested on RV32, and deployed on the wire-14 devnet on
2026-10-24 (score `8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT`, token
`AZGTgZfoVoLZpTquPLpPpA1pUbvC4SRfLc5tjWXfHk87`; always read them from `deployments/futurenet.json`).
Changes from v0 are marked **(v1)**, from the adversarial review **(v2)**, from the final layout
pass **(v3)**. Identifiers are base58 on the wire and in `futurenet.json`.

### Score contract `kalien_score`

Source: `kalien-contract/contracts/kalien_score/`. TS bindings: `shared/thruput/bindings/kalien-score.ts`
(`KalienScore.v0_1.*`, events under `kalien_score.v0_1.implementation.*`).

- `initialize(admin, token)`: one-time, atomic with deploy.
- Seeds. `seed_id = block_timepoint_seconds / 600`. Active window: the current epoch and the
  previous 143 (24 h).
  - **(v1)** `ensure_current_seed() -> SeedInfo { seed_id, seed }` is a transaction. It creates the
    current epoch seed if it is missing: **(v2)** `sha256(source_tx_hash || seed_id u32 LE ||
    block_height i64 LE || block_timepoint_ns u64 LE)`, first 4 bytes LE, 0 maps to `0xDEADBEEF`.
    The block fields stop a caller from grinding its transaction hash to pick the seed. Anyone may call it. The Worker cron calls it every epoch, and
    before it serves a seed that does not exist yet.
  - **(v1)** `current_seed() -> Option<SeedInfo>` is a view. It does not create the seed.
  - **(v1)** `current_seed_id() -> u32`, `seed(seed_id) -> Option<u32>`, `is_seed_active(seed_id) -> bool`.
  - **(v1)** `set_seed(seed_id, seed)`: admin only, an active epoch that has no seed yet, seed != 0.
    Used to replay fixture tapes (their seeds are fixed).
  - **(v2)** `lock_seeding()`: admin, one-way. After it `set_seed` throws `SeedingLocked`.
    The devnet deploy locks seeding right after the fixture runs.
- `submit_score(player_pubkey: [u8;32], seed_id: u32, tape: &[u8], signature: [u8;64]) -> ScoreReceipt`
  **(v1: returns `ScoreReceipt { player, seed_id, seed, frame_count, final_score, previous_best,
  minted_delta, tape_hash }`)**. Order of checks:
  1. not paused; **(v2)** if `relay_only`, the caller is an allowed relay (`NotRelay`);
     a seed exists for `seed_id` (`UnknownSeed`); `seed_id` is active (`SeedInactive`).
  2. tape container (magic, version, rules tag, reserved bytes, length, frame count 1..=36,000, CRC,
     **(v2)** zero high nibble in the last body byte of an odd-frame tape (`TapeBadPadding`));
     tape seed == stored seed (`SeedMismatch`); claimed score > 0 (`ZeroScore`);
     claimed score > `best(player, seed_id)` (`NotImproved`); `sha256(tape)` not claimed (`AlreadyClaimed`).
  3. Ed25519 signature by `player_pubkey` over the **32-byte digest**
     `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))`.
     `network_hash` comes from the `GetNetworkHash` syscall. Sign the digest, not the preimage.
  4. Strict replay of every frame (`asteroids-core::verify::verify_tape`); replayed frame count and
     score must equal the tape (`ScoreMismatch`, `RuleViolation`).
  5. Store the new best and the tape hash, mint `(new - prev) * 10^7` KALIEN to the player address,
     emit `ScoreSubmitted`.
- Player address **(v3, wire 14)**: the nonce-0 pubkey account,
  `sha256(0x00 0x0d "PubkeyAccount" || pubkey_hash || 0x00)` with
  `pubkey_hash = sha256(0x00 0x09 "PublicKey" || 0x00 || pubkey)`
  = `derivePubkeyAccountAddress(pubkeyAccountPreimage(key, 0n))` = `createPubkeyAccount({ signer }).address`.
  View: `player_address(pubkey)`.
- Views: `best_score(player, seed_id) -> u32`, `is_claimed(tape_hash: [u8;32]) -> bool`,
  **(v1)** `claim_message(seed_id, tape_hash) -> [u8;32]` (the digest to sign),
  `config() -> Config { admin, token, paused, relay_only (v2), seeding_locked (v2) }`,
  `is_relay(address) -> bool`, **(v3)** `relays() -> RelaySet { count, relays: [address; 8] }`
  (the first `count` entries), `claimed_seed_id(tape_hash) -> Option<u32>`.
- Admin: `set_paused(bool)`, `set_admin(address)`, `set_seed`, `lock_seeding` (above),
  `set_relay_only(bool)`, **(v3)** `add_relay(address)` / `remove_relay(address)` (bounded set of
  8; adding twice or removing an unknown address changes nothing; a 9th throws `RelaySetFull`;
  replaces v2 `set_relay`), **(v3)** `handover_token(new_administrator)` (moves mint authority to a
  later score contract, so a redeploy can keep the token and balances). The devnet deploy allows
  `kalien-relay`, `kalien-relay-2`, `kalien-relay-3`, `kalien-relay-4` and turns relay-only on.
- **(v3)** Anyone: `prune_run(player, seed_id, tape_hash) -> Pruned` and `prune_seed(seed_id)`
  delete the best entry, the claimed tape hash and the seed of an epoch that has left the
  active window (`SeedNotExpired` otherwise). The deposits return to the contract.
  Afterwards `best_score` for that epoch reads 0; the indexer keeps history.
- Events: `ScoreSubmitted { #[topic] player, #[topic] seed_id, player_pubkey (v1), relay (v3),
  submitted_at (v3, unix seconds), seed, frame_count, final_score, previous_best, new_best,
  minted_delta: i128, tape_hash: [u8;32] }`; **(v3)** `TokenHandedOver { #[topic] token, #[topic] new_administrator }`;
  **(v1)** `SeedCreated { #[topic] seed_id, seed }`, `AdminChanged { #[topic] previous, #[topic] admin }`;
  **(v2)** `SettingsChanged { paused, relay_only, seeding_locked }` (replaces v1 `PausedChanged`),
  `RelayChanged { #[topic] relay, allowed }`.
- Errors `ScoreError` (discriminant): AlreadyInitialized 1, NotAdmin 2, Paused 3, UnknownSeed 4,
  SeedInactive 5, SeedMismatch 6, BadSignature 7, AlreadyClaimed 8, ZeroScore 9, NotImproved 10,
  SeedAlreadySet 11, ZeroSeed 12, SeedingLocked 13 (v2), NotRelay 14 (v2), RelaySetFull 15 (v3),
  SeedNotExpired 16 (v3), TapeTooShort 20, TapeBadMagic 21, TapeBadVersion 22,
  TapeBadRulesTag 23, TapeReservedNonZero 24, TapeFrameCountOutOfRange 25, TapeLengthMismatch 26,
  TapeCrcMismatch 27, TapeBadPadding 28 (v2), RuleViolation 30, FrameCountMismatch 31, ScoreMismatch 32.
  A rejected submission commits as a failed transaction; the wallet root re-throws the
  `ScoreError` in `abortData` (decode with `KalienScore.v0_1.submitScore.decodeException`).
- Gas and memory **(v3, measured on sdk 0.54)**: one transaction replays a full tape; no chunked
  replay. Gas ≈ 1.8–2.2k/frame + 0.2M (36,000 frames: 67.6–74.5M). Use wallet root gas limit
  `5_000_000 + 4_500 * frame_count` (max 167M; same as the Worker; dense valid tapes reach
  2,716 gas/frame, a searched worst case 3,073). The sender (relay) must hold free HOG ≥ gas
  limit (≤ 16.7 HOG); gas is not burned. Peak guest memory with an 18,024-byte tape: 46–47 KiB of
  64 KiB with the 16 KiB guest stack (in `kalien-contract/.cargo/config.toml`); with the default
  30 KiB stack it is 60–61 KiB, so keep the 16 KiB rule.

### KALIEN token `kalien_token`

Standard `thruput-erc20-if` ERC20 + `ERC20Metadata` (name "Kalien", symbol "KALIEN", 7 decimals).
TS bindings: `shared/thruput/bindings/kalien-token.ts` (`ERC20.v0_1.getBalanceOf`, etc.).
**(v1)** Extra interface `KalienTokenAdmin { set_administrator(address), administrator() }`.
Deploy order: token `initialize(deployer)`, then score `initialize(admin, token)`, then
`token.set_administrator(score)`. After that only the score contract can mint.

### Shared TS (`shared/thruput/`, owned by `contract`)

- `deployments/futurenet.json`: `{ network, networkHash, rpcUrl, explorerUrl, scoreContract,
  tokenContract, admin, deployedAt, deployTxs, artifacts, fixtureSeedIds, fixtureEpochs }`,
  identifiers in base58. `fixtureSeedIds` are the epochs the deploy seeded for public fixture
  tapes; relays must refuse them (`isFixtureSeedId(config, seedId)`) until `fixtureEpochs[].activeUntil`.
- `bindings/kalien-score.ts`, `bindings/kalien-token.ts` (from `thruput codegen ts`; do not edit).
- **(v3)** `kalien.ts` (wire 14, client 0.23): chain helpers for Worker, browser and CLI (fetch only).
  `connectKalien(config)` (pins the network hash), reads (`readPlayerState`, `getBestScore`,
  `getCurrentSeed`, `getSeed`, `getCurrentSeedId`, `isTapeClaimed`, `getClaimedSeedId`,
  `getKalienBalance`, `getTokenMetadata`, `getScoreConfig`, `isRelay`, `getRelays`, `getBlockTime`),
  events (`getScoreSubmittedPage` with `start` or `cursor`, ends only at `nextCursor: null`;
  `walkScoreSubmitted` with a `completedThroughBlockHeight` checkpoint; player and seed-id topic
  filters), relay writes (`createRelayWallet(client, RELAY_SECRET)` with `Ed25519Signer`,
  `submitScore` with an `onSigned` hook before `sendTransaction`, statuses
  `confirmed | rejected | failed | notAdmitted | unknown`, never resubmits; `getSubmitResult`;
  `ensureCurrentSeed`), `submitGasLimit`, `SCORE_ERRORS`, `tapePaddingOk`, `parseAddress`.
  Tests: `bun test shared/thruput/` (offline) and `KALIEN_LIVE=1` (live devnet).
- `claim.ts` (wire 14): `claimMessage({networkHash, scoreContract, seedId, tape}) -> Uint8Array(32)`,
  `claimPreimageFromHash(...)`, `tapeHash(tape)`, `publicKeyHash(pubkey)`,
  `pubkeyAccountAddress(pubkey) -> base58`, `pubkeyAccountAddressBytes`, `bytes32` (base58, 0x hex or
  bytes), `toHex`, `fromHex`, `toBase58`, `fromBase58`. Depends on `@noble/hashes` and
  `@thruputchain/protocol/utils`. Vectors: `claim-vectors.json` (base58 + hex), checked by
  `bun test shared/thruput/claim.test.ts` (also against client 0.23) and the Rust test
  `claim_and_address_vectors_match_shared_ts`.
- Signing: `ed25519.sign(claimMessage(...), secret)` or `await Ed25519Signer.fromSeed(secret).sign(digest)`
  (`.ed25519` holds the 64 bytes). Both give the same signature.

### Worker API v0 (owned by `worker`; as built, see `docs/thruput/kt-worker.md`)

General: JSON bodies are camelCase and carry `success: true|false`. Errors are
`{ success: false, error: "<text>", code?: "<slug>" }` with a 4xx/5xx status; 429 is a rate
limit (`Retry-After` header). **(wire 14)** Addresses, transaction hashes, the network hash and
contract ids are **base58** in all responses; input accepts base58 or 64 hex chars (optional
`0x`). `pubkey` and `sig` stay hex. KALIEN amounts (`minted`, `mintedDelta`, `totalMinted`) are
decimal strings of base units (7 decimals). `runId` = `sha256(tape)` as 64 hex chars (no `0x`).

- `GET /api/config` → `{ networkHash, rpcUrl, scoreContract, tokenContract, explorerUrl }`
- `GET /api/seed/current` → `{ seedId, seed, indexed, secondsLeft }`. `seed` is null until the
  epoch's seed exists; the Worker then asks the relay to create it, so poll again in a few
  seconds. A cron also creates it every 10 minutes.
- `POST /api/runs?pubkey=<hex32>&seed_id=<u32>&sig=<hex64>`, raw tape body (max 18,024 bytes)
  → 202 with a run record (below). Checks, in order: query params, size, header/CRC, dedupe
  (same tape, same player → 200 with the existing run; another player → 409
  `already_claimed`), seed window, claim signature, TS replay score, stored seed equals the
  tape seed, `is_claimed`, `best_score`. Error codes: `bad_pubkey`, `bad_signature`,
  `bad_seed_id`, `seed_blocked` (403: a closed fixture epoch, `BLOCKED_SEED_IDS`),
  `tape_too_large`, `bad_tape`, `seed_inactive`, `seed_missing`,
  `seed_mismatch`, `replay_mismatch`, `already_claimed`, `not_improved` (with `bestScore`),
  `chain_unavailable`.
- Run record (`GET /api/runs/:id`, POST response, list items): `{ runId, status:
  queued|submitting|confirmed|rejected|failed|unknown, playerAddress, seedId, seed, frameCount,
  claimedScore, score, previousBest, minted, txHash, blockHeight, attempts, error, createdAt,
  updatedAt }`. `score` is the confirmed new best, else the claimed score. `rejected` means the
  contract refused the run (`error` = contract error name and reason). `failed` means the relay
  gave up (a new POST of the same tape retries it, except for a final failure: a deterministic
  fault or a second out-of-gas). `unknown` means the relay could not settle the transaction in
  time (for example a commitment without a receipt); it keeps checking with backoff and the
  status can still change to `confirmed` or another final state. Clients poll it slowly.
- `GET /api/runs?player=<address>&limit=<1..100>&offset=<0..1000>` or `&cursor=<nextCursor>` →
  `{ player, runs: [run record], total, limit, offset, nextOffset, nextCursor }` (newest first,
  merged over relay lanes).
- `GET /api/runs/:id/tape` → raw tape, only once the run is confirmed.
- `GET /api/leaderboard?window=10m|day|all&limit&offset&address` → `{ window, generatedAt,
  windowRange, pagination: { limit, offset, total, nextOffset }, entries, me, ingestion }`.
  Entry: `{ rank, playerAddress, score, seedId, seed, frameCount, mintedDelta, tapeHash, runId,
  txHash, blockHeight, closedAt, profile }`. Best run per player in the window.
- `GET /api/leaderboard/player/:address?runs_limit&runs_offset` → `{ player: { address, profile,
  stats: { totalRuns, bestScore, totalMinted, lastPlayedAt }, ranks: { tenMin, day, all },
  recentRuns, runsPagination } }`
- `PUT /api/leaderboard/player/:address/profile` with JSON `{ pubkey, username, linkUrl,
  timestamp, signature }`. `signature` = Ed25519 by the player key over the UTF-8 bytes of
  `["kalien-profile-v1", networkHash, address, timestamp, username ?? "", linkUrl ?? ""].join("\n")`
  (**(wire 14)** `networkHash` and `address` in base58, exactly as `/api/config` and the API
  return them; `timestamp` = ms, within 5 minutes of server time, newer than the last update). `pubkeyAccountAddress(pubkey)` must equal `address`. Helper: `worker/profile.ts`
  `profileMessage`.
- `GET /api/health` → `{ lanes: [{ lane, allowed, address, counts, seedTouch, lastError }], indexer }`.
  `allowed` = the lane key passes `is_relay`; new runs go only to allowed lanes. Public calls
  get a view cached for 15 s per isolate; the admin key gets a fresh one.
- Admin (`Authorization: Bearer <DEV_API_KEY>`): `POST /api/admin/sync`,
  `POST /api/admin/seed/touch`, `GET /api/admin/runs?status=failed,rejected,unknown`,
  `POST /api/admin/runs/:id/retry` (non-final `failed`, or `unknown` when provably dead),
  `POST /api/admin/indexer/reset?fromHeight=N`.
- Leaderboard data: the relay writes a row on confirmation; a 1-minute cron indexes
  `ScoreSubmitted` events into D1 (`getEvents`). `closedAt` is the block time
  (`getBlockByHeight`; the event's `submitted_at` as fallback). Rows are kept per score
  contract, so a redeploy starts an empty leaderboard.

### Browser wallet (owned by `client`)

Ed25519 key made in the browser on first visit, kept in `localStorage`. Feels like the passkey
flow: one tap, no extension, no faucet step. Add export (copy/download a backup string) and
import, so a player can move the key to another browser. Show the address, KALIEN balance, and
explorer link.

## Test assets

- `test-fixtures/*.tape` (known seed/frames/score; see its README).
- `autopilot/fixtures/public/kalien-911140-seed1598125870.tape`: 36,000 frames, score 911,140 —
  worst case for gas.
- `checkpoints/*.tape`, `generated-tapes/`.

## Definition of done

1. Contract replays all fixture tapes on RV32 (`thruput test`) with exact scores, and on devnet.
2. Gas and memory measured and recorded for short, medium, 36k-frame tapes.
3. Browser: play a game, submit, see the confirmed score, KALIEN balance, leaderboard entry, and
   the replay, on `thruput.kalien.xyz`.
4. CLI and autopilot submit runs to the new API.
5. `bun run check` passes; Rust tests pass; no ZK code left.
