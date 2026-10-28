# Independent review: contract, shared helpers, Worker, browser wallet

Reviewer: kt-core (fresh eyes; I did not write this code). Date: 2026-10-24. Code at `23e16ce`.
Scope: `kalien-contract/`, `shared/thruput/`, `worker/`, `src/wallet/` and the submit flow.
Method: three parallel read-only reviews (contract + shared, Worker, browser), then I verified
every finding below against the current code. Where it was cheap, I also checked with a test, a
script, or read-only requests to the deployed Worker and devnet views. I sent no transactions
and changed no code.

Not a finding (user decision 2026-10-24): copycat tapes (no-op input changes to a public tape)
are an accepted risk for devnet. Finding 2 is a different issue: the deploy itself left known
solutions in a live epoch.

Severity: **High** = honest users lose runs or funds, or an attacker gains value now.
**Medium** = a realistic failure or abuse with limited impact. **Low** = hardening, edge cases.

## Summary

Status column: as found on 2026-10-24 (code `23e16ce`). Current status: see "Verification pass".

| # | Severity | Area | Finding | Status when found |
|---|---|---|---|---|
| 1 | High | Worker gas / shared | Valid dense tapes need up to 2,716 gas per frame (corpus) and 3,073 (searched worst, 110.6M); old relay limits (2,300 and 2,200 per frame) run them out of gas | Worker raised in `88a0476` (thin margin, see below); `shared/thruput/kalien.ts` still 2,200 |
| 2 | Medium (time-limited) | Deploy | Fixture epoch 2988058 (seed `0x5F41772E`) is live, and an unclaimed 911,260-point tape for it is public in the repo | Open until about 2026-10-25 09:40 UTC |
| 3 | Medium | Browser wallet | "Import a Key" accepts the player's own address or public key as a secret | Open |
| 4 | Medium | Worker relay | A run seen `committed` whose receipt never arrives stays `submitting` forever and holds an in-flight slot | Open |
| 5 | Medium-low | Worker limits | Per-player rate limit is taken before the signature check, so anyone can lock out a player; all limits are per isolate | Open |
| 6 | Medium-low | Browser seed | The seed never loads when the local clock is off by 10 minutes or more | Open |
| 7 | Low-medium | Worker | `POST /api/runs` buffers a body of any size when `Content-Length` is missing | Open |
| 8 | Low | Worker | Public `/api/health` fans out to RPC and every relay Durable Object, and forces relay ticks | Open |
| 9–17 | Low | various | See "Low findings" | Fixed (see verification table) |

## Verification pass (2026-10-24, code at `ffd0972`, Worker `d2cc7b39` from `8491d9a`)

For each finding I read the fix in the code. Where it was cheap and harmless, I also checked the
deployed Worker with a request that is rejected before any chain write.

