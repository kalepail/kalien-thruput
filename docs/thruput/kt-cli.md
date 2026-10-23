# kt-cli report

Agent: `kt-cli`. Scope: `cli/`, `scripts/`, `benchmarks/`, autopilot submit
paths, `test-fixtures/`.

## Status

**STOP point A reached.** The CLI builds, type-checks, lints clean, and signs
correct claims. All CLI tests pass. The shared vectors file
(`shared/thruput/claim-vectors.json`) and `shared/thruput/claim.ts` do not exist
yet. The tests that read them skip until they land, then run with no code change.

Real submissions are not done yet. No local Worker answered on port 8787 or 5174,
and the deployed Worker returned Cloudflare error 1042.

## Commits

| Commit | Content |
|---|---|
| `62353ad` | CLI: local Ed25519 key, claim signing, API v0 client, new commands |
| `581dbfa` | (core agent's commit) It also took my staged deletions of 20 ZK/Stellar scripts, the Groth16 fixtures, and `autopilot/scripts/verify-checkpoints-risc0-dev.sh` |
| `f10b512` | `scripts/`: `generate-tape.ts` reads the API seed; new `e2e-runs.ts`; READMEs |
| `e547909` | Address-layout cross-check, shared-vector loader, explorer links |
| `1d0b677` | `tests/src/cli-preflight.test.ts` rewritten for the new preflight |

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

## Open issues

- Real runs against the local and deployed Worker (blocked: no Worker up).
- Shared vectors check (skips until `shared/thruput/claim-vectors.json` lands).
- `kalien run` was smoke-tested only up to preflight. A full farming loop needs a
  live API.
