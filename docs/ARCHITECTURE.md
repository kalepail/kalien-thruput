# Kalien architecture (Thruput devnet)

Kalien is a deterministic Asteroids game. A player plays in the browser (or a bot plays in the
CLI). The game records every frame's input on a **tape**. A Thruput smart contract replays the
tape on chain with the Rust game core. If the replayed score is a new best for that player and
seed epoch, the contract mints KALIEN for the improvement.

There is no zero-knowledge proof. The chain runs the replay itself. One transaction replays a
full 36,000-frame (10-minute) tape.

Network: Thruput devnet, wire format 14.x (implementation 0.36.0 on 2026-10-24). Identifiers
(addresses, hashes, the network hash) are base58. The devnet can be wiped; then every address
changes (see "Devnet operations").

## System map

```text
 Browser (src/)                        CLI / autopilot (cli/, autopilot/)
 - plays the game (src/game, TS)       - bots play the same game (TS or Rust)
 - Ed25519 key in localStorage         - Ed25519 key file
 - signs the claim digest              - signs the claim digest
        |                                         |
        |  POST /api/runs?pubkey&seed_id&sig  (raw tape body)
        v                                         v
 Cloudflare Worker `kalien-thruput` (worker/)
 - checks the tape, signature, seed, TS replay score, best score, tape hash
 - stores the tape in R2
 - relay lanes: one RelayDO per relay key signs and sends `submit_score`, tracks the run
 - crons: create the epoch seed (10 min), index ScoreSubmitted events into D1 (1 min)
 - serves config, seed, runs, tapes, leaderboard, profiles
        |
        |  Thruput transaction from a relay key (gas capacity reserved in HOG)
        v
 Thruput devnet
 - kalien_score: relay-only submit; verifies the signature, replays the tape with
   asteroids-core, stores the best score, mints, emits ScoreSubmitted
 - kalien_token: KALIEN ERC20, 7 decimals, only kalien_score can mint
```

## Components

| Path | What it is | Details |
|---|---|---|
| `asteroids-core/` | Rust game core: simulation, tape format, strict verifier. `no_std`, no allocation while it steps. Also the gas probe and the parity tool. | `asteroids-core/README.md`, `docs/thruput/kt-core.md` |
| `src/game/` | TypeScript twin of the game core. The browser plays it; the Worker pre-checks with it. | `docs/games/asteroids/` |
| `kalien-contract/` | Thruput contracts `kalien_score` and `kalien_token` (`thruput-sdk =0.54.0`), deploy and test scripts. | `kalien-contract/README.md`, `docs/thruput/kt-contract.md` |
| `shared/thruput/` | Claim digest helper, read/event/relay helpers (`kalien.ts`), generated TS bindings, devnet deployment record. | `shared/thruput/README.md` |
| `worker/` | Cloudflare Worker API, relay lanes (Durable Objects), seed cron, event indexer, deploy scripts. | `worker/README.md`, `docs/thruput/kt-worker.md` |
| `src/` (not `src/game/`) | React client: key wallet, play, submit, run history, leaderboard, replay. | `docs/thruput/kt-client.md` |
| `cli/` | `kalien` terminal client: key file, bots, submit, status. | `cli/README.md`, `docs/thruput/kt-cli.md` |
| `autopilot/` | Rust bot lab that makes and benchmarks tapes with the Rust core. | `autopilot/README.md` |
| `scripts/` | Tape tools and end-to-end scripts (`verify-tape.ts`, `generate-tape.ts`, `e2e-runs.ts`). | `docs/thruput/kt-cli.md` |
| `test-fixtures/` | Known tapes (seed, frames, score) used by every test layer. | `test-fixtures/README.md` |

## Game core and tape format

- **One rule set, two implementations.** `asteroids-core` (Rust) is the reference; the contract
  uses it. `src/game/` (TypeScript) must give the same state on every frame.
- **Determinism.** Integer and fixed-point math only (positions Q12.4, velocities Q8.8, angles as
  8-bit BAM). The game RNG is xorshift32 seeded from the tape seed. See
  [games/asteroids/03-INTEGER-MATH-SPEC.md](games/asteroids/03-INTEGER-MATH-SPEC.md).
- **Tape (version 4, rules tag AST4).** 16-byte header (magic, version, rules tag, seed, frame
  count), nibble-packed inputs (two frames per byte), 8-byte footer (claimed score, CRC-32 of
  header + body). Max 36,000 frames = 18,024 bytes. See
  [games/asteroids/02-VERIFICATION-SPEC.md](games/asteroids/02-VERIFICATION-SPEC.md).