| # | Finding | Status | Fix | How I verified |
|---|---|---|---|---|
| 1 | Relay gas too low for dense tapes | **Fixed** | `e535039` (Worker 5M + 4,500 × frames, max 167M; out-of-gas retry 2.5× up to 400M), `eb10818` (`submitGasLimit` same bound) | `wrangler.jsonc` vars; `SUBMIT_BASE_GAS` / `SUBMIT_GAS_PER_FRAME` in `shared/thruput/kalien.ts`. Covers the worst measured tape (110.9M) by 1.5×. |
| 2 | Fixture epoch with a public, unclaimed solution | **Fixed** | `12b55aa` (`BLOCKED_SEED_IDS` 2988058–2988060), `eb10818` (deploy claims every repo tape for fixture seeds, records `fixtureSeedIds`) | Live: `POST /api/runs?seed_id=2988058` → 403 `seed_blocked`. |
| 3 | Key import accepts public values | **Fixed** | `b33ab18` | My Bun reproduction now gets "this is an address or public key, not a secret key" for the address and the public key. |
| 4 | Committed run without a receipt never settles | **Fixed** | `20781c0` (`unknown` state frees the slot; reconciled with backoff via receipt, then `is_claimed`; never re-sent automatically) | Code in `worker/relay/engine.ts`; `/api/health` now reports an `unknown` count (live). |
| 5 | Rate limiter: lockout before signature; per isolate | **Fixed** (lockout) / **Accepted** (per isolate) | `20781c0` (per-player token taken after `verifyEd25519`) | `worker/api/runs.ts:178` verify, `:183` take. Per-isolate memory limits accepted for devnet. |
| 6 | Seed depends on the local clock | **Fixed** | `b33ab18` (server-clock offset) | Code in `src/hooks/useSeed.ts`; kt-client's test and browser run with a clock 17 min off. |
| 7 | Unbounded request body | **Fixed** | `20781c0` (streamed cap; profile JSON 4 KiB) | Live: 40,000-byte chunked body without `Content-Length` → 413 `tape_too_large`. |
| 8 | `/api/health` amplification | **Fixed** | `20781c0` (public view cached 15 s per isolate, never kicks; admin view fresh) | `worker/api/routes.ts` `HEALTH_TTL_MS`; `status(lane, kick = false)` in `worker/durable/relay.ts`. |
| 9 | Seed touch can run twice | **Fixed** | `20781c0` (overlapping calls share one promise per epoch in `worker/relay/service.ts`) | Code. |
| 10 | Failed runs re-posted without limit | **Fixed** | `20781c0` (deterministic faults and a second out-of-gas are `final`; `enqueue` re-queues only non-final failures) | `worker/relay/store.ts` `enqueue`. |
| 11 | Indexer cannot recover from a bad cursor | **Fixed** | `20781c0` (`POST /api/admin/indexer/reset?fromHeight=N`; no re-scan of quiet ranges) | Code. |
| 12 | Admin key compare not constant-time | **Fixed** | `20781c0` (`constantTimeEqual`) | Code; live: wrong key → 404. |
| 13 | Deploy script re-run and secret file | **Fixed** | `eb10818` (refuses a live network without `--force`; secrets written atomically) | `deploy-futurenet.sh` header and code. |
| 14 | Client keeps stale chain config after a reset | **Fixed** | `0e9b175` (config re-read on focus, every 5 min, and on `bad_signature`; a new network hash or contract swaps the client, clears the seed cache, re-reads the balance, shows a notice, and re-signs a refused submit once) | `tests/src/review-low-findings.test.ts`; browser: a changed `/api/config` shows the reset notice (kt-client round 7). |
| 15 | Client polling never ends on permanent errors | **Fixed** | `0e9b175` (`nextPollStep`: stop on 404 and after 15 min; errors back off 5 s → 60 s) | `tests/src/review-low-findings.test.ts`. |
| 16 | Seed fetch race; endless-mode gate | **Fixed** | Race: `b33ab18` (server epoch trusted). Gate: `0e9b175` (`src/runs/endlessGate.ts`: only confirmed scores count; a stronger queued run blocks weaker ones, a rejected/failed one does not) | `tests/src/review-low-findings.test.ts` (6 gate cases). |
| 17 | Dev proxy env in builds; stale error text; no CSP | **Fixed** | Error text `20781c0`; proxies and CSP `0e9b175` (`resolveDevProxies`: proxies only in `vite dev`; `public/_headers`: CSP `default-src/script-src/style-src 'self'`, `connect-src 'self' https://rpc.thruput.network`, `media-src https://api.smol.xyz`, `frame-ancestors 'none'`, plus nosniff, `X-Frame-Options: DENY`, referrer policy) | Build with both proxy vars set has no proxy code; live Worker `082aa0c7`: header on `/`, `/replay/*`, `/tx/*`, `/wallet`; a real run, tx page, replay, wallet, runs, leaderboard with 0 CSP violations. |

Copycat tapes: accepted for devnet (decision 2026-10-24), not a finding.

## 1. High: relay gas limit too low for valid dense tapes

