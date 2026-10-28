# kt-cli report

Agent: `kt-cli`. Scope: `cli/`, `scripts/`, `benchmarks/`, autopilot submit
paths, `test-fixtures/`.

## Status

**Round 5 (full-length burst and epoch boundary) passed.** Eight 36,000-frame
runs at once confirmed in 8.3 s, and `kalien run` worked across a seed epoch
change. A 36,000-frame run can use up to 83.6M gas. See "Round 5 results".

**Round 4 (deployed Worker, wire-14 devnet) passed.** The e2e script, the CLI
(`submit`, `status`, `run`), all rejection paths, and two 8-player concurrency
rounds work against `https://kalien-thruput.sdf-ecosystem.workers.dev`. All 33
runs confirmed; none failed. See "Round 4 results".

Round 3 (wire-14 migration) is green: 23 CLI tests pass. Round 2 (local Worker,
old devnet) passed; its addresses and run ids are gone with the devnet wipe.

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
| `0517091` | Wire-14 migration: `Ed25519Signer`, base58 addresses and keys, new derivation, legacy key file upgrade, import/export formats |
| `9d0fef4` | Vector test checks `pubkeyHash` and the hex forms of the claim inputs |
| `4b068ca` | `scripts/find-full-tapes.ts`; `concurrency-runs --tapes-dir`; `@/` path alias in `scripts/tsconfig.json` |
| `a2a2450` | e2e logs gas and lane spread, checks malformed tapes; new `scripts/concurrency-runs.ts`; `scripts/lib/probe.ts` |
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
`<local scratchpad>/e2e-local-3.log`
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

## Round 3: devnet wire-14 migration (2026-10-24)

What changed in `cli/`:

- `PrivateKeySigner` → `Ed25519Signer.fromSeed`.
- Address = wire-14 pubkey account (nonce 0): the preimage names the key by its
  scheme-inclusive hash.
  `publicKeyHash = sha256(00 09 "PublicKey" || 00 || pk)`,
  `address = sha256(00 0d "PubkeyAccount" || publicKeyHash || 00)`.
  Addresses and public keys print in base58.
- `claimMessage` takes the network hash and score contract as base58 or hex
  (`decodeBytes32`). The digest bytes did not change.
- The key file keeps `secretKey` as `0x` hex (the browser imports it). `publicKey`
  and `address` are now base58. A pre-upgrade file (`0x` address) is rewritten in
  place on first use (same secret, mode 0600, `createdAt` kept).
- `kalien key import` accepts hex, base58, an S StrKey, the browser backup string
  (checksum checked), and key/backup JSON text.
  `kalien key export --format hex|base58|strkey`.
- The `pubkey=` and `sig=` query values stay lowercase hex, as API v0 says.

Tests (`cd cli && bun test src`: 23 pass, 0 fail; `tsc` and `oxlint` clean;
`bun test tests/src/cli-preflight.test.ts`: 4 pass):

- The RFC 8032 key gives public key `FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z`,
  public key hash `9xarfCYUWxzeV2RSX5B9h6fZK4CoR2WfVvBf2rfvc1yB`, and address
  `D4E11uoczkwDh6eUMTXs29SrALae4yn6g8xYQtP1bDiQ`. These are the outputs of
  `thruput keys import` / `keys ls --json` from thruput 0.36.0 (temporary HOME).
  An independent byte-layout test computes the same values.
- A real CLI key, exported as `--format strkey` and as `--format base58`, imports
  into `thruput keys import` with the same address as `kalien whoami`
  (`EtfBZrAGtgNbb8ADX9emepQyEPDiPN51whNXfKBGGZpE`).
- Shared vectors: addresses (with `pubkeyHash`), claim digests from base58 and
  from hex inputs, and byte-exact signatures. Pre-upgrade vectors (`0x`
  addresses) skip only the address check.
- Key file: legacy upgrade in place, address mismatch refused, all import forms,
  wrong backup checksum refused.