- **Strict replay.** `verify_tape(tape, 36_000)` checks the container, replays every frame, runs
  the rule checks after every frame, and requires the replayed frame count and score to equal the
  tape. It returns `{ seed, frame_count, final_score }`.
- **Guest limits.** Thruput RV32 contracts have 64 KiB of memory and a bump allocator that never
  frees. The core keeps entities in fixed-capacity arrays and reads the packed tape in place.
  Strict replay needs about 5.3 KiB of stack. Contracts that replay tapes build with a 16 KiB
  stack; the default 30 KiB stack leaves too little heap for an 18,024-byte calldata buffer.
  Peak memory for a full tape in the gas probe: 41,323 of 65,536 bytes.
- **Tests.**
  - Golden baseline: frames, score, strict verdict, and a full-state hash after every frame for
    every known tape (`asteroids-core/tests/golden.rs`).
  - TS/Rust parity: `bun run asteroids-core/parity/parity.ts` replays random, patterned,
    mutated, autopilot, tampered, and invalid tapes with both sims. It compares the full state on
    every frame and counts any honest tape that the strict replay rejects. Last large run:
    3,580 tapes, 59.3M frames per side, 0 mismatches.

## On-chain contracts

Source: `kalien-contract/contracts/`. Interface: `docs/thruput/PORT-PLAN.md` ("Interface v2").
Deployment record: `shared/thruput/deployments/devnet.json`.

TODO(lead): the contract is at v3 in code (bounded relay allowlist of up to 8 relays,
`ScoreSubmitted` with `relay` and `submitted_at`, claimed tapes keep their `seed_id`,
permissionless pruning of expired runs and seeds, admin token handover) and migrated to
`thruput-sdk =0.54.0`, but it is not deployed on the new devnet yet. Update this section and the
interface from the kt-contract report after the redeploy. The rules below are v2 plus what v3 is
known to keep.

### `kalien_score`

- **Seeds.** `seed_id = block_time_seconds / 600` (10-minute epochs). The transaction
  `ensure_current_seed()` creates the seed of the current epoch:
  `sha256(source_tx_hash || seed_id || block_height || block_timepoint_ns)`, first 4 bytes
  little-endian (0 maps to `0xDEADBEEF`). The block fields stop a caller from grinding its own
  transaction hash. An epoch stays active for 24 hours (the current epoch and the 143 before it).
  `set_seed` (admin, for fixed-seed fixture tapes) is disabled for good by `lock_seeding()`;
  the devnet deploy locks seeding after the fixture runs.
- **`submit_score(player_pubkey, seed_id, tape, signature)`.** Cheap checks run first: not
  paused; the caller is an allowed relay (relay-only mode); the seed exists and is active; the
  tape container (including a zero padding nibble on odd frame counts); tape seed equals the
  stored seed; claimed score above 0 and above the player's best; tape hash not claimed. Then the
  Ed25519 signature check, then the strict replay. On success it stores the best score and tape
  hash, mints `(new_best - previous_best) * 10^7` base units of KALIEN to the player, and emits
  `ScoreSubmitted`.
- **Claim digest.** The player signs the 32-byte digest
  `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))`.
  The relay cannot change the tape, the epoch, or the reward address. `shared/thruput/claim.ts`
  makes the same bytes for the browser, Worker, and CLI (vectors in
  `shared/thruput/claim-vectors.json`). Inputs may be base58 or hex; the digest bytes are the same.
- **Player address.** The nonce-0 pubkey account of the player key (wire 14:
  `publicKeyHash = sha256(00 09 "PublicKey" || 00 || pk)`,
  `address = sha256(00 0d "PubkeyAccount" || publicKeyHash || 00)`, printed in base58). The
  player needs no HOG and no deployed account to receive KALIEN.
- **Rejections are cheap.** Every rejection except a lying footer score costs at most about
  0.45M gas. `ScoreMismatch` needs the full replay (about 74M gas for a full tape), which is why
  the Worker replays the tape in TS first.
- **Cost of a run.** About 2,065 gas per frame + 0.2M. A 36,000-frame tape uses 67M–74M gas.
  The Worker relay sets the gas limit from the frame count (`RELAY_GAS_BASE` 3,000,000 +
  `RELAY_GAS_PER_FRAME` 2,300 × frames, at most `RELAY_GAS_MAX` 90M, plus 100,000 for the wallet
  root; the contract scripts use `3,000,000 + 2,200 × frames`). Gas is reserved against the
  sender's free HOG, not burned.
