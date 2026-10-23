# Kalien architecture (Thruput devnet)

Kalien is a deterministic Asteroids game. A player plays in the browser (or a bot plays in the
CLI). The game records every frame's input on a **tape**. A Thruput smart contract replays the
tape on chain with the Rust game core. If the replayed score is a new best for that player and
seed epoch, the contract mints KALIEN tokens for the improvement.

There is no zero-knowledge proof. The chain itself runs the replay. One transaction replays a
full 36,000-frame (10-minute) tape.

## System map

```text
 Browser (src/)                        CLI / autopilot (cli/, autopilot/)
 - plays the game (src/game, TS)       - bots play the same game (Rust or TS)
 - Ed25519 key in localStorage         - Ed25519 key file
 - signs the claim digest              - signs the claim digest
        |                                         |
        |  POST /api/runs?pubkey&seed_id&sig  (raw tape body)
        v                                         v
 Cloudflare Worker `kalien-thruput` (worker/)
 - checks the tape, signature, seed, TS replay score, best score
 - stores the tape in R2
 - RelayDO: relay wallet signs and sends `submit_score`, tracks the run
 - crons: create the epoch seed (10 min), index ScoreSubmitted events into D1 (1 min)
 - serves config, seed, runs, tapes, leaderboard, profiles
        |
        |  Thruput transaction (relay pays gas capacity in HOG)
        v
 Thruput devnet
 - kalien_score (kalien-contract/contracts/kalien_score)
     verifies the signature, replays the tape with asteroids-core,
     stores the best score, mints, emits ScoreSubmitted
 - kalien_token (kalien-contract/contracts/kalien_token): KALIEN ERC20, 7 decimals
```

## Components

| Path | What it is | Owner report |
|---|---|---|
| `asteroids-core/` | Rust game core: simulation, tape format, strict verifier. `no_std`, no allocation while it steps. | `docs/thruput/kt-core.md` |
| `src/game/` | TypeScript twin of the game core. The browser plays it; the Worker pre-checks with it. | `docs/thruput/kt-core.md` (parity) |
| `kalien-contract/` | Thruput contracts `kalien_score` and `kalien_token`, deploy and test scripts. | `docs/thruput/kt-contract.md` |
| `shared/thruput/` | Claim digest helper, generated TS bindings, devnet deployment record. | `docs/thruput/kt-contract.md` |
| `worker/` | Cloudflare Worker API, relay Durable Object, seed cron, event indexer. | `docs/thruput/kt-worker.md` |
| `src/` (other than `src/game/`) | React client: key wallet, submit flow, run history, leaderboard, replay. | `docs/thruput/kt-client.md` |
| `cli/` | `kalien` terminal client: key file, bots, submit, status. | `docs/thruput/kt-cli.md` |
| `autopilot/` | Rust bot lab that makes tapes with the Rust core. | `autopilot/README.md` |
| `scripts/` | Tape tools and end-to-end scripts (`verify-tape.ts`, `generate-tape.ts`, `e2e-runs.ts`). | `docs/thruput/kt-cli.md` |
| `test-fixtures/` | Known tapes (seed, frames, score) used by every test layer. | `test-fixtures/README.md` |

## Game core

- **One rule set, two implementations.** `asteroids-core` (Rust) is the reference. The contract
  uses it. `src/game/` (TypeScript) must give the same state on every frame.
- **Determinism.** Integer and fixed-point math only (positions Q12.4, velocities Q8.8, angles as
  8-bit BAM). The game RNG is xorshift32 from the tape seed. See
  [games/asteroids/03-INTEGER-MATH-SPEC.md](games/asteroids/03-INTEGER-MATH-SPEC.md).
- **Tape format (v4, rules tag AST4).** 16-byte header (magic, version, rules tag, seed,
  frame count), nibble-packed inputs (2 frames per byte), 8-byte footer (claimed score, CRC-32
  of header + body). Max 36,000 frames = 18,024 bytes. See
  [games/asteroids/02-VERIFICATION-SPEC.md](games/asteroids/02-VERIFICATION-SPEC.md).
- **Strict replay.** `verify_tape(tape, 36_000)` checks the container, replays every frame, runs
  the rule checks after every frame, and requires the replayed frame count and score to equal the
  tape. It returns `{ seed, frame_count, final_score }`.
