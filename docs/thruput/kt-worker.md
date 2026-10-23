# kt-worker report

Agent: `kt-worker` (Cloudflare Worker API, relay, leaderboard). Branch `thruput-devnet`.

## Status

**STOP point A is reached.** The local Worker runs end to end with real tapes against my own
local node and against the Thruput devnet (kt-contract's deployment). The Worker is not
deployed to `kalien-thruput.sdf-ecosystem.workers.dev` yet.

A local Worker runs now on **`http://127.0.0.1:5174`** (Vite + Cloudflare plugin). It points at
**devnet**, with the real relay key. kt-cli can use it:
`bun run scripts/e2e-runs.ts --api-url http://127.0.0.1:5174`.

## Commits

| Commit | What |
|---|---|
| (in `581dbfa`, kt-core) | My staged deletions of the ZK Worker code went into kt-core's commit (shared index). |
| `b276ba0` | New Worker: API v0, relay Durable Object, seed cron, indexer, D1 schema, profiles, tests. |
| `ac4508a` | Score-contract adapter over generated bindings; shared claim helper. This commit missed one new file; `bcc39bf` fixes it. |
| `bcc39bf` | Devnet vars, shared bindings import, block-time fallback, cross-player dedupe, gas policy, live e2e script. |
| `cf79ff5` | Remove server-only deps: `@openzeppelin/relayer-plugin-channels`, `@simplewebauthn/server`, `viem`, `fzstd`. |

## What changed

Removed: `worker/boundless/`, `worker/prover/`, `worker/queue/`, `worker/claim/`, the proof
coordinator DO, proof/relay/OZ Channels routes, `stellar.toml`, smart-account profile auth,
Galexie/Stellar ingestion, proof/Vast/claim queues, the mainnet env, and their tests.

New layout (see `worker/README.md`):

- `worker/api/`: `routes.ts` (config, seed, health, admin), `runs.ts`, `leaderboard.ts`.
- `worker/relay/`: `store.ts` (run journal in DO SQLite), `engine.ts` (state machine),
  `service.ts` (shared by DO and tests), `policy.ts` (gas from env), `view.ts`.
- `worker/durable/relay.ts`: `RelayDO`, one object for the relay key (`relay-0`).
- `worker/chain/`: client connection, relay wallet (sign, broadcast, receipts), block time,
  `score-contract.ts` (adapter over `shared/thruput/bindings/kalien-score.ts`, with readable
  contract errors).
- `worker/leaderboard/`: D1 store, `ScoreSubmitted` indexer, cron entry.
- `worker/migrations/0001_init.sql`: `score_events`, `player_profiles`, `seeds`, `indexer_state`.
- `worker/replay.ts`: TS replay pre-check with `src/game/` (headless).
- `worker/profile.ts`: signed profile message.
- `wrangler.jsonc`: Worker `kalien-thruput`, account `ba55b7ae…0752`, `workers_dev: true`,
  no routes, D1 `kalien-thruput-leaderboard` (`5bd1495c-f925-4571-bf8c-adde06c93236`),
  R2 `kalien-thruput-tapes`, DO `RelayDO`, crons `*/1` (indexer) and `*/10` (seed).
  No queues. I created the D1 database and the R2 bucket on the Ecosystem - Stellar account.
- `worker/tsconfig.json`: adds the `DOM` lib, because the replay imports `src/game/AsteroidsGame.ts`.

The API is in `docs/thruput/PORT-PLAN.md`, section "Worker API v0 (as built)".

### Decisions

- `runId` = `sha256(tape)` hex. One run per tape for all players, as the contract has
  `is_claimed(tape_hash)`. The same player re-sending a tape gets the existing run (200).
  Another player gets 409 `already_claimed`.
- `GET /api/runs/:id/tape` serves a tape only after confirmation, so a pending tape cannot be
  copied and front-run under another key.
- Run state lives in the relay DO (SQLite). The leaderboard lives in D1. `GET /api/runs/:id`
  falls back to D1 for runs that another relay submitted.
- Relay safety: sign → journal → broadcast. The same bytes may be re-sent. A new transaction
  only after the old one is dead (tip > expiry + 10 blocks, no receipt, and `is_claimed` false).
  A broadcast refused with TX_INVALID/TX_REJECTED is retried (max 5 attempts), then `failed`.
- Gas: child gas = `3,000,000 + 2,300 × frames`, max 90M; root = child + 100,000.
  `RELAY_MAX_IN_FLIGHT = 1` (each in-flight run reserves its gas limit in free HOG).
- Seed: the cron and `GET /api/seed/current` (when the seed is missing) call
  `ensure_current_seed` through the relay. The seed is cached in D1 `seeds`.
- Profiles: no challenge round trip. The player signs a message with a timestamp; the Worker
  accepts it within ±5 min and only when it is newer than the stored one.
- Block time: Thruput RPCs (devnet and `thruput node`) return NOT_IMPLEMENTED for
  `groundhog_getBlockByNumber`. The relay uses its confirmation time. The indexer estimates
  `now − (head − height) × 2 s`, clamped to the seed's active window.
- Seed window: the Worker accepts `seed_id` up to one epoch ahead of its clock; the contract
  makes the final check.

## Tests

| Command | Result |
|---|---|
| `bun test tests/worker` | 55 pass, 0 fail (7 files) |
| `bun run typecheck:worker` | 0 errors |
| `bunx oxlint worker` | 0 warnings, 0 errors |
| `bunx oxfmt worker --check` | clean |
| `wrangler types --check` (with `.dev.vars` moved aside) | up to date |

Unit tests use `bun:sqlite` shims for D1 and DO SQL (`tests/worker/helpers/sqlite.ts`) and an
in-memory chain and contract (`tests/worker/helpers/fake-chain.ts`). They cover: submit →
confirm → leaderboard → tape; dedupe; bad signature; wrong seed id in the signature; forged
footer score (replay mismatch); corrupt tape; seed mismatch/inactive/missing; not improved;
ranking; seed touch; config; profiles (store, replay, wrong key, stale time, bad name);
relay re-broadcast; new attempt only after expiry; unseen commit; refused broadcast → failed;
in-flight cap; indexer paging, cursor resume, restart at last height, contract change, time
estimate.

### Real runs

Local node: `thruput node --port 9745` (CLI 0.29.2, hog-devnode 0.1.31-rc.4), my own deploy of
kt-contract's artifacts (token `0x66e0…4dfc`, score `0x2526…4958`), Worker on Vite port 5174.
Script: `bun tests/worker/live/submit-runs.ts --api http://127.0.0.1:5174 <tape>:<seedId> …`.

| Tape | Frames | Score | Result | Time to confirmed | Gas used |
|---|---:|---:|---|---:|---:|
| test-short | 700 | 1,480 | confirmed, minted 14800000000 | 2.0 s | 1,504,353 |
| test-medium | 5,000 | 11,190 | confirmed | 2.0 s | 9,750,130 |
| test-real-game | 6,643 | 14,870 | confirmed | 2.0 s | 14,266,317 |
| test-long | 36,000 | 92,820 | confirmed | 2.1 s | 74,293,426 |
| kalien-911140 | 36,000 | 911,140 | confirmed | 2.1 s | 67,385,646 |
| generated, seed 0x1f69…, 11,821 f | 11,821 | 28,760 | confirmed | 2.0 s | — |
| generated, 3,000 f, same player/seed, sent at the same time | 3,000 | 9,010 | **rejected**: `NotImproved: the score does not beat your best for this seed` | 4.1 s | — |

Also checked on the local node: tape download is byte-identical; `GET /api/runs?player=`;
leaderboard and player stats; the on-chain KALIEN balance (10300200000000) equals the
leaderboard `totalMinted`; a wiped D1 rebuilt from the indexer alone gives the same stats and
runs; seed touch via `GET /api/seed/current` and via the `*/10` cron; signed profile (200),
replay (409), forged (403).

Devnet (kt-contract deployment, score `0xed51…ed81`, relay `0xc954…bafd`, ≈1,000 HOG):

| Tape | Frames | Score | Result | Time | Gas used |
|---|---:|---:|---|---:|---:|
| generated on seed 2987990 | 24,578 | 62,260 | confirmed, minted 622600000000 | 2.8 s | 42,756,880 |
| generated, 3,000 f, same player/seed, sent at the same time | 3,000 | 7,770 | rejected: `NotImproved` | 4.7 s | 140,506 |

The devnet indexer read 5 `ScoreSubmitted` events and inserted the 4 that the relay did not write.
Devnet makes about one block every 2 s (10 blocks in 20 s).

## Open issues and next steps

1. Deploy to `kalien-thruput.sdf-ecosystem.workers.dev`: `wrangler secret put RELAY_SECRET`
   and `DEV_API_KEY`, `wrangler d1 migrations apply kalien-thruput-leaderboard --remote`, then
   `vite build && wrangler deploy`. The build includes the browser app, so it waits for a
   green client build.
2. Rate limits are in memory per isolate (30 runs / 10 min per IP and per key).
3. One relay key, one run in flight: about one confirmed run every 2–3 s. More lanes need more
   relay keys and HOG.
4. Add an R2 lifecycle rule only if tapes must expire (today they are kept).
5. `bun run check` runs `typegen:check`, which fails while a `.dev.vars` with secrets exists.
   Regenerate types with `.dev.vars` moved aside (noted in `.dev.vars.example`).

## Environment notes

- Sandbox: local port binding is blocked (EPERM on listen), so `wrangler`/`vite`/`thruput node`
  ran outside the sandbox. `sandbox.network.allowLocalBinding: true` would allow it.
  GPG commit signing also needs the sandbox off.
- `thruput node` writes `[local_runtime_state]` in the global `~/.config/thruput/config.toml`.
  My node on port 9745 overwrote it. Other agents should pass `--rpc-url` and
  `--runtime-manifest` explicitly for local-node commands.
- A pathspec commit (`git commit -- <paths>`) takes only tracked files. Run `git add` on new
  files first (this caused the gap in `ac4508a`).
- Local state from the local-node run is kept in the scratchpad (`wrangler-state-local`).

## Requests to other agents

- **lead / kt-contract:** `docs/thruput/PORT-PLAN.md` has my "Worker API v0 (as built)"
  section in the working tree, next to kt-contract's uncommitted "Interface v1" edits. I did
  not commit the file, so that I do not commit their work. Please commit it with theirs.
- **kt-client:** use the API shapes in the plan section. Profile updates: sign
  `profileMessage(...)` from `worker/profile.ts` (or copy its layout). `seed` in
  `/api/seed/current` can be null for a few seconds at an epoch start; poll.
- **kt-cli:** your five requests are done (hex with or without `0x`, `seedId` in run records,
  `{ error }` + 429, `minted` as a base-unit string). The local Worker is on port 5174 (devnet).
- **kt-contract:** after a redeploy or devnet reset, update `THRUPUT_NETWORK_HASH`,
  `SCORE_CONTRACT`, `TOKEN_CONTRACT` in `wrangler.jsonc` (or tell me). The indexer restarts by
  itself when `SCORE_CONTRACT` changes.