- **Where:** `wrangler.jsonc` relay vars before `88a0476` (`RELAY_GAS_PER_FRAME = 2300`);
  `shared/thruput/kalien.ts:70-73` (`3_000_000n + 2_200n * frames`), the default of
  `submitScore` at `shared/thruput/kalien.ts:576`.
- **Evidence (measured):** RV32 replay gas for the 1,502 valid tapes of the parity corpus
  (`asteroids-core/gas-probe`, test `rv32_gas_sweep`). Dense, valid tapes reach 2,716 gas per
  frame: `pattern-01028` (17,368 frames) needs 47.18M gas for the replay alone, before the
  contract's other work (about 0.25M) and the wallet overhead.
  - Old Worker limit: 3M + 2,300 × 17,368 = 42.9M. Shared helper: 3M + 2,200 × 17,368 = 41.2M.
  - Both are below the replay cost, so the transaction faults out of gas.
- **Failure:** an honest player with a busy game gets `failed`. Before `88a0476` the relay also
  retried that fault as a relay fault up to five times at the same gas.
- **Status:** `88a0476` / `7822745` moved the Worker to 5M + 3,000 × frames (max 113M) with one
  out-of-gas retry at 1.5× (cap 150M). For `pattern-01028` that gives 57.1M, which is enough.
  The deployed Worker (version `d2cc7b39`, from `8491d9a`) runs these commits.
- **Worst case (measured after the review, `kt-core.md` round 6):** a searched valid 36,000-frame
  tape needs 110.64M gas (3,073 per frame), and the search had not converged. 5M + 3,000 × frames
  covers it by only about 2%; the 1.5× retry rescues it. Recommended: 5M + 4,500 × frames with a
  2.5× retry capped at 400M (chain `maxTxGas` is 1,000,000,000).
- **Still open:** `submitGasLimit` in `shared/thruput/kalien.ts` (used by the contract scripts and
  by any caller of `submitScore` without an explicit `gasLimit`).
- **Fix:** use the same bound as the Worker in `submitGasLimit`. The worst-case search requested
  by the lead (next step in `kt-core.md`) gives the final per-frame number.

## 2. Medium (time-limited): fixture epoch with a public, unclaimed solution

- **Where:** `kalien-contract/scripts/kalien.ts:286-308` (`cmdFixtures`), `deploy-futurenet.sh:53-59`.
- **Evidence (devnet views, read-only, 2026-10-24):** current `seed_id` 2988097. `seed(2988058)`
  = 1598125870 (`0x5F41772E`), active (inside the 144-epoch window).
  `is_claimed(kalien-911260-seed1598125870-single-mutation.tape)` = false, and
  `is_claimed(offline-supernova-hunt-seed5f41772e-score35850-frames11390.tape)` = false.
  Epoch 2988060 has seed `0xDEADBEEF`, the seed of other public fixtures.
- **Failure:** anyone makes a new key, signs the claim for `seed_id` 2988058 with the public
  911,260-point tape from `autopilot/fixtures/public/`, and posts it. The Worker and contract
  accept it (correct seed, valid replay, new player). That mints about 911,260 KALIEN without
  play, until the epoch leaves the window (about 2026-10-25 09:40 UTC; 2988059 and 2988060 at
  09:50 and 10:00 UTC).
- **Fix now (pick one):** make the Worker refuse `seed_id` 2988058–2988060 until they expire; or
  pause the contract until then (this stops all play).
- **Fix later:** run fixture tapes only on a throwaway score/token pair or the local node, and
  lock seeding before any public traffic.

## 3. Medium: key import accepts public values as a secret

- **Where:** `src/wallet/keyWallet.ts:177-190` (`decodeSecret`) via `parseBackup`.
- **Evidence (reproduced with Bun):** `parseBackup(wallet.address)` and
  `parseBackup(wallet.pubkeyHex)` both succeed and return a new wallet whose secret is that
  public value. Any 32-byte base58 or 64-character hex string is taken as a seed.