Notes for other agents:

- **kt-contract:** `shared/thruput/claim.test.ts` (uncommitted) still imports
  `PrivateKeySigner`, so it fails to load under client 0.23.0. Use
  `Ed25519Signer.fromSeed`.
- **kt-client:** the browser `parseBackup` compares a CLI key file's `address`
  with its own derived address. CLI key files now carry base58 addresses with the
  wire-14 derivation, so the browser must use the same rules (or skip that
  compare for the CLI format).
- **kt-worker:** the CLI sends `pubkey=` and `sig=` as hex. If API v0 moves to
  base58 for these, tell me. The CLI reads any address or hash format in
  responses.

## Round 4 results (deployed Worker, 2026-10-24)

Worker `https://kalien-thruput.sdf-ecosystem.workers.dev`. Network hash
`DWELtFbbKjeYDPqJQoxcHPEq5UGPnbnFM74yYdHy48uj`. Score contract
`8fFcXcMDi3RE71YvHE2uG3yAhuSBzHPJqy2uxPgktjTT`, token
`AZGTgZfoVoLZpTquPLpPpA1pUbvC4SRfLc5tjWXfHk87`. 4 relay lanes, all allowed.
Gas is `gasUsed` from `getTransactionReceipt` on `https://rpc.thruput.network`.
"Time" is from the POST to the `confirmed` status seen by polling (1–2 s poll
interval), so it includes up to one poll interval.

### e2e (`bun run scripts/e2e-runs.ts --api-url <deployed> --runs 3`): PASSED

Player `4ac8m9Pr2vWSTAfKSiyySnkTc4JBrKaCMTNAD567hXuP`, seed `0x3adb0180`,
seed_id 2988062.

| Run id | Score | Frames | Previous | Minted | Gas | Time | Tx |
|---|---:|---:|---:|---:|---:|---:|---|
| `4b8f5125…05bfe` | 1,980 | 1,200 | 0 | 19800000000 | 2,197,592 | 5.0 s | `74t9hgtNPZJdeyZypeLyHVQ39vEoXEQz8X1HLqec4t8y` |
| `5bfc89a1…dd92f3` | 5,740 | 3,000 | 1,980 | 37600000000 | 5,272,616 | 7.0 s | `A4bMThUyZChuD1MVG6XDVCkdRNDqxpE7s8uKgqzt3MQr` |
| `e5e3136e…d33252` | 14,240 | 6,000 | 5,740 | 85000000000 | 10,703,561 | 5.0 s | `2dw9AqWZkikLHsSPmbeo4KKZj6k49TZrcRn8ukcXCjiW` |

Also passed: `runId == sha256(tape)`, run list, tape download (3,024 bytes,
same bytes), player stats (`bestScore 14240`, `totalMinted 142400000000`,
rank 1). Lane spread for the 3 runs: lane0 +0, lane1 +2, lane2 +1, lane3 +0.

| Case | Result |
|---|---|
| Same player re-sends a confirmed tape | 200, same run |
| Another player, same tape, valid signature | 409 `already_claimed` |
| Fresh tape 4,820 < best 14,240 | 409 `not_improved`, `bestScore 14240` |
| Zero signature | 400 `bad_signature` |
| Valid signature, seed_id + 1 | 409 `seed_missing` |
| Valid signature, seed_id - 1 | 400 `seed_mismatch` |
| Valid signature, seed_id - 1000 | 400 `seed_inactive` |
| Bad magic / truncated / CRC mismatch / empty tape | 400 `bad_tape` (each) |
| 18,025-byte body | 413 `tape_too_large` |
| Footer score forged (+1,000,000) | 400 `replay_mismatch` |

### CLI binary (`cli/dist/kalien`, new key `8yXUcnv3bcr8W163kYGVCpUDJDkL5x12p1EHALGxfSp7`)