- **Storage.** Each accepted run that creates a new best entry costs the score contract about
  0.0036 HOG of storage deposit, plus about 0.002 HOG on the token per new holder. The contracts
  pay from their own balance (50 HOG each at deploy covers about 14,000 runs). When it runs out,
  new runs stall (excluded from blocks), so the balance needs monitoring.

### `kalien_token`

Standard Thruput ERC20 with metadata "Kalien" / "KALIEN" / 7 decimals. After deploy, the score
contract becomes the token administrator, so it is the only minter.

## Worker

Source: `worker/` (`worker/README.md`). Name `kalien-thruput`, Cloudflare account "Ecosystem -
Stellar". API: `docs/thruput/PORT-PLAN.md` ("Worker API v0 (as built)").

- **Run intake (`POST /api/runs`).** Checks size, container (including the padding nibble and
  the frame cap), dedupe, seed window, claim signature, TS replay score (`worker/replay.ts` with
  `src/game/`), stored seed, `is_claimed`, and `best_score` before it spends gas. Stores the tape
  in R2 (`kalien-thruput-tapes`). `runId = sha256(tape)`.
- **Relay lanes.** `RELAY_SECRETS` holds one Ed25519 seed per lane. Each lane is one `RelayDO`
  (Durable Object) with its own key. A run's lane is `hash(runId) mod lanes`, so two lanes never
  send the same run. Each lane signs, writes the signed transaction to its SQLite journal, then
  broadcasts. It re-sends the same bytes after a timeout and makes a new transaction only after
  the old one is dead (past expiry, no receipt, tape hash still unclaimed). Each in-flight run
  reserves its gas limit in that lane's free HOG. Every relay address must be on the contract's
  relay allowlist. `worker/ops/relay-keys.ts` lists, funds, and exports lane keys.
- **Seed cron (every 10 minutes).** Calls `ensure_current_seed()` through a relay.
- **Indexer cron (every minute).** Walks `ScoreSubmitted` events into D1
  (`kalien-thruput-leaderboard`) and re-arms overdue relay alarms. The relay also writes a row
  when it confirms a run. D1 and relay state are scoped per score contract, so a redeploy starts
  clean, and D1 can be rebuilt from the chain events alone.
- **Reads.** `/api/config`, `/api/seed/current`, `/api/runs/:id`, `/api/runs?player=` (merged
  across lanes, paged), `/api/runs/:id/tape` (only after confirmation), leaderboard, player page,
  signed profiles, `/api/health`.
- **Limits.** Per-IP 120 submissions / 10 min, per key 30 / 10 min (in memory, per isolate).
- **RPC rules (wire 14).** Named params objects, base58 identifiers, lowercase `0x` hex
  payloads, decimal-string heights and gas. Admission (`sendTransaction`) is not commitment
  (`getTransactionStatus`), and commitment is not success (`receipt.execution.result`). Cursor
  walks end only at `nextCursor: null`. Never resubmit automatically after an uncertain send.
  Guide: `docs/thruput/reference/json-rpc-alpha-guide.md`.

## Browser key wallet

Source: `src/wallet/keyWallet.ts`, `src/hooks/useWallet.ts`.

- On the first visit the browser makes a 32-byte Ed25519 seed and keeps it in `localStorage`.
  There is no extension, passkey, or faucet step. Submitting a run is one tap.
- The address is the nonce-0 pubkey account of that key. The Wallet page shows the address, the
  KALIEN balance (ERC20 view through the RPC), and an explorer link.
- **Backup and move.** Export a checked backup string or a JSON file; import accepts those, the
  CLI key file, or a bare 32-byte seed (hex, base58, or an `S...` StrKey). The backup **is**
  the secret key.
  Import replaces the current key after a confirmation.
- After a run, the browser serializes the tape, signs the claim digest, posts the run, and polls
  `/api/runs/:id` until the run is `confirmed`, `rejected`, or `failed`.
- The browser uses the wire-14 address rules and base58 addresses (`src/wallet/keyWallet.ts`).
  TODO(lead): kt-client's report predates that migration; confirm the browser and CLI give the
  same address for one key against the shared vectors.

## Leaderboard indexing

- Source of truth: `ScoreSubmitted` events on chain. D1 is an index.
- The indexer stores rows and the event cursor together. A walk ends only at `nextCursor: null`;
  the next walk starts at the last stored block and dedupes it. Event identity is
  `(transaction hash, sequence number)`.
- Windows: last 10 minutes, last day, all time. One row per player (the best run in the window).
- Player page: totals (runs, best score, KALIEN minted), ranks, recent runs.
- Profiles (username, link) are signed by the player key over
  `["kalien-profile-v1", networkHash, address, timestamp, username, linkUrl].join("\n")`.

