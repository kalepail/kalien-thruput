# kt-worker report

Agent: `kt-worker` (Cloudflare Worker API, relay, leaderboard). Branch `thruput-devnet`.

## Round 5 (2026-10-24): gas margin, out-of-gas retry, failed-run investigation

**Status: deployed (version `d5b258ad-0c86-4d2b-b89d-87c7d5cdf403`) and smoke-tested.**
URL: https://kalien-thruput.sdf-ecosystem.workers.dev

### Gas policy

- Child gas = `RELAY_GAS_BASE` 5,000,000 + `RELAY_GAS_PER_FRAME` 3,000 × frames, capped at
  `RELAY_GAS_MAX` 113,000,000 (36,000 frames: 113M ≈ 11.3 HOG reserved per in-flight tx; gas is
  not burned). Root = child + 100,000. All in `wrangler.jsonc` vars.
- Measured range: 1,758–2,501 gas/frame (kt-cli round 4 and the run below); 36,000 frames 67–74.5M.
  Margin at the worst seen rate: 16,096 frames needs 40.3M, limit 53.3M.
- Out of gas is detected from the committed receipt (no guessing; wire-14 rules):
  - root `fault` with `gasUsed` ≥ root limit, or
  - root `abort` without a contract `ScoreError` and `gasUsed` ≥ child limit (the DefaultWallet
    re-throws a failed child call; this is how it shows on devnet).
  A committed failure changed no state, so the run gets **exactly one** new transaction at 1.5×
  child gas (max `RELAY_GAS_RETRY_MAX` 150M). That attempt checks `is_claimed` first, as every
  retry does, and the contract rejects a claimed tape hash, so no double submit is possible. A
  second out-of-gas, or any other fault, fails the run at once (a fault repeats for the same input).

### The failed run on lane 3 (cause: ours, fixed)

New ops routes (`Authorization: Bearer <DEV_API_KEY>`): `GET /api/admin/runs?status=failed,rejected`
and `POST /api/admin/runs/:id/retry`.

- Run `02206b1f8592bb768b32d15b1e9a6a3cc157b3a7231bbb259b1197bd97abc457`, player
  `BEC6xsJrnZiFtqNELgqCNzzAWSBrx9iXsaiBmoW6ZFkh`, seed 2988062, 16,096 frames, score 39,730.
  Failed at 10:32 UTC after 5 attempts with "aborted without a ScoreError".
- Receipt of the last attempt (`Dz2UDA3yAoGacaye6YLcUAWyU2hFN5sEhD2hBwsVhmP9`): `abort`,
  `abortData 0xffdf1b7dd397321d9306` (a wallet error, not `ScoreError`), `gasUsed` 40,020,950.
  The child budget was 3,000,000 + 2,300 × 16,096 = 40,020,800. So the child ran out of gas
  (≈ 2,486 gas/frame for this game), and the wallet root aborted. The old code saw a generic
  relay fault and retried 5 times with the same gas.
- Fix: the wider gas policy, and an undeclared abort that used the whole child budget now counts as
  out of gas (one boosted retry). I re-queued the run with the admin route: **confirmed** at block
  28193, tx `9cRRPSmzJG4xi2TZxGScVhVGaFnh67X7pjPPYkEiWL1F`, gas used 40,252,424 (2,501/frame),
  minted 378500000000. No failed or rejected runs remain.
- The first retry call returned 500 right after the deploy (Durable Object code restart); the
  second call worked.

### Tests and results

| Check | Result |
|---|---|
| `bun run check` | green |
| `bun test tests/worker` | 74 pass, 0 fail (new: out-of-gas fault retry, wallet-abort out of gas, second OOG fails, other fault fails at once, admin list, admin retry) |
| Deployed smoke (`bun worker/ops/smoke.ts`), 16:15 UTC | PASS, 2,257 frames, confirmed in 4.3 s |
| `/api/admin/runs?status=failed,rejected` after the fix | 0 runs |
| Indexer | synced 16:14:35 UTC, 34 events |
| Remote D1 | `migrations apply --remote` now reports "No migrations to apply" (no 7403 this time) |

## Round 4 (2026-10-24): deployed on the wire-14 devnet (v3)

**Status: deployed and smoke-tested. URL: https://kalien-thruput.sdf-ecosystem.workers.dev**

- Contracts: from `shared/thruput/deployments/devnet.json` (v3): score
  `8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT`, token `AZGTgZfoVoLZpTquPLpPpA1pUbvC4SRfLc5tjWXfHk87`,
  network hash `DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj`. No Worker code change was needed.
- Deploy: `bash worker/ops/deploy.sh --secrets` (checks, build, remote D1 migration, deploy, secrets
  `RELAY_SECRETS` with all 4 lane keys and `DEV_API_KEY`). First version `b1d0f1ca-ff57-48e8-b915-c31a453d8bb9`.