| Command | Result |
|---|---|
| `kalien submit` (`generate-tape --random-config`, 26,250, 10,843 frames) | confirmed in 6.0 s (whole command), run `736e6d70…cbabf`, minted 262500000000, gas 24,098,741, tx `HXJrugUMngoSmXgd2oAmSWaL9cjSqMizPwDD3rdF4Fip` |
| `kalien status 736e6d70…` | confirmed, same fields, explorer link |
| `kalien submit` same tape `--json` | `ok: true, existing: true`, same run |
| `kalien submit` lower tape (3,160) `--json` | `not_improved`, `bestScore 26250`, HTTP 409, exit 1 |
| `--seed-id 2987000` | `seed_inactive`, HTTP 400, exit 1 |
| `--seed-id 2988061` (previous epoch) | `seed_mismatch`, HTTP 400, exit 1 |
| Same tape, second key | `already_claimed`, HTTP 409, exit 1 |
| Truncated tape (300 bytes) | refused locally before any request: `Tape length mismatch` |

A bad signature cannot come from the CLI (it always signs correctly); the e2e
covers it.

### `kalien run --threads 4` for 210 s (key `J1QiC6FqKQU7apgRM152eu3RYm7M84NDzksZjySwdrR2`)

27,914 games; 3 submissions, all confirmed on seed_id 2988062. The last run went
out on SIGINT shutdown. Each tape is 36,000 frames (the farm's best games run to
the frame cap).

| Run id | Score | Previous | Minted | Gas | POST → confirmed | Tx |
|---|---:|---:|---:|---:|---:|---|
| `82e86871…e3414` | 177,260 | 0 | 1772600000000 | 73,303,033 | 4.3 s | `E2YTpL6uxgs6qST18Nz4J2fb8gCqVu6Y3nb7Eu5HVst5` |
| `d7cb316b…478c0` | 179,230 | 177,260 | 19700000000 | 72,939,300 | 3.9 s | `j1D1SMtnQg7ZnKbNviGnC1fZsHHYxeVfGz6TJXWor7r` |
| `ccca7bfa…4d09` | 182,800 | 179,230 | 35700000000 | 73,760,036 | 3.1 s | `H8A5TV5L9UTgher4uL1GaF1Kvv5Z4HCYMNKUz1A1EvR4` |