- **Failure:** a player copies their address (the Wallet page has a copy button) and pastes it
  into "Import a Key" on a second device. The import succeeds. The new key's secret is public
  (the old address is on the leaderboard), so anyone can sign runs and profile edits as that key.
- **Fix:** reject an input equal to the current address or public key, in base58 or hex. Accept a
  bare 32-byte value only through an explicit "raw seed" option with a warning, and prefer the
  checksummed backup string.

## 4. Medium: committed run without a receipt never settles

- **Where:** `worker/relay/engine.ts:310-312`
  (`if (status.status === "pending" || run.committedHeight !== null) return;`).
- **Failure:** the relay sees `committed`, but `getTransactionReceipt` keeps returning null (an
  indexer reset or history prune on the RPC). The run stays `submitting` and keeps one of the
  lane's 4 in-flight slots (`RELAY_MAX_IN_FLIGHT = 4`). Four such runs stop the lane.
- **Fix:** when the tip is well past `committedHeight` and there is still no receipt, use
  `isClaimed(runId)` to confirm the run, or else fail it with a clear error and free the slot.

## 5. Medium-low: player lockout through the rate limiter

- **Where:** `worker/api/runs.ts:134` (`submitByPlayer.take(pubkeyHex)`) runs before the
  signature check at `worker/api/runs.ts:184`.
- **Failure:** anyone sends 30 requests with a victim's public key and a junk signature. The
  victim then gets 429 for 10 minutes in that isolate. The limiters live in isolate memory, so
  they do not hold across isolates or locations.
- **Fix:** take the per-player token only after `verifyEd25519` succeeds. Move the limits to a
  Durable Object or the Workers rate-limiting binding.

## 6. Medium-low: seed depends on the local clock

- **Where:** `src/hooks/useSeed.ts:109-119` and `tick()` at `:155-169`.
- **Failure:** the client compares the server `seedId` with `floor(Date.now() / 600000)`. With a
  clock 10 minutes or more off, they never match: the UI waits for a seed forever and polls
  every 12 s. A smaller error blocks play for that many seconds in each epoch.
- **Fix:** trust the server `seedId` and `secondsLeft`, and keep a clock offset for the countdown.

## 7. Low-medium: unbounded request body

- **Where:** `worker/api/runs.ts:76-81` (`readBody`), `worker/api/leaderboard.ts:156`
  (`c.req.json()`).
- **Failure:** without a `Content-Length` header (chunked upload) `Number("0")` passes the check,
  and `arrayBuffer()` buffers the whole body (up to the platform limit, about 100 MB) before the
  size check. Many such requests can push an isolate out of memory.
- **Fix:** read the stream and stop after `MAX_TAPE_BYTES`; cap the profile JSON size the same way.

## 8. Low: public `/api/health` amplifies load

- **Where:** `worker/api/routes.ts:75-92`, `worker/durable/relay.ts:109-113`,
  `worker/relay/service.ts:100-110`.
- **Evidence:** each unauthenticated call reads the relay allowlist over RPC and calls `status()`
  on every lane Durable Object, and `status()` calls `kick()`. While work is pending, `kick()`
  schedules an immediate tick (RPC polling). `Cache-Control: public, max-age=5` does not cache a
  Worker response by itself. Checked live: the endpoint is public and lists all lanes.
- **Fix:** cache the health result (Cache API or a short in-memory TTL), do not kick from
  health, and rate-limit it or put the detailed view behind the admin key.

## Low findings

9. **Seed touch can run twice** (`worker/relay/engine.ts:160-179`, `worker/api/routes.ts:56`):
   `touchSeed` checks the pending touch and then awaits RPC calls before it records its own
   touch. A cron call and a public `GET /api/seed/current` can both sign a seed-touch
   transaction (about 1M gas each; one fails `SeedAlreadySet`). Record the pending touch before
   the first await.
