# kt-cli report

Agent: `kt-cli`. Scope: `cli/`, `scripts/`, `benchmarks/`, autopilot submit
paths, `test-fixtures/`.

## Status

**Round 2 (local Worker) is done.** The shared vectors pass (no skips). The e2e
script, `kalien submit`, `kalien status`, and `kalien run` work against the
local Worker at `http://127.0.0.1:5174` on the live devnet contracts, including
all rejection paths. See "Round 2 results".

The deployed Worker (`https://kalien-thruput.sdf-ecosystem.workers.dev`) still
returns Cloudflare error 1042. The repeat against it waits for the deploy (see
"Deployed Worker" at the end).

Round 1 (STOP point A) is done: the CLI builds and signs correct claims.

## Commits

| Commit | Content |
|---|---|
| `62353ad` | CLI: local Ed25519 key, claim signing, API v0 client, new commands |
| `581dbfa` | (core agent's commit) It also took my staged deletions of 20 ZK/Stellar scripts, the Groth16 fixtures, and `autopilot/scripts/verify-checkpoints-risc0-dev.sh` |
| `f10b512` | `scripts/`: `generate-tape.ts` reads the API seed; new `e2e-runs.ts`; READMEs |
| `e547909` | Address-layout cross-check, shared-vector loader, explorer links |
| `1d0b677` | `tests/src/cli-preflight.test.ts` rewritten for the new preflight |
| `cc1794a` | Vector test reads the real `claim-vectors.json` format (addresses + claims, tapes in `kalien-contract/fixtures/`), checks signatures byte for byte |
| `69cc9b5` | CLI handles `code` / `bestScore`; run loop handles `not_improved` and `already_claimed`; e2e covers dedupe and refusals |
| `86b18f0` | `generate-tape.ts --random-config`; `submit --json` includes `code`, `bestScore`, `existing` |

Lesson: the shared index is not private. I now stage and commit in one command
with explicit paths.

## What changed

### CLI (`cli/`)

- One TS client only. There are no other language clients in `cli/`, so no native
  ports were necessary.
- `cli/src/identity/claim.ts`: `claimMessage()` =
  `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))`.
  It also has `claimMessageFromTapeHash()`. The signature covers this 32-byte
  digest. This is the same as `claim_digest` in
  `kalien-contract/contracts/kalien_score/src/claim.rs`.
- `cli/src/identity/keyfile.ts`: key file at `--key`, `$KALIEN_KEY_FILE`, or
  `~/.config/kalien/key.json`. Made on first use, mode 0600, dir 0700, never
  overwritten. JSON: `{ version, secretKey (0x hex seed), publicKey, address, createdAt }`.
  Address = `createPubkeyAccount` from `@thruputchain/client@0.18.0` (nonce 0).
- `cli/src/api/client.ts`: `KalienApi` for `/api/config`, `/api/seed/current`,
  `POST /api/runs`, `GET /api/runs/:id` (polling), `GET /api/runs?player=`.
- Commands: `run` (key-based, no `--address`), new `submit <tape>`,
  `status <run-id>`, `whoami`, `key path|export|import|new`. `replay`, `ps`,
  `cleanup` are unchanged.
- Workers no longer read Stellar RPC. The main thread reads the seed from the API
  and sends it to the workers. A worker only plays a seed whose `seed_id` equals
  the local clock `seed_id`.
- Removed: `relayer.ts` (OZ Channels), `api/submit.ts` (proof jobs), Stellar
  network presets, the `asteroids-score` binding import, the Stellar preflight.
- Default API: `https://kalien-thruput.sdf-ecosystem.workers.dev`; override with
  `--api-url` or `KALIEN_API_URL`.
- The CLI never type-checked before (no `bun-types`). I added `@types/bun` as a
  CLI dev dependency (`cli/bun.lock`), the DOM lib, and fixed casts in
  `worker/mutate.ts`.

### Scripts, fixtures, autopilot

- Removed: `_prover-helpers.sh`, `amm-deposit*.ts`, `batch-smoke-test.sh`,
  `bench-core-cycles.sh`, `bench-risc0.sh`, `bench-segment-sweep.sh`,
  `check-balance.ts`, `dev-rpc-proxy.ts`, `generate-score-bindings.sh`,
  `prove-tape.sh`, `smoke-test-prover.sh`, `stress-test-api.sh`,
  `test-boundless-*.ts`, `test-vast-submit.ts`, `test-wallet-swap.ts`,
  `testnet-events-adapter.ts`, `verify-tape-risc0.ts`, `e2e-ui.ts` (passkey and
  proof flow), `e2e-leaderboard.ts` (replaced), `load-env.ts` (no users left).
- Kept: `verify-tape.ts` (no change needed), `generate-tape.ts` (seed now from
  `/api/seed/current`, `--api-url`), `.env.example` (rewritten, no secrets).
- New: `scripts/e2e-runs.ts`. It generates tapes on the current seed, submits
  them in score order, and checks status, score, `previousBest`, minted
  `(new - prev) * 1e7`, the run list, the stored tape, and the leaderboard. It
  also checks that the API refuses a zero signature, a wrong `seed_id`, and a
  non-improving replay.
- `test-fixtures/`: removed the 9 `proof-*-groth16.*` files. Kept all tapes.
  Rewrote the README (sizes, scores, commands).
- `benchmarks/`: there is no root `benchmarks/` directory. The old
  `kalien-verifier/benchmarks/` went with the core agent's verifier removal.
- Autopilot: the Rust autopilot has no network submit path. Its tapes submit
  with `kalien submit <tape> [--seed-id <n>]`. I removed only
  `autopilot/scripts/verify-checkpoints-risc0-dev.sh`.

## Tests and results

| Command | Result |
|---|---|
| `cd cli && bun test src` | 13 pass, 4 skip (shared vectors absent), 0 fail |
| `bun test cli tests/src/cli-preflight.test.ts` (root) | 17 pass, 4 skip, 0 fail |
| `cd cli && ../node_modules/.bin/tsc --noEmit -p tsconfig.json` | 0 errors |
| `node_modules/.bin/oxlint cli/src scripts` | 0 warnings, 0 errors |
| `tsc -p scripts/tsconfig.json` | 0 errors in `scripts/`; errors only in `worker/` (worker agent mid-rewrite) |
| `cd cli && bun run build` | `dist/kalien` built (60 modules) |
| `dist/kalien whoami --key $TMPDIR/kt-key/key.json` | made key, mode `-rw-------`, printed address |
| `dist/kalien run --address G...` | refuses with a pointer to `whoami` |
| `bun run scripts/verify-tape.ts` on all 5 fixtures + the 911,140 tape | all PASSED (1480, 11190, 14870, 15200, 92820, 911140) |
| `cargo run --release --manifest-path autopilot/Cargo.toml -- verify-tape --input test-fixtures/test-long.tape --max-frames 36000` | `final_score=92820` |
| `bun run scripts/generate-tape.ts --seed deadbeef --max-frames 3000` | 1524 bytes, VERIFICATION PASSED |

What the CLI tests prove:

- Claim digest equals two vectors computed with Python `hashlib`
  (`32a1906f…2f30` for test-short with `0x11…`/`0x22…`/seed `0x01020304`;
  `132544dc…c0d4` for all zeros).
- The signer gives the RFC 8032 test 1 public key and signature.
- The address for the RFC 8032 key is
  `0xc9770e44593153c55045c4abd80234834272752f37cd3c3791f3ff0504ccc7db`. This
  equals the output of `thruput keys import` (thruput 0.29.2, isolated HOME),
  and equals `sha256(00 0d "PubkeyAccount" 00 pk 00)`, the layout in the
  contract's `claim.rs`.
- Claim signatures verify with `node:crypto`; a flipped bit fails.
- The API client sends `pubkey`, `seed_id`, `sig` that a mock API verifies, and
  polls to `confirmed`.

## Decisions

- `pubkey` and `sig` query values are lowercase hex with no `0x`.
- Best score per seed comes from `GET /api/runs?player=` (confirmed runs with a
  matching `seedId`). The Worker also rejects non-improving runs, so this is only
  an optimization.
- The CLI keeps its own copy of `claimMessage` (no import from `shared/`), so the
  compiled binary has no dependency on generated files. The tests pin it to the
  shared helper and vectors.

## Requests to other agents

Round 1 requests: kt-worker items 1–5 and the kt-contract vectors are done. The
kt-client backup format and the root `typecheck:cli` item are still open.

- **kt-worker:**
  1. Accept `pubkey` and `sig` as hex with or without `0x`.
  2. Include `seedId` in run records from `GET /api/runs/:id` and
     `GET /api/runs?player=`. The CLI needs it for the per-seed best.
  3. Return `{ error: "<text>" }` on 4xx/5xx. Use 429 for rate limits.
  4. Return `minted` as a decimal string of base units.
  5. When a local Worker runs, tell me the port. I will run
     `bun run scripts/e2e-runs.ts --api-url http://localhost:<port>`.
- **kt-contract:** `claim-vectors.json` should have per entry: `networkHash`,
  `scoreContract`, `seedId`, one of `tape` (hex) / `tapeFile` (repo-relative) /
  `tapeHash`, and `digest`. Optional `pubkey` + `address` pairs. The CLI test
  also accepts snake_case names.
- **kt-client:** the browser key backup string should accept the CLI format
  (`0x` + 64 hex chars, the 32-byte Ed25519 seed). Then
  `kalien key export` / `kalien key import` move a player between the browser
  and the CLI.
- **coordinator:** root `package.json` (client-owned) has no `typecheck:cli`.
  Suggest `"typecheck:cli": "tsc --noEmit -p cli/tsconfig.json"` in `typecheck`.
  Note: `cli/tsconfig.json` needs `cli/node_modules` (`cd cli && bun install`).

## Round 2 results (local Worker, devnet contracts)

Worker `http://127.0.0.1:5174`, network hash `0xb69e…5047`, score contract
`0xed51…ed81`, token `0x6782…4844`. Logs:
`/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/cfb386b3-55e4-434b-8d68-49329aa4c69e/scratchpad/e2e-local-3.log`
and `run.log` in the same directory.

### Vectors

`cd cli && bun test src`: **18 pass, 0 skip, 0 fail.** The CLI matches
`shared/thruput/claim-vectors.json`: 5 address vectors (pubkey and address from
the secret), 2 claim vectors (tape hash, digest, and the Ed25519 signature byte
for byte), and `shared/thruput/claim.ts` `claimMessage` for 4 seed ids.

### e2e (`bun run scripts/e2e-runs.ts --api-url http://127.0.0.1:5174 --runs 3`): PASSED

Seed `0x0cf0cf4d`, seed_id 2987991, new player `0xa0aa…9137`.

| Run id (sha256 of tape) | Score | Frames | Previous | Minted | Time to confirmed |
|---|---:|---:|---:|---:|---:|
| `927d639f…d694` | 1,830 | 1,200 | 0 | 18300000000 | 4.4 s |
| `19e32870…c63c` | 7,770 | 3,000 | 1,830 | 59400000000 | 4.2 s |
| `ee4b95d7…8f62` | 12,580 | 6,000 | 7,770 | 48100000000 | 4.2 s |

Also checked: `runId == sha256(tape)` for each run; `GET /api/runs?player` lists
the runs; `GET /api/runs/:id/tape` returns the same bytes; player stats
`bestScore 12580`, `totalMinted 125800000000`.

| Case | Result |
|---|---|
| Same player re-sends a confirmed tape | 200, same run id |
| Another player sends the same tape (valid signature) | 409 `already_claimed` |
| Fresh tape, score 4,550 < best 12,580 | 409 `not_improved`, `bestScore 12580` |
| Zero signature | 400 `bad_signature` |
| Valid signature for seed_id + 1 | 409 `seed_missing` |
| Valid signature for seed_id - 1 | 400 `seed_mismatch` |
| Valid signature for seed_id - 1000 | 400 `seed_inactive` |
| Footer score forged (+1,000,000) | 400 `replay_mismatch` |

### CLI binary (`cli/dist/kalien`)

| Command | Result |
|---|---|
| `kalien submit` default-autopilot tape (score 21,500, seed_id 2987992) | `already_claimed`: another client had sent the same deterministic tape first |
| `kalien submit` `--random-config` tape (31,470, 14,004 frames) | confirmed, run `192bb468…c2cc`, minted 314700000000, tx `0x6432…cf76` |
| `kalien status 192bb468…` | confirmed, same fields, explorer link |
| `kalien submit` same tape again `--json` | `ok: true`, same run, `confirmed` (dedupe) |
| `kalien submit` lower tape (2,720) | `not_improved: score 2720 does not beat your best 31470 for this seed` |
| `kalien submit --seed-id 2987000` | `seed_inactive` (exit 1) |
| `kalien submit` same tape with a second key | 409 `already_claimed` (exit 1) |
| `kalien run --threads 4` for 168 s (new key `0xa6b1…a381`) | 22,634 games (~8,000/min); 2 runs confirmed on seed_id 2987992: 156,890, then 188,530 (35,615 frames, run `7c1fcd5a…ace0b`, minted 316400000000 for the delta); leaderboard rank 1 (10 min), `totalMinted 1885300000000`; clean shutdown on SIGINT |

### Notes

- **Run id = `sha256(tape)` hex.** One run per tape for all players. A second
  player who re-sends a tape gets 409 `already_claimed`. The same player gets the
  existing run (200), even with a bad signature, because dedupe is the first
  check. That is harmless (run records are public), but the e2e negative checks
  must use a tape that nobody sent.
- The default autopilot is deterministic. On a given seed, everyone who runs
  `generate-tape.ts` with no options makes the same tape, and only the first one
  claims it. `kalien run` mutates the config, so it does not hit this.
  `generate-tape.ts --random-config` and the e2e jitter the config.
- In the first e2e attempt, the first run stayed `queued` for 372 s, then
  confirmed. Later runs confirmed in 2–20 s. I did not find the cause.
  **kt-worker:** please check the relay log near 22:32–22:38 UTC (run
  `4ea01cb0…9e0d`).

## Open issues

- Repeat the e2e and CLI checks against the deployed Worker (waits for deploy).
- The 372 s `queued` delay above (kt-worker).