- **Guest limits.** Thruput RV32 contracts have 64 KiB of memory and a bump allocator that never
  frees. The core keeps entities in fixed-capacity arrays and reads the packed tape in place.
  Strict replay needs about 5.3 KiB of stack. Contracts that call it must build with a 16 KiB
  stack (the default 30 KiB stack leaves too little heap for an 18,024-byte calldata buffer).
- **Tests.**
  - Golden baseline: frames, score, strict verdict, and a full-state hash after every frame for
    every known tape (`asteroids-core/tests/golden.rs`).
  - TS/Rust parity: `bun run asteroids-core/parity/parity.ts` replays random, patterned,
    mutated, autopilot, tampered, and invalid tapes with both and compares the full state on
    every frame.

## On-chain contracts

Source: `kalien-contract/contracts/`. Interface: `docs/thruput/PORT-PLAN.md`, section
"Interface v1". Deployed addresses: `shared/thruput/deployments/devnet.json`.

### `kalien_score`

- **Seeds.** `seed_id = block_time_seconds / 600` (10-minute epochs). The seed for an epoch is
  created by the transaction `ensure_current_seed()`:
  `sha256(source_tx_hash || seed_id)`, first 4 bytes little-endian (0 maps to `0xDEADBEEF`).
  An epoch is active for 24 hours (the current epoch and the 143 before it).
- **`submit_score(player_pubkey, seed_id, tape, signature)`.** Cheap checks first: not paused,
  seed exists and is active, tape container, tape seed equals the stored seed, claimed score
  above 0 and above the player's best, tape hash not claimed. Then the Ed25519 signature check,
  then the strict replay. On success it stores the best score and tape hash, mints
  `(new_best - previous_best) * 10^7` base units of KALIEN to the player, and emits
  `ScoreSubmitted`.
- **Claim digest.** The player signs the 32-byte digest
  `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))`.
  The relay cannot change the tape, the epoch, or the reward address. `shared/thruput/claim.ts`
  makes the same bytes for the browser, Worker, and CLI (test vectors in
  `shared/thruput/claim-vectors.json`).
- **Player address.** The nonce-0 pubkey account of the player key
  (`derivePubkeyAccountAddress` / `createPubkeyAccount` in `@thruputchain/client`). The player
  does not need HOG or a deployed account to receive KALIEN.
- **Cost.** Whole `submit_score`: about 2,065 gas per frame + 0.2M. A 36,000-frame tape uses
  67M–74M gas. The relay sets the gas limit from the frame count. Gas is reserved against the
  sender's free HOG, not burned.

### `kalien_token`

Standard Thruput ERC20 (`thruput-erc20-if`) with metadata "Kalien" / "KALIEN" / 7 decimals.
After deploy, `set_administrator(score)` makes the score contract the only minter.

## Worker

Source: `worker/` (see `worker/README.md`). Name `kalien-thruput`, account "Ecosystem -
Stellar". API: `docs/thruput/PORT-PLAN.md`, section "Worker API v0 (as built)".

- **Run intake (`POST /api/runs`).** Checks size, container, dedupe, seed window, claim
  signature, TS replay score (`worker/replay.ts` with `src/game/`), stored seed, `is_claimed`,
  and `best_score` before it spends gas. Stores the tape in R2 (`kalien-thruput-tapes`).
  `runId = sha256(tape)`.
- **Relay (`RelayDO`).** One Durable Object per relay key. It signs, writes the transaction to
  its SQLite journal, then broadcasts. It re-sends the same bytes after a timeout and makes a new
  transaction only after the old one has expired. One run is in flight at a time, because each
  in-flight run reserves its gas limit in free HOG.
- **Seed cron (every 10 minutes).** Calls `ensure_current_seed()` through the relay.
- **Indexer cron (every minute).** Reads `ScoreSubmitted` events from the RPC into D1
  (`kalien-thruput-leaderboard`). The relay also writes a row when it confirms a run. D1 can be
  rebuilt from the chain events alone.
- **Reads.** `/api/config`, `/api/seed/current`, `/api/runs/:id`, `/api/runs?player=`,
  `/api/runs/:id/tape` (only after confirmation), leaderboard, player page, signed profiles.

## Browser key wallet

Source: `src/wallet/keyWallet.ts`, `src/hooks/useWallet.ts`.