(Time here is the run record's `updatedAt − createdAt`.) The run ended before the
epoch change, so this round did not test the epoch switch. Round 2 did not
either; it is still untested.

### Concurrency (`bun run scripts/concurrency-runs.ts --players 8`)

8 new keys, one unique tape each (jittered autopilot config), all POSTed at the
same moment. "post" = time until the POST returned; "done" = time until
`confirmed` was seen.

Round A (`--max-frames 12000`), seed_id 2988063: **8/8 confirmed in 8.1 s wall,
59.1 runs/min. Lane spread: lane0 +2, lane1 +1, lane2 +2, lane3 +3.**

| Player | Score | Frames | Post | Done | Gas | Run id | Tx |
|---|---:|---:|---:|---:|---:|---|---|
| p0 | 22,680 | 9,705 | 0.9 s | 2.1 s | 18,114,680 | `fd1d4f6e…f9cc` | `DaQRyFX8ymADbQnHMirnLyrC6d6aUnKhFqNsj8rmuvrg` |
| p1 | 9,450 | 4,246 | 0.9 s | 6.5 s | 8,722,577 | `6e4fe2f3…7352` | `E5q5qsbHB4zYHA33ovKGsD2TQNtsJDy97Py25MQCRi2e` |
| p2 | 19,430 | 8,326 | 1.9 s | 6.3 s | 20,150,591 | `c6d9a2e4…4ee` | `4UDs7A3XMnQ84D4eiSY8Ye9XACRPchwXukhBNUzYLcho` |
| p3 | 22,250 | 10,648 | 1.6 s | 5.0 s | 25,717,533 | `f59cddb1…b165` | `8M8yXCi7BtcLif8TjtHQtuhWgrFt1h7GpXsUy6NTC232` |
| p4 | 11,930 | 5,458 | 2.1 s | 8.0 s | 11,123,417 | `78925d28…ea6a` | `Dp2kY18f9VHvxVZ5fB8cGpcGfHnZaY2UvYMvGVmyrcG4` |
| p5 | 21,430 | 10,600 | 1.9 s | 7.5 s | 26,202,883 | `d1264667…d29e` | `DfAbAqUWZFL58Fy7MUv4WDqu948XfoQ3roJ7MZwJ3USH` |
| p6 | 24,490 | 12,000 | 2.4 s | 8.1 s | 23,009,553 | `6a838c0f…2d4b` | `HMEEzPSurgqjTc5BkcLeAij6Bhcopcve9Tx2rpSzTZ3Y` |
| p7 | 18,500 | 7,299 | 1.7 s | 5.0 s | 13,522,568 | `21b9aab2…9d8c` | `3Rms5CHhMiVV1WdxQdL9N9qMAn7TLeGPocQyVmNAmXyn` |

Round B (`--max-frames 36000`), seed_id 2988063: **8/8 confirmed in 6.3 s wall,
75.7 runs/min. Lane spread: lane0 +2, lane1 +2, lane2 +1, lane3 +3.** The
jittered games ended at 7k–15k frames, so this is not the 36,000-frame worst
case.

| Player | Score | Frames | Post | Done | Gas | Run id | Tx |
|---|---:|---:|---:|---:|---:|---|---|
| p0 | 30,470 | 14,566 | 0.9 s | 5.2 s | 30,138,275 | `bd8a2e7dcd6c…` | `W7TH6yhjzwgEVgaoi5sTxj62yzpZDTVjFjHwhcApjZE` |
| p1 | 18,050 | 7,382 | 1.6 s | 6.0 s | 14,807,696 | `234a08f77ee4…` | `7oeDB47JM48wp7LZYfPRJNipGfkd1gvyeEFzS35z3KwM` |
| p2 | 29,150 | 10,676 | 1.2 s | 4.5 s | 24,335,756 | `c7a2ab92fb1e…` | `6ETdsivjSDEFdzJCN2QwjcJ4oPMHEzLGduJoNmpdRzM4` |
| p3 | 24,190 | 9,532 | 0.9 s | 6.3 s | 20,744,744 | `74eb08076e67…` | `HYM6qpjXV5oMCw83C4omxUUV2VtLMsss8bfcWP8nY86u` |
| p4 | 17,760 | 9,071 | 1.0 s | 6.3 s | 21,419,696 | `fdd8ef551ccc…` | `EUEa4iJs2H9ojUfFzgtUqPL1U96oUgZQu7CZ4M78C3de` |
| p5 | 14,000 | 6,992 | 0.9 s | 3.2 s | 16,143,832 | `29d4d6cfd0fc…` | `8RFtyBPSo3G2wVcEhgsNU6rUskCCHhbcBQvyGRGkG6KW` |
| p6 | 21,950 | 9,924 | 1.0 s | 5.2 s | 20,692,992 | `395b1204011f…` | `9KcHeG4VPEWePAxYsMD1bU2gc4YtfuQTGxF8kTx6CE6a` |
| p7 | 17,070 | 7,144 | 1.0 s | 5.2 s | 16,434,963 | `533cb51c4784…` | `FyYXewPBernSKDmKunP2W33MbhsiYY2DcfEHVoL84kur` |

Full run ids are in the logs:
`<local scratchpad>/conc-1.log`
and `conc-2.log` (also `e2e-deployed-1.log`, `d-run.log`).

### Observations

- Gas scales with frames, but it also depends on the game: gas / frames is
  1,758–2,472 over the 23 confirmed runs above. The three 36,000-frame runs used
  72.9M–73.8M (about 2,030 per frame). This agrees with the contract estimate
  (`≈ 2,065/frame + 0.2M`, 36,000 frames: 67–74M).
- With 4 lanes, 8 concurrent runs all confirmed within 6–8 s, and each lane took
  1–3 runs. About 60–76 runs/min for short bursts. That is much more than the one
  run per 2–3 s of a single lane.
- The POST itself took 0.9–2.4 s under 8 concurrent requests (replay pre-check
  and signature check in the Worker).
- No request failed during this session, so no retry was needed.

## Round 5 results (deployed Worker, 2026-10-24)

kt-worker was raising the gas limit. `/api/health` has no version field, so I
waited the full 10 minutes (16:08–16:18 UTC). The per-lane counts changed in that
time (lane 3 `failed` 1 → 0), so a redeploy probably happened.

### Full-length tapes

The Rust autopilot bots lost all lives early on the current seed (12k–60k
points, `lives=0`). The TS autopilot hill-climb (`scripts/find-full-tapes.ts`,
the CLI farm's mutation code, 4 processes) found 8 distinct tapes that survive
all 36,000 frames in **14 s (589 games)** on seed `0x06bed286`, seed_id 2988097.
Each tape is 18,024 bytes (the maximum) and passes `scripts/verify-tape.ts`.

### Burst: 8 × 36,000 frames at once (`concurrency-runs --tapes-dir`)

**8/8 confirmed in 8.3 s wall, 58.1 runs/min. Lane spread: lane0 +2, lane1 +0,
lane2 +4, lane3 +2.** Total gas 517.0M.

| Player | Score | Post | Done | Gas | Run id | Tx |
|---|---:|---:|---:|---:|---|---|
| p0 | 117,840 | 1.3 s | 7.7 s | 59,751,192 | `2c488f9e…9e18b1` | `FcS3dujMuZkomq5SG2mEbRVG2wGQxN9fSg8xbUg4xPWP` |
| p1 | 83,610 | 1.4 s | 7.8 s | 63,235,954 | `427d855a…497fc8` | `GgW9CjvLSwf6Z22CQMfUWU6wi1TicwcvYFbZhaintkie` |
| p2 | 100,800 | 1.2 s | 6.5 s | 69,638,433 | `acf73070…85e13` | `D5LV4NN8L5rpSqQ1yTQoezqpdqe4PQzhpZb6q35wbtnH` |
| p3 | 92,720 | 1.4 s | 6.8 s | 68,985,685 | `b23d591b…7d1eb` | `HSGcJLmDxwWD5J9MmC7kptj2Jw4p6mVqHCd2Spz2wq9r` |
| p4 | 62,700 | 1.5 s | 8.1 s | 62,121,811 | `08f8b72a…d1f7` | `GVQEQr7f4geyZqbGVv8bNtV8BADVGkEAFMYfNtptdbdb` |
| p5 | 65,660 | 1.3 s | 7.7 s | 63,388,450 | `1becc25a…541ea` | `6fuCaNCCRC3XoyQNJc15MJKm4FVurS9scoGQybbmmgyR` |
| p6 | 53,740 | 1.9 s | 8.3 s | 66,291,197 | `9e8b9f98…85724` | `Doprx3bRdjwkxtdXoVhcF5kfDny12VMpUVTQP8FU6yfH` |
| p7 | 62,470 | 1.4 s | 5.7 s | 63,620,832 | `e5c67f93…42098` | `89qHsDFTZWhR69qx8EY17meLThZCfahVFpZLrxyvw1ih` |

Full run ids: `<local scratchpad>/conc-full-1.log`.

Lane 1 took no run in this burst. Lane 2 took 4. If the relay picks a lane by
current load, this can be correct, but **kt-worker** may want to check the lane
choice.

### `kalien run` across a seed epoch change

Run B is the real test. Run A started only 2 s before the change (my wait loop
read `secondsLeft` at the boundary), so it shows only the switch.

Run A (key `DfQb6NRAyuyX5nnE7X5ovYUb9GXbCriSdwpYBe1WZz2k`, 16:19:58–16:23:00 UTC,
20,839 games): seed `0x06BED286` → about 4.5 s "fetching" → `0x2361197D`
(seed_id 2988098). 2 runs on the new seed:

| Run id | Seed id | Score | Previous | Minted | Gas | Time | Tx |
|---|---:|---:|---:|---:|---:|---:|---|
| `a10e16dd…8add5` | 2988098 | 147,940 | 0 | 1479400000000 | 67,987,114 | 4.1 s | `F78Ld2M97ZQmiGjxTMeBgyPHC23ndmDK1yG75xovH8d` |
| `ab44c8b9…dedb8e` | 2988098 | 170,980 | 147,940 | 230400000000 | 68,055,052 | 3.1 s | `127M5ibkWWBRMWqf28ZaXTAewt4xUuPkrqY9rpoCJ68f` |

Run B (key `DR42NZMnpm98tztNuvrY5XNdkYLAyjcmJnntJXte5jS3`, started 149 s before
the change, 16:27:31–16:33:00 UTC, 29,971 games, 5 submissions): 2 runs on
seed_id 2988098, then the dashboard showed "new seed_id interval — fetching
seed…" for about 4.5 s, then "new seed_id materialized (0x2AF907B3)". It then
made 3 runs on seed_id 2988099. The per-seed best started again at 0, as it
should. The shutdown flush had nothing left to send.

| Run id | Seed id | Score | Previous | Minted | Gas | Time | Tx |
|---|---:|---:|---:|---:|---:|---:|---|
| `22b351ac…58df` | 2988098 | 103,910 | 0 | 1039100000000 | 66,467,520 | 3.9 s | `25jTXk8ArijdszAKNSfrauWCxMRFJdN5gVNfCtzpxxGx` |
| `6fc82747…63c4` | 2988098 | 145,620 | 103,910 | 417100000000 | 77,622,774 | 3.8 s | `E6VM88GLRUbahqUdHJWF5AP4BBhnfFtsVPrG4snAv84H` |
| `f6a96cc3…f333` | 2988099 | 144,970 | 0 | 1449700000000 | 81,017,037 | 3.4 s | `49A9oRTe7ZNKn2JBrV1xnjQs6BL8PzBwaKAp6dMbVXnZ` |
| `bfe31263…0ede` | 2988099 | 165,200 | 144,970 | 202300000000 | 83,601,130 | 3.2 s | `CZQNAjPJhoyLAucQqLKtHcUjud4376SADLYQwaow7R6u` |
| `3660c5c5…2d380` | 2988099 | 166,990 | 165,200 | 17900000000 | 69,304,041 | 4.1 s | `AFv14SFVy7s5BcZ2HtRbo7RU4qgnvvJ6Ri8jjP6kmaCf` |

(Time = run record `updatedAt − createdAt`.) In both runs no better tape was
waiting at the change, so the "drain before epoch reset" code path did not have
to submit. That path is still not proven by a live run.

### Gas finding (for kt-worker and kt-contract)

36,000-frame runs used **59.8M–83.6M gas** this session. Two farmed runs used
81.0M and 83.6M. That is more than the interface estimate (67–74M) and more than
the old relay limit `3,000,000 + 2,200 × frames` = 82.2M. The run that used
83.6M confirmed, so the raised limit is in place. Gas depends on the game, not
only on the frame count: high-score farmed games (many objects) cost more.
Keep a margin above 84M, or measure the worst case with the farm's best tapes.

## Open issues

- The epoch-change drain path (submit a waiting better tape before the reset) is
  not proven by a live run; it needs a better tape that is still settling at the
  boundary.
- Gas for 36,000 frames reached 83.6M (see "Gas finding").
- The 372 s `queued` delay from round 2 (kt-worker). It did not happen again in
  round 4.