## CLI and autopilot

- `kalien` (`cli/`): makes a key file (`~/.config/kalien/key.json`, mode 0600), runs bot workers
  on the current seed, and submits tapes to the Worker API. Commands: `run`, `submit`, `status`,
  `whoami`, `key path|export|import|new`, `replay`. Keys move between the CLI, the browser, and
  `thruput keys` (`kalien key export --format hex|base58|strkey`).
- `autopilot/` (Rust): bot lab that generates and benchmarks tapes with the Rust core
  (`rust-autopilot generate`, `verify-tape`, `benchmark`). Its tapes submit with
  `kalien submit <tape>`.

## Life of one run

1. The client reads `/api/config` and `/api/seed/current` (seed id, seed, seconds left).
2. The player plays. The client records one input nibble per frame.
3. At game over (or at 36,000 frames) the client builds the tape and signs the claim digest.
4. `POST /api/runs` with the tape. The Worker checks it and replays it in TS. A wrong claim is
   rejected before any gas is spent.
5. A relay lane submits `submit_score` with a gas limit from the frame count.
6. The contract replays the tape. On success it mints and emits `ScoreSubmitted`.
7. The lane sees commitment, reads the receipt's `execution.result`, and marks the run
   `confirmed` or `rejected` (with the contract error). Typical end-to-end time is 2–6 s.
8. The leaderboard shows the run. Anyone can download the tape and replay it.

## Devnet operations

Details and commands: [OPERATIONS.md](OPERATIONS.md).

- **After a wipe:** read the new network hash (`getNetworkInfo`), run
  `kalien-contract/scripts/deploy-devnet.sh` (deploys, links the token, runs the fixtures,
  allows the relays, turns on relay-only mode, locks seeding, writes
  `shared/thruput/deployments/devnet.json`), then deploy the Worker (`bun run deploy`). The Worker
  reads the contracts from `devnet.json`; its state is per score contract, so it starts clean.
- **Funding:** the devnet faucet is the RPC method `faucet_requestAirdrop` (through
  `client.requestAirdrop`). Each relay lane needs free HOG for the gas limits of its in-flight
  runs (up to about 9 HOG per full-length run). Each contract needs HOG for storage deposits.
- **Secrets:** relay seeds in `~/.config/kalien-thruput/` (`relay.secret`, `relay-2.secret`, …,
  mode 600) and the Worker secrets `RELAY_SECRETS` and `DEV_API_KEY`; deploy keys in
  `~/.config/thruput/keys/`; browser keys only in the player's browser. Never in git or logs.

## Trust model and known limits

- The contract is the judge. The Worker pre-checks only to save gas; it cannot make a bad run
  pass. In relay-only mode, the Worker's relays are the only submit path.
- The relay cannot redirect a reward or change a run, because the player signs the tape hash,
  epoch, network, and contract. A relay (or the Worker) can only refuse or delay a run.
- The admin can pause, change the admin, and change the relay allowlist. Seeding is locked after
  deploy.
- The block proposer sets the block time, so a malicious proposer could bias new seeds. On
  devnet the proposer is the operator.
- Contracts are immutable. A change needs a redeploy, and players' old best scores and balances
  stay on the old contract.

## Copycat tapes (decided)

All players share one seed per epoch, and tapes are public (on-chain calldata and the Worker
replay endpoint). Tape dedupe is by `sha256(tape)`. A copier can take a confirmed top tape,
change an input that has no effect (a frame during respawn, a frame after the last score event),
sign it with their own key, and get the same score and the same KALIEN on that seed within the
24-hour window. The padding-nibble variant is already blocked (`TapeBadPadding`). A front-runner
can also submit an exact copy first.

Options, from cheap to strong, are in
[games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md](games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md):
serve tapes only after their epoch closes, require tapes to end soon after game over, an
"effective input" dedupe hash, or a per-player game seed
(`sha256(epoch_seed || player_pubkey)`), which ends copying but also ends the shared asteroid
layout per epoch.

**Decision 2026-10-24: accepted for devnet; options kept for a future mainnet-like deployment.**

## Other TODO(lead) items

- TODO(lead): final devnet addresses (score, token, relays) after the redeploy on the wiped
  devnet. They will be in `shared/thruput/deployments/devnet.json`.
- TODO(lead): the Worker URL `https://kalien-thruput.sdf-ecosystem.workers.dev` is not confirmed
  live on the new devnet.
- TODO(lead): number of relay lanes and their HOG funding for launch.
- TODO(lead): rate limits are per isolate and in memory.