- On the first visit the browser makes a 32-byte Ed25519 seed and keeps it in `localStorage`.
  There is no extension, passkey, or faucet step.
- The address is the nonce-0 pubkey account of that key. The Wallet page shows the address, the
  KALIEN balance (ERC20 view through the RPC), and an explorer link.
- Backup and move: export a checked backup string or a JSON file; import accepts those, the CLI
  key file, or a bare 32-byte hex seed. The backup is the secret key.
- After a run, the browser serializes the tape, signs the claim digest, posts the run, and polls
  `/api/runs/:id` until the run is `confirmed`, `rejected`, or `failed`.

## Leaderboard

- Source of truth: `ScoreSubmitted` events on chain. D1 is an index.
- Windows: last 10 minutes, last day, all time. One row per player (the best run in the window).
- Player page: totals (runs, best score, KALIEN minted), ranks, recent runs.
- Profiles (username, link) are signed by the player key over
  `["kalien-profile-v1", networkHash, address, timestamp, username, linkUrl].join("\n")`.
- Thruput RPCs do not serve block times yet, so `closedAt` is the relay confirmation time or an
  estimate from the block height.

## CLI and autopilot

- `kalien` (`cli/`): makes a key file (`~/.config/kalien/key.json`), runs bot workers on the
  current seed, and submits tapes to the Worker API. Commands: `run`, `submit`, `status`,
  `whoami`, `key path|export|import|new`, `replay`. The key moves between the CLI and the
  browser with `kalien key export` / import.
- `autopilot/` (Rust): bot lab that generates and benchmarks tapes with the Rust core
  (`rust-autopilot generate`, `verify-tape`, `benchmark`). Its tapes submit with
  `kalien submit <tape>`.

## Life of one run

1. The client reads `/api/config` and `/api/seed/current` (seed id, seed, seconds left).
2. The player plays. The client records one input nibble per frame.
3. At game over (or at 36,000 frames) the client builds the tape and signs the claim digest.
4. `POST /api/runs` with the tape. The Worker checks it and replays it in TS. If the TS score
   does not equal the claim, the Worker rejects the run before any gas is spent.
5. The relay submits `submit_score` with gas limit `3,000,000 + 2,300 * frames` (+ 100,000 for
   the wallet root).
6. The contract replays the tape. On success it mints and emits `ScoreSubmitted`.
7. The relay sees the receipt (devnet makes a block about every 2 s) and marks the run
   `confirmed`. Typical end-to-end time is 2–6 s.
8. The leaderboard shows the run. Anyone can download the tape and replay it.

## Trust model and known limits

- The contract is the judge. The Worker pre-checks only to save gas; it cannot make a bad run
  pass.
- The relay cannot redirect a reward or change a run, because the player signs the tape hash,
  epoch, network, and contract. The relay can only refuse or delay a run.
- Seeds come from the hash of the transaction that first touches an epoch. Whoever sends that
  transaction can try many transactions and pick a seed. On devnet the relay sends it.
- `set_seed` lets the admin choose the seed of an empty active epoch (used for fixed-seed
  fixture tapes on devnet).
- Tape dedupe is by `sha256(tape)`. A copied tape cannot be claimed again as-is. But different
  bytes can replay to the same score (see
  [games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md](games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md)),
  so a copier can claim a modified copy of a public tape under another key.
- A front-runner who sees a tape in the mempool can submit it first under its own key.
- Contracts are immutable. A change needs a redeploy, and a devnet wipe changes the network
  hash and all addresses (see [OPERATIONS.md](OPERATIONS.md)).

## TODO for the lead (facts still in flux)

- TODO: the Worker is not deployed to `https://kalien-thruput.sdf-ecosystem.workers.dev` yet
  (kt-worker report, open issue 1). Update this doc when it is live.
- TODO: decide on the tape-malleability fix (zero padding nibble, and a rule for frames after
  game over, or a dedupe key that does not depend on raw bytes). It needs a coordinated change in
  `asteroids-core`, `src/game/tape.ts`, the contract, and the Worker.
- TODO: decide whether `set_seed` stays in a production deploy, and whether seed creation needs
  a source that the first caller cannot grind.
- TODO: relay throughput is one run in flight per relay key (about one run every 2–3 s). More
  lanes need more relay keys and HOG.
- TODO: rate limits are per isolate and in memory (kt-worker report).