- Remote D1: `wrangler d1 migrations apply --remote` fails on this account with API error 7403
  (twice, on two days), while `d1 execute --remote --file` works. I applied `0001_init.sql` with
  `execute --file` and recorded it in `d1_migrations`. `deploy.sh` now does this automatically when
  `migrations apply` fails. `secret put` now passes `--env=""` (top-level env, explicit).
- `shared/thruput/kalien.ts` (wire 14) is not used yet; the Worker's own chain code was already
  correct, so I did not delay the deploy. Candidate for a later cleanup (reads and event paging).

| Check | Result |
|---|---|
| Local Worker (devnet mode) → v3 smoke | PASS, confirmed in 3.2 s; all 4 lanes `allowed` |
| Deployed smoke (`bun worker/ops/smoke.ts`), 10:24 UTC | PASS, real tape (2,837 frames, score 5,870) confirmed in 7.5 s |
| Deployed smoke, after RESUME (16:09 UTC) | PASS, 2,440 frames, score 3,020, confirmed in 6.3 s |
| `*/1` indexer cron | fired (tail: outcome ok, 2.7–4.1 s); D1 `indexer_state` synced 16:06:34 UTC, 30 events, no error |
| `*/10` seed cron | D1 `seeds`: 36 rows for 36 consecutive epochs 2988061–2988096 (10:22–16:00 UTC), each recorded 38–62 s after the 10-minute mark, including the pause when no client ran |
| `/api/health` (16:09 UTC) | lanes 0–3 allowed; confirmed 6/7/6/7; rejected 0; failed 1 (lane 3, another agent's run) |

Open: one `failed` run on lane 3 (from another agent's testing; I could not see its id). A failed run
retries on a new POST of the same tape. Wrangler warns that `secrets` in `wrangler.jsonc` is experimental.

## Round 3 (2026-10-24): wire-14 migration — green locally

**Status: STOP point reached.** The Worker runs on `@thruputchain/client 0.23.0` (wire 14,
base58) and passes end to end against a local `thruput node` (hog-devnode rc.14, wire 14.1.0).
It is **not deployed** yet: I wait for the lead (kt-contract v3 on the new devnet).

### Commits this round

| Commit | What |
|---|---|
| `d27f265` | Relay lanes (`RELAY_SECRETS`), run-list paging, alarm recovery, load test |
| `b988988` | Contracts from `shared/thruput/deployments/devnet.json`; deploy and smoke scripts |
| `39e76b5` | State per score contract (D1 + relay objects); relay faults retried; padding check |
| `c16c601` | Wire-14 migration, base58 ids, allowlist routing, `local` wrangler env |

### What changed

- `worker/chain/`: `Ed25519Signer.fromSeed`, native `sendTransaction` / `getTransactionStatus` /
  `getTransactionReceipt` / `getBlockByHeight` / `getEvents` via the SDK. Worker-owned types in
  `chain/types.ts` (`ChainReceipt`, `ChainStatus`), so the engine and tests do not depend on
  SDK shapes. Unfamiliar outcome variants map to `other` (never success).
- Relay rules from `docs/thruput/reference/json-rpc-alpha-guide.md`:
  - The relay saves the signed bytes and hash before it sends them.
  - If a status was ever `committed`, the relay never replaces the transaction; it waits for the receipt (indexer lag).
  - `retry`, `dropped`, `unknown`, `recentFailure`, and a refused re-send do not prove non-execution. Until the expiry height, the relay only re-sends the same bytes.
  - A refusal (`admission: rejected` or `notAttempted`) counts as non-admission only on the first send of those bytes.
  - After expiry plus 10 blocks, with no receipt, the relay reads `is_claimed` with `minStateBlockHeight = expiry + 1`. If the tape is not claimed, it signs a new transaction. This deliberate re-dispatch is safe, because the contract rejects a claimed tape hash (`AlreadyClaimed`), so a run cannot mint twice.
- Identifiers: base58 everywhere in the API and D1 (`worker/ids.ts`). Input accepts base58 or hex.
  The claim digest and the player address still come from `shared/thruput/claim.ts` (wrapped in
  `worker/claim.ts` for base58).
- Allowlist routing: `allowedLanes()` asks `is_relay` for each lane key (cached 60 s). New runs go
  only to allowed lanes (stable per run id). A failed run is re-queued in the lane that holds it.
  `/api/health` shows `allowed` per lane.
- Indexer: real block times from `getBlockByHeight` (the event's `submitted_at` as fallback); the
  old 2 s/block estimate is gone. A walk ends only at `nextCursor: null`; cursor errors are kept
  (no silent restart); a new score contract starts a new walk.
- `wrangler.jsonc`: `secrets.required` = `RELAY_SECRETS`, `DEV_API_KEY` (keeps `wrangler types`
  stable). New env `local` (`CLOUDFLARE_ENV=local`, keys from `.dev.vars.local`) for a local node;
  never deployed. `wrangler types --check` ignores `--env-file`, so that route does not work.
- Ops: `worker/ops/relay-keys.ts` (SDK client; list, fund, `--secrets` pipe), `deploy.sh`, `smoke.ts`.

### Firehose decision: not used (keep `getEvents`)

I read `reference/firehose.md` and decided not to use the Firehose:
- A Durable Object with an outbound WebSocket cannot hibernate, so it would stay awake (billed) all day.
- It would hold 1 of the 12 global public subscriber slots (experimental, no SLA, 8 connections per IP).
- It must decode a full block XDR record every ~2 s and ACK each block.
- It adds little. The contract is `relay_only`, so every `ScoreSubmitted` comes from our relay, and the relay writes the leaderboard row when it confirms the run. The 1-minute `getEvents` cron is only the repair and backfill path.

Revisit if non-relay submitters appear or sub-minute repair matters.

### Tests (all green)

| Command | Result |
|---|---|
| `bun run check` | typegen up to date, all typechecks, lint 0/0, format clean |
| `bun test tests/worker` | 69 pass, 0 fail (10 files) |

New unit tests: wire-14 receipt/status/send-error mapping, base58/hex ids, known commitment is
never replaced, a refused re-send is not proof of non-admission, NotRelay retried then failed,
allowlist routing (blocked lanes get no runs), contract switch resets state, padding nibble.

### Real runs: local rc.14 node (port 9745)

My own deploy of kt-contract's `42d0b48` artifacts: token `448VHqfwFgDaFTC2ZjNXGiSLzppP4JmEwKVBcgE5ieEv`,
score `HLFCaQzGjLuTytHs8WGjd3UbdiuNxwFoCqzpJ2gDsqvP`, relays lanes 0 and 2 allowed, `relay_only` on.
Worker: `CLOUDFLARE_ENV=local vite dev --port 5174`.

| Check | Result |
|---|---|
| `bun worker/ops/smoke.ts --api http://127.0.0.1:5174` | PASS (config, network hash, seed touch, POST, confirmed in 2.0 s, tape, list, leaderboard, health) |
| Fixtures (`tests/worker/live/submit-runs.ts`) | medium, test-long (36,000 f), kalien-911140 (36,000 f), real-game confirmed; a racing lower run rejected `NotImproved` |
| Gas used (wire 14) | medium 9,817,555; real-game 14,341,964; kalien-911140 67,608,071; test-long 74,515,851; rejected run 165,995 |
| Indexer rebuild (wipe D1, `POST /api/admin/sync`) | 5 events, identical stats and runs, exact block times; restart at last height dedupes |
| Load (`load-runs.ts --runs 12`) | 12/12 confirmed in 4.3 s; lanes 0 and 2 only (1 and 3 not allowed) |

Devnet: the four lane keys are funded on the new devnet (≈1,000 HOG each). Base58 addresses for the
v3 allowlist (`kalien-relay`, `kalien-relay-2..4`):
`94febNxmANEba5YFYVrrKvYEpTq7dEXzhqPARRCnUkMJ`, `63sSHUhsshPPYc6HATTfiJKBChhhUEpTnuMGvUBjXqYT`,
`9U7TwtWnL8mg2XYwf6L4R5TAzGnsYVwMxaPaM1Loj7PD`, `6uHAVi82rWirY492rSmd2oUXpmvUfmTBfiSBXdZtVrP8`.

### Left for the deploy (waiting for the lead)

Remote D1 migration (a 7403 error appeared once, then a remote query worked), `RELAY_SECRETS` and
`DEV_API_KEY` secrets, `worker/ops/deploy.sh --secrets`, `bun worker/ops/smoke.ts`, cron check.

### Requests

- **kt-contract:** the working-tree `shared/thruput/deployments/devnet.json` (uncommitted) pins
  network hash `DHsdn1…`, but devnet reports `DWELtF…`; the Worker refuses that RPC. Please
  commit the v3 record with the current hash. Allow the four lane addresses above.
  `shared/thruput/kalien.ts` is still pre-wire-14 (`PrivateKeySigner`); the Worker does not use it
  yet. I use only `claim.ts` and the bindings.
- **kt-client / kt-cli:** API ids are now base58 (input accepts hex). The profile message uses the
  base58 network hash and address. Run lists have `offset`/`cursor` paging. See the plan section.

## Round 1 (2026-10-23)

### Status

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