10. **Failed runs can be re-posted without limit** (`worker/relay/store.ts:205-214`): a re-POST
    resets `attempts`, so each re-POST of a deterministic execution fault costs one more
    full-gas attempt (reserved, not burned). Cap total attempts per run, or keep `failed` final
    for `execution fault`.
11. **Indexer cannot recover from a bad cursor** (`worker/leaderboard/indexer.ts:112, 132-135`):
    an `invalidCursor` or `historyUnavailable` error repeats every minute; only a contract change
    resets it. Add an admin reset to a `fromHeight` (rows dedupe). After a full walk, start the
    next walk at the first page's latest indexed height to avoid re-scanning quiet ranges.
12. **Admin key compare is not constant-time** (`worker/api/http.ts:67`). Compare SHA-256 digests
    with `crypto.subtle.timingSafeEqual`. Remote exploitation is unlikely.
13. **Deploy script re-run and secret file** (`kalien-contract/scripts/deploy-futurenet.sh:47, 62`):
    a re-run on a live devnet deploys a new pair and overwrites `futurenet.json` (old relays stay
    allowed on the old contract); the shell redirect truncates `relay.secret` before
    `export-secret` runs. Guard on a matching network hash unless `--force`; write the secret to
    a temp file and `mv` it.
14. **Client keeps stale chain config** (`src/thruput/config.ts:56-79`): after a devnet reset an
    open tab signs for the old network and contract; every submit fails with "claim signature
    does not verify" and no reload hint. Refetch the config on `bad_signature` and tell the user.
15. **Client polling never ends on permanent errors** (`src/hooks/useRunSubmission.ts:170-176`,
    `src/runs/api.ts:106-108`): 404 or an unknown status is polled forever. Stop on 404 and add
    a time limit.
16. **Client seed fetch race at an epoch boundary** (`src/hooks/useSeed.ts:82, 121-126`): a fetch in
    flight at the boundary can set the old epoch's seed for a whole epoch. Re-check the epoch
    after the await. **Endless-mode gate** (`src/components/game/GamePageWrapper.tsx:571`): a
    queued but later failed endless score blocks manual submits below it until the epoch ends;
    record scores only on confirmation.
17. **Small items:** dev proxy env vars (`KALIEN_RPC_PROXY`, `KALIEN_API_PROXY`) leak into a
    production build if exported during `deploy.sh` (`vite.config.ts:22-25`); the error text
    "player must be a 32-byte hex address" is stale (base58 works; checked live); no CSP or
    `frame-ancestors` header, so any future XSS could read the key from `localStorage`.

## Checked and found fine

- **Contract:** `initialize` runs atomically with deploy; admin checks on every admin method;
  relay set bounded to 8 with correct removal; `relay_only` checked first; claim digest matches
  `claim.ts` byte for byte (vectors and live mints); reward address derived from the signing
  key (no redirect); epoch window exact at 144 without underflow; pruning only touches expired
  epochs; mint math cannot overflow; padding nibble enforced; error table matches discriminants.
- **Worker:** all D1 and Durable Object SQL uses bound parameters; client IP from
  `cf-connecting-ip` only; profile signature binds domain, network, address, and timestamp with
  a monotonic `signed_at`; usernames use a fixed character set and links must be http(s); tapes
  are served only after confirmation; journal-before-broadcast, same-bytes rebroadcast, and a
  new attempt only after expiry plus `isClaimed`; first-send retries only on `rejected` or
  `notAttempted` admission; rows and the indexer cursor are written in one batch and walks end
  at `nextCursor: null`; secrets are not logged or returned; admin routes return 404 without the
  key (checked live); no CORS policy (same-origin only; preflight returns 405, checked live).
- **Browser:** keys from `crypto.getRandomValues`; the secret is never sent or logged; backup
  checksum and address checks work; import needs a confirmation; no `dangerouslySetInnerHTML`;
  link URLs pass `isSafeUrl`; the vite proxies have fixed targets and run only in dev/preview;
  other tabs follow key changes.
