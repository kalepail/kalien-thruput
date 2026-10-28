# kt-core report: simulation core and gas measurement

Agent: `kt-core`. Branch: `thruput-devnet`. Status: **final round done (2026-10-24)**: docs
TODOs resolved, review verified, full suite green. Round 6: independent review, copycat
decision, worst-case replay gas. Round 3: strict-rule fix, gas probe on `thruput-sdk =0.54.0` / CLI
0.36.0 / hog-devnode rc.14. Rounds 1–2 below.

## Final round (2026-10-24)

- Resolved every `TODO(lead)` in `README.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and
  `docs/thruput/review.md`: Worker live (`d2cc7b39` from `8491d9a`), v3 addresses, 4 lanes at
  about 999 HOG, fixture epochs refused, browser/CLI address parity (I re-derived
  `D4E11uoczkwDh6eUMTXs29SrALae4yn6g8xYQtP1bDiQ` for the RFC 8032 key in the browser code), gas
  policy 5M + 4,500 × frames with a 2.5× retry up to 400M, per-isolate rate limits accepted.
- README now has "How to run and deploy" (live devnet, full local stack, tests, deploy after a
  wipe).
- Review verification (`docs/thruput/review.md`, "Verification pass"): 13 findings fixed,
  1 partly accepted (per-isolate limits), 4 low client items open (14, 15, the endless-mode gate
  in 16, proxy env and CSP in 17).
- Full suite (code at `ffd0972` + docs):

| Suite | Result |
|---|---|
| `bun run check` | pass (0 lint warnings) |
| `bun test tests/` | 151 pass, 0 fail |
| `cd cli && bun test src` | 23 pass, 0 fail |
| `bun test shared/thruput/` | 15 pass, 3 skip (live), 0 fail |
| asteroids-core `cargo test --release` | 65 passed |
| asteroids-core no_std build | ok |
| autopilot `cargo test --release` | 5 passed |
| gas-probe native / RV32 | 2 passed (5 ignored) / 4 passed |
| kalien-contract native `cargo test --workspace` | 38 passed (8 ignored: RV32) |
| kalien-contract RV32 `thruput test -p kalien_score` | 8 passed |
| TS/Rust parity (`--count 60 --autopilot 8`) | 179 tapes, 2,552,506 frames, 0 mismatches, 0 strict-only |

## Round 6: worst-case replay gas (2026-10-24)

Question: what gas limit is safe for any valid tape? Method: RV32 executor (`gas-probe`, new test
`rv32_gas_sweep` over a directory of tapes) plus a host-side search (`parity gas-search`) that
mutates valid tapes to maximise per-frame work. The search scores frames by entity updates,
possible collision pairs, and spawn-point grid searches (`parity gas-proxy`, `gas-stats`).
Every tape below is valid: strict `verify_tape` accepts it with its claimed score.

| Tapes | Count | Max gas | Max gas/frame |
|---|---:|---:|---:|
| Parity corpus (valid, all lengths) | 1,502 | 63,690,168 (36,000 f) | 2,716 (`pattern-01028`, 17,368 f, 47.18M) |
| Parity corpus, 36,000 frames | 350 | 63,690,168 | 1,769 |
| Search round 1 (15 starts × 20,000 mutations) | 15 | 84,638,668 | 2,351 |
| Search round 2 (3 × 3 × 60,000) | 9 | 92,442,391 | 2,568 |
| Search round 3 (6 × 150,000) | 6 | **110,640,874** | **3,073** |
| "Die early in a late wave" constructions | 142 | 62.2M range | 1,708 (estimate) |

- The worst tape (`asteroids-core/tests/fixtures/gas-worst/gas-worst-110m-seed7f80916e-score43290.tape`,
  36,000 frames, score 43,290) keeps 20–25 asteroids, up to 3 saucers, and saucer bullets on screen
  from wave 5 on. It reaches game over at frame 19,348 in wave 7; the field then keeps running
  (saucer bullets split asteroids; 3 saucers stay) until frame 36,000.
- **The search had not converged** (each round raised the maximum: 84.6M → 92.4M → 110.6M).
- Upper bound from the entity caps (33 asteroid slots, 4 bullets, 3 saucers, 2 saucer bullets
  every frame): about 10,000 gas per frame, about 372M for a full tape. This is loose (collisions
  break up such a field), but it is below the chain's `maxTxGas` of 1,000,000,000.
- A two-term model fits all 2,016 measured tapes: `gas ≈ 293 × frames + 1.111 × proxy`, with
  actual/predicted between 0.90 and 1.27.

Gas-limit recommendation (gas is reserved against the relay's free HOG, not burned):

| Policy | Full tape limit | Covers the measured worst (110.9M incl. contract overhead)? |
|---|---:|---|
| Old: 3M + 2,300 × frames | 85.8M | no |
| Plan: 5M + 3,000 × frames | 113.0M | only by about 2% |
| Plan + one out-of-gas retry at 1.5× (cap `RELAY_GAS_RETRY_MAX` 150M) | 150M on retry | yes, by 35% on the retry |
| **Recommended: 5M + 4,500 × frames**, out-of-gas retry 2.5× capped at 400M | 167M, retry 400M | yes (1.5× the worst measured); the retry covers the loose bound |
| Better later: per-tape limit from the Worker's TS replay (`1.35 × (293 × frames + 1.111 × proxy)` + 1M) | per tape | needs the proxy ported to TS |

Cost of the recommendation: 16.7 HOG of free balance per in-flight full-length run (4 in flight
per lane = about 67 HOG per lane). Also update `submitGasLimit` in `shared/thruput/kalien.ts`
(still 3M + 2,200 × frames).

Reproduce:

```bash
cd asteroids-core/gas-probe
GAS_SWEEP_DIR=../tests/fixtures/gas-worst thruput test --show-output --match-test rv32_gas_sweep
asteroids-core/parity/target/release/asteroids-parity gas-search <out-dir> 150000 0x90001 <start.tape>
asteroids-core/parity/target/release/asteroids-parity gas-stats <tape>
```

Also changed: `LiveGame` derives `Clone` (the search resumes from checkpoints). No behavior change;
golden and all core tests pass.

## Round 5: cleanup and full test run (2026-10-24)

Commits: `236e1f0` (remove `shared/stellar/`, its only importer `tests/shared/strkey.test.ts`,
rewrite `shared/README.md`), `d2be500` (`journal` naming in `asteroids-core/tests/replay_fixtures.rs`,
`src/game/Autopilot.ts` header), `eb42826` (ZK/proof wording in `src/game/` comments, relayed by
kt-client). `package.json` and `bun.lock` no longer reference `asteroids-score`.

Sweep (tracked files outside `docs/archive/` and `docs/thruput/`; terms: risc0, risczero,
boundless, vast, soroban, stellar(-sdk), smart-account, passkey, webauthn, seal, journal, kale,
soroswap, channels, openzeppelin, galexie, kalien.xyz, mainnet, testnet, old Stellar env vars,
G/C StrKeys). Root configs (`.gitignore`, `tsconfig*`, `vite.config.ts`, `bunfig.toml`,
`components.json`, `.env.example`, `.dev.vars.example`, `.oxlintrc.json`, `.oxfmtrc.json`,
`.npmrc`, `wrangler.jsonc`, `package.json`, `index.html`, `.vscode/`, `public/`) are clean.
There is no `.github/`. Remaining hits, by owner, all left as is:

| Where | Hit | Owner | Note |
|---|---|---|---|
| `autopilot/archive/claude-autopilot/` | path dependency `../../kalien-verifier/asteroids-core`, `journal.rules_digest` | none (archive) | Dead crate: the path was already wrong before the port, and the API is gone. Suggest deleting it. |
| `autopilot/src/bots/roster.rs` | bot ids `record-mainnet-911140`, `record-mainnet-911260-single-mutation` | autopilot | Names of the historical record tapes; records refer to these ids. |
| `src/components/wallet/WalletPage.tsx`, `src/wallet/keyWallet.ts`, `src/hooks/useWallet.ts` | Stellar `G...` / `S...` StrKey export | kt-client | Intended interop feature. |
| `worker/relay/*`, `worker/README.md` | "journal" | kt-worker | The relay's own transaction journal (not ZK). |
| `autopilot/evolve/*`, `autopilot/.gitignore` | "journal" | autopilot | The evolve lab's notes directory (not ZK). |
| `tests/worker/api-runs.test.ts` | username "kale" | kt-worker | Test data. |
| `test-fixtures/README.md`, docs | removal notes, archive pointers | — | Intended. |

Full test run (all pass; I changed no other agent's code):

| Suite | Command | Result |
|---|---|---|
| Root checks | `bun run check` (typegen, 6 × tsc, oxlint, oxfmt) | pass (exit 0) |
| Root bun tests | `bun test tests/` | 115 pass, 0 fail |
| asteroids-core | `cargo test --release` | 65 passed, 0 failed |
| asteroids-core no_std | `cargo build --release --no-default-features` | ok |
| parity crate | `cargo clippy --release` | ok, no warnings |
| gas-probe native | `cargo test --release` | 2 passed, 4 ignored (RV32 and integration) |
| gas-probe RV32 | `thruput test` | 3 passed |
| autopilot | `cargo test --release` | 5 passed |
| kalien-contract native | `cargo test --workspace --release` | 37 passed, 7 ignored (RV32) |
| kalien-contract RV32 | `thruput build -p kalien_token && thruput test -p kalien_score` | 7 passed |

`kalien_score` depends on `asteroids-core` by path, so these runs already include the
strict-rule fix (`c8d6644`).

## Round 4: docs update (2026-10-24)

Root `README.md` and `docs/` (not `docs/thruput/`) now describe the current system: wire 14 and
base58, `thruput-sdk =0.54.0`, contract v2 rules (relay-only, `TapeBadPadding`, seed lock, seed
from block height and time), Worker relay lanes and deploy scripts, devnet reset after a wipe,
funding, secrets, and the strict-rule fix. `docs/ARCHITECTURE.md` ends with the copycat-tape
decision for the user; `docs/games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md` has the
options, including kt-contract's per-player seed. Facts in flux are marked `TODO(lead)`: v3
contract details, final devnet addresses (`devnet.json` still holds pre-wipe v2 addresses), the
deployed Worker URL, lane count and funding, browser/CLI address cross-check, rate limits.
ZK, RISC Zero, Boundless, Soroban, and Stellar-ingestion docs were already archived in round 2
(`docs/archive/zk/`). Not changed (other owners): `shared/README.md` still describes the
Soroban-only `shared/stellar/`.

## Round 3 summary (2026-10-24)

1. **Strict-rule fix (changes on-chain behavior).** Commit `c8d6644`. Two strict rules rejected
   honest runs. **kalien_score must be rebuilt and redeployed** with this `asteroids-core`.
   - Evidence: the first large parity run (3,580 tapes, 59,344,360 frames per side) had 0 state
     mismatches but **20 of 2,506 valid tapes (0.8%)** that the TS pre-check accepted and the
     strict replay rejected. 16 × `SHIP_POSITION_STEP`, 4 × `GLOBAL_MODE_LIVES_CONSISTENCY`.
     Classes: 11 pattern, 3 runs, 3 uniform, 3 mutants of skilled tapes. So real players could
     hit it, mostly when they die at full speed.
   - `SHIP_POSITION_STEP`: in a death frame the check bounds the step by
     `(max_speed_sq >> 8) + 4` = 8,228. `v >> 4` floors negative velocities, so a legal step
     reaches 8,285 or more (example: dy = −91 at vy ≈ −1,444). New bound: the exact maximum of
     `(vx >> 4)² + (vy >> 4)²` over the clamped velocity disc = **8,458**, computed at compile
     time and checked by a brute-force test.
   - `GLOBAL_MODE_LIVES_CONSISTENCY`: a ship bullet in flight scores after game over, crosses
     10,000, and the sim grants an extra life, so `lives = 1` in game over. New rule: game over
     allows `lives <= 1` (bullets after game over can add at most 4 × 990 < 10,000 points, so at
     most one extra life).
   - Both changes only relax the rules: any tape accepted before is still accepted. Golden
     results are unchanged. The TS sim has no strict rules, so `src/game/` needs no change.
   - Regression: 4 of the 20 tapes are in `asteroids-core/tests/fixtures/strict-regressions/`
     (`tests/strict_regressions.rs`). Each old rule makes that test fail; the fix makes it pass.
     All 17 regenerated failing tapes now verify.
   - After the fix, the same large parity run: **3,580 tapes, 59,344,360 frames, 2,506 accepted
     by both, 0 state mismatches, 0 strict-only rejections.**
   - I corrected my earlier wrong claims in the docs: honest inputs did trip strict rules, and
     bullets can still score for up to 72 frames after game over.
2. **Gas probe on the new toolchain.** `asteroids-core/gas-probe` now uses `thruput-sdk =0.54.0`
   (scaffold layout from CLI 0.36.0). RV32 executor and a local rc.14 node (wire 14.1.0,
   implementation 0.36.0) give the numbers in "Gas table" and "Memory". Gas is +0.25% against
   the 0.51 build; statics fall from 5,696 to 2,816 bytes; peak memory for a full tape is
   **41,323 of 65,536 bytes**.
3. Not done this round: a devnet probe call (devnet was wiped; my throwaway key has no funds
   there). The local node numbers equal the executor + 50 gas, as on the old devnet.

## Round 2 summary

1. **Score-delta bitset.** Statics 9,160 → 5,696 bytes; peak memory for a full tape 47,667 →
   44,203 bytes; replay gas +0.3%. Golden results unchanged. Commit `9fe5143`.
2. **TS/Rust parity.** New tool `asteroids-core/parity/`. It compares the full sim state on
   every frame. Result: all states equal, but 20 honest tapes failed strict rules; fixed in
   round 3.
3. **Docs.** Root `README.md` and `docs/` rewritten for Thruput; ZK-era docs archived.
   See "Docs rewrite" below.
4. **Security finding (needs a decision).** The tape dedupe key `sha256(tape)` is malleable:
   a copier can change a confirmed public tape (padding nibble, frames after game over, inputs
   the sim ignores) and claim the same score under another key within the 24-hour window.
   Details and options: `docs/games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md`.

## Result

One transaction can replay a full 36,000-frame tape. A chunked replay is not necessary.

- Gas for a full tape is 67.5M to 74.4M. The sender needs that much free HOG (7.5 HOG). Gas is
  not burned.
- Peak guest memory is about 40.4 KiB of 64 KiB, with a 16 KiB stack (`thruput-sdk` 0.54.0).
- The contract **must** build with a 16 KiB stack. The default 30 KiB stack leaves too little heap
  for an 18,024-byte tape (see "Memory").

## Gas table

Current (round 3): `thruput test` (RV32 executor), `thruput-sdk =0.54.0`, CLI 0.36.0, core with
the strict-rule fix. Wall times are slower because a parity run used the CPU at the same time.

| tape | frames | bytes | noop gas | parse gas | replay gas | gas/frame | executor wall ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| test-short | 700 | 374 | 990 | 6,411 | 1,250,714 | 1,778 | 14.0 |
| test-medium | 5,000 | 2,524 | 990 | 36,511 | 9,543,027 | 1,901 | 87.2 |
| test-real-game | 6,643 | 3,346 | 990 | 48,019 | 14,076,991 | 2,112 | 119.0 |
| test-long | 36,000 | 18,024 | 10,347 | 262,868 | 74,421,998 | 2,060 | 800.5 |
| kalien-911140 | 36,000 | 18,024 | 10,347 | 262,868 | 67,514,218 | 1,868 | 702.5 |

Local node, round 3: `thruput node --port 9545 --hog-devnode-version 0.1.31-rc.14` (wire 14.1.0,
implementation 0.36.0), `thruput call gas-probe replay 0x<tape> --gas-limit 90000000`. Every
receipt had `execution.result = return` with the expected score. Gas used: 1,250,764 /
9,543,077 / 14,077,041 / 74,422,048 / 67,514,268 (executor + 50).

Round 2 (SDK 0.51.1, CLI 0.29.2, score-delta bitset): replay gas 1,247,218 / 9,518,031 /
14,043,783 / 74,242,002 / 67,334,222.

Before the bitset (`[bool; 3961]` table), replay gas was 1,243,024 / 9,488,037 / 14,003,931 /
74,026,010 / 67,118,230. The bitset costs about 0.3% more gas and saves 3,464 bytes of memory.
The local node and devnet transactions below ran before the bitset. They report the executor
numbers + 50 gas (the wallet wrapper).

- `noop` = calldata only. `parse` = container checks and CRC-32. `replay` = parse + strict replay.
- gas/frame = (replay − parse) / frames.
- Planning number: **75M gas** covers every tape up to 36,000 frames that we measured. Use a gas
  limit of 80M for a 36,000-frame tape (8 HOG free in the relay wallet).
- The old `maxViewGas` was 10M (about 5,000 frames). Check `getServerLimits` on the new devnet.

### Real transactions (round 1, old devnet, wiped on 2026-10-24)

Local node (`thruput node --port 9545`, CLI 0.29.2, gas limit 90M):

| tape | gas used | score | wall time (CLI call) |
|---|---:|---:|---:|
| test-short | 1,243,074 | 1,480 | 0.1 s |
| test-medium | 9,488,087 | 11,190 | 0.2 s |
| test-real-game | 14,003,981 | 14,870 | 0.2 s |
| test-long | 74,026,060 | 92,820 | 0.2 s |
| kalien-911140 | 67,118,280 | 911,140 | 0.2 s |

Devnet (2026-10-23, height 388,721–388,724, gas limit 80M, throwaway key `kt-core-devnet`):

| tape | gas used | score | wall time (CLI call to receipt) | tx |
|---|---:|---:|---:|---|
| test-short | 1,243,074 | 1,480 | 2.6 s | `0x906cf84b0dcca624b1d9560d951a535003325da35484c555cb57d87cda11dcb0` |
| test-long | 74,026,060 | 92,820 | 3.9 s | `0x56e578a60b08710c5827d6b27828148d6e49ae991acd818f52bb23df8a7e4b93` |
| kalien-911140 | 67,118,280 | 911,140 | 2.1 s | `0xdcdb93e6ea0a391219993308fef6e8723d6a3a65e95a147a95f644902402ecdf` |

Devnet probe contract: `0x65713a9cd2431ea2b3eabd9bd88d98065eb26ee4565f83e313730c5eda3b6043`.
Devnet `groundhog_chainConfig` reports `maxRv32MemoryBytes = 65536` and no per-transaction gas cap.

## Memory

Measured on RV32 with the probe method `memory_probe` (stack painting and the bump-allocator
cursor), 16 KiB stack, current code (`thruput-sdk` 0.54.0, round 3):

| item | bytes |
|---|---:|
| stack reserve (16 KiB) | 16,384 |
| stack used by `replay` (peak, includes SDK entry) | 5,296–5,340 |
| statics (`.rodata` + `.data` + `.bss`) | 2,816 (SDK 0.51.1: 5,696; before the bitset: 9,160) |
| heap used, 374–3,346-byte tapes | 4,096 |
| heap used, 18,024-byte tape | 22,123 |
| **peak total, 18,024-byte tape** | **41,323 of 65,536** (SDK 0.51.1: 44,203; before the bitset: 47,667) |

- `size_of` of the game state is about 2 KiB (43 asteroids × 36 B, 5 + 3 bullets × 24 B,
  4 saucers × 36 B, plus scalars). It is on the stack. No allocation happens per frame.
- The SDK fetches calldata into a heap `Vec`. It first holds a 4 KiB scratch buffer, then grows
  to the calldata size. The bump allocator never frees the first 4 KiB. So an 18,024-byte tape
  uses 22,123 bytes of heap.
- With the default 30 KiB stack, the heap is only 25,656 bytes. Calldata up to about 17,000 bytes
  works; an 18,024-byte tape faults, even in a method that only returns `tape.len()`.
- Fix: put `"-C", "link-arg=--defsym=__stack_size=16384",` in `.cargo/config.toml` rustflags
  **before** the `-Tgroundhog-rv32.ld` line. After `-T`, lld ignores it.
  `thruput build --stack-size 16K` also works, but `thruput test` does not take that flag.
- Headroom for the score contract (signature check, SHA-256, storage, mint call): about 20.8 KiB
  of heap plus about 11 KiB of unused stack reserve.
- The legal-score-delta table is now a 496-byte bitset (`LEGAL_SCORE_DELTA_BITS`), packed at
  compile time from the same `build_legal_score_delta_table`. A test compares every delta.

## TS/Rust parity (round 2)

Tool: `asteroids-core/parity/` (`parity.ts` + Rust binary `asteroids-parity`).
Run: `bun run asteroids-core/parity/parity.ts [--count N] [--autopilot N] [--seed S]`.

- **Corpus** (deterministic from `--seed`):
  - `uniform`: uniform random nibbles. `runs`: held inputs with random run lengths and per-bit
    weights. `pattern`: edge patterns (fire toggled every frame, fire held, both turn keys,
    thrust held, idle, all 16 values cycled). A quarter of these are full 36,000-frame tapes.
  - `autopilot`: tapes from the Rust autopilot bots (all 32 bots, random seeds, 36,000-frame cap).
  - `mutant`: fixture and autopilot tapes with 1–8 flipped input nibbles (and sometimes
    truncated), with a correct claim. `mutant-stale`: the same, but with the original claim.
  - `claim`: valid runs with a wrong claimed score (0, +1, −10, +990, `u32::MAX`).
  - `invalid`: empty, too short, bad magic/version/rules tag/reserved bytes, frame count 0,
    36,001, `u32::MAX`, length mismatches, trailing or missing bytes, CRC flips, a non-zero
    padding nibble, and a full-size tape + 1 byte.
  - `fixture`: every known tape (test fixtures, public autopilot tapes, golden local tapes).
- **Compared per tape:** container verdict and error class; replayed frame count; final score;
  a chained hash of the **full sim state after every frame** (frame, score, lives, wave, RNG
  state, game over, the ship, and every asteroid, bullet, saucer, and saucer bullet in storage
  order), with checkpoints every 500 frames to locate a divergence; the Worker's own
  `replayTape()` score; and the verdict (TS: parses and the replayed score equals the claim;
  Rust: strict `verify_tape`).
- **Self-test:** `--self-test` flips thrust and fire from frame 150 on, on the TS side only. The
  tool detected 52 of 52 perturbed tapes. (An earlier hash without entity state missed 3 of
  52; that is why the hash covers every entity.)

Large run after the round 3 fix (`--count 1500 --autopilot 192 --seed 0x5eed0001`; 5 slow bot
runs hit the 120 s timeout):

| class | tapes | frames | accepted | rejected |
|---|---:|---:|---:|---:|
| autopilot | 187 | 2,263,915 | 187 | 0 |
| claim | 357 | 8,449,846 | 0 | 357 |
| fixture | 14 | 185,824 | 13 | 1 (old v2 tape) |
| invalid | 22 | 1,504 | 2 | 20 |
| mutant | 750 | 7,384,956 | 750 | 0 |
| mutant-stale | 750 | 7,613,177 | 54 | 696 |
| pattern | 500 | 11,324,490 | 500 | 0 |
| runs | 500 | 11,275,714 | 500 | 0 |
| uniform | 500 | 10,844,934 | 500 | 0 |
| **total** | **3,580** | **59,344,360** | **2,506** | **1,074** |

- Rejected by both: 20 container errors (same class on both sides), 1,054 claim mismatches.
- State mismatches: **0**. Strict-only rejections: **0** (before the fix: 20; see round 3).
- The 2 accepted `invalid` tapes are a non-zero padding nibble and a frame count that reads the
  padding nibble as a frame. Both sims accept them the same way (see the malleability finding).
- No divergence between the sims, so I made no change to `src/game/`.

Speed: Rust eval 18.4 s, TS eval 131.7 s for two TS replays per tape (state-hash loop and the
Worker's `replayTape`). The TS sim replays about 0.9M frames per second in Bun with hashing, so
a 36,000-frame pre-check takes about 40 ms.

## Docs rewrite (round 2)

Commit `docs: rewrite README and docs for the Thruput version`.

- New: `docs/ARCHITECTURE.md` (system map, components, game core, contracts, Worker, key
  wallet, leaderboard, CLI and autopilot, the life of one run, trust model, TODO list),
  `docs/OPERATIONS.md` (setup, local run, every test command, deploy, devnet reset, relay
  funding), `asteroids-core/README.md`.
- Rewritten: root `README.md`, `docs/README.md`, `docs/games/README.md`,
  `docs/games/asteroids/README.md`, `docs/archive/README.md`,
  `docs/games/asteroids/02-VERIFICATION-SPEC.md` (on-chain replay, no journal, rule table,
  Worker pre-check).
- Fixed in `01-GAME-SPEC.md`: the fire gate is a latch + cooldown (not a shift register); saucers
  do not pause while the ship is hidden (no such rule in the code); session length.
- Renamed: `04-INTEGER-MATH-SPEC.md` → `03-INTEGER-MATH-SPEC.md`.
- New: `04-TAPE-REUSE-AND-REPLAY-POLICY.md` (current dedupe model, the malleability gap, options).
- Archived to `docs/archive/zk/`: Asteroids specs 00, 03, 05–12, 15 (`zk/asteroids/`), the ZK
  reference library (`zk/references/`), `VERIFIER-STATUS.md`, `VERIFIER-PERF-NEXT.md`,
  `PROVISIONING.md`, `LEADERBOARD-EVENT-SOURCING-OPERATIONS.md`, `SEED_EPOCH_CLOCK_AUTHORITY.md`.
  The ZK launch article went to `docs/archive/social-drafts/TWITTER-zk-launch.md`.
- Facts still in flux are marked `TODO` (lead): Worker not deployed yet, the malleability fix,
  `set_seed` and seed grinding, relay throughput, rate limits, the `deploy:testnet` /
  `deploy:mainnet` scripts in the root `package.json`.
- Not changed (other owners): `shared/README.md` still describes `shared/stellar/` (the
  contract agent says the coordinator can remove `shared/stellar/`); component READMEs.

## What changed

Commits (all on `thruput-devnet`):

1. `c78f14b test(core): add golden replay baseline for all known tapes` — before any code change.
2. `28042b6 refactor(core): move asteroids-core to repo root, remove RISC Zero verifier`.
3. `581dbfa refactor(core): make the replay core allocation-free for the RV32 guest`.
4. `3583817 feat(core): add RV32 gas probe and record replay gas and memory`.
5. `9fe5143 perf(core): pack the legal score-delta table into a bitset` (round 2).
6. `docs: rewrite README and docs for the Thruput version` (round 2).
7. `c8d6644 fix(core): stop two strict rules from rejecting honest runs` (round 3; also adds the
   parity tool).
8. `chore(core): move the gas probe to thruput-sdk 0.54.0` (round 3).

### Golden baseline (task 1)

- `asteroids-core/tests/golden.rs` and `asteroids-core/tests/golden/replay-golden.txt`.
- For every tape it records frames, claimed score, replayed score, the strict result, a chained
  FNV-1a hash over the full world snapshot after **every** frame, and the chained hash every
  1,000 frames.
- Tapes: `test-fixtures/*.tape` (5), `autopilot/fixtures/public/*.tape` (2), and the 7 tapes
  from the main checkout's gitignored `checkpoints/` and `generated-tapes/`, copied to
  `asteroids-core/tests/fixtures/local/` (52 KB). One of them is an old v2 tape; the golden file
  pins its parse error. Also 6 synthetic tapes (the 5 from the old tests and one random
  36,000-frame tape).
- Regenerate only for an intended rules change: `UPDATE_GOLDEN=1 cargo test --test golden`.

### Move and removal (task 2)

- `kalien-verifier/asteroids-core` → `asteroids-core/` (crate name unchanged:
  `asteroids-verifier-core`). The Apache-2.0 `LICENSE` moved with it.
- Removed the rest of `kalien-verifier/` (RISC Zero host, methods/guest, api-server, deploy,
  VASTAI, benchmarks).
- `autopilot/Cargo.toml` now points at `../asteroids-core`. `autopilot/Cargo.lock` lost the
  `serde`/`stellar-strkey` entries of the core.

### Guest-friendly core (task 3)

- `src/fixed_vec.rs`: inline `FixedVec<T, N>` with `push`, stable `retain`, and slice `Deref`.
  Same element order as `Vec` + `retain` (exhaustive test against `Vec::retain`).
- Capacities: asteroids 43 (as before), ship bullets 5, saucers 4, saucer bullets 3. The bullet
  buffers have one spare slot so the existing over-limit invariant tests still work.
- Proof of bounds (comment in `src/sim/mod.rs`): asteroids ≤ `ASTEROID_CAP` + 6 = 33, ship
  bullets ≤ 4, saucers ≤ 3, saucer bullets ≤ 2. A stress test (all tapes + 64 random 36,000-frame
  tapes) checks the bounds; observed peaks are 28, 4, 3, 2. A push past capacity aborts.
- `tape::parse_tape_ref` / `TapeRef` / `PackedInputs`: all container checks, then nibbles are
  read from the borrowed body. `parse_tape` (unpacked `Vec`) stays for host code.
- `sim::replay_strict_inputs` / `sim::replay_inputs` take any `u8` iterator.
- `verify_tape(bytes, max_frames) -> Result<VerifiedTape { seed, frame_count, final_score }, VerifyError>`
  does not allocate. Strict rule checks are unchanged.
- Removed: ZK journal, `GuestInput`, claimant encoding, `stellar-strkey`, `serde`,
  `JOURNAL_*` constants, `VerifyError::{InvalidClaimant, JournalLengthMismatch}`.
- Features: `default = ["std"]`, `std = ["alloc"]`. `alloc` gates the host helpers
  (`parse_tape`, `serialize_tape`, `WorldSnapshot`, `LiveGame::snapshot`,
  `replay_with_checkpoints`). The verify path builds with `--no-default-features`.

### Gas probe (task 4)

`asteroids-core/gas-probe/` (scaffold from `thruput new`, SDK `=0.51.1`, `sdk` feature `alloc`).
Methods: `replay(tape: &[u8]) -> u32`, `parse_only`, `noop`, `memory_probe`. A failed tape throws
`ReplayFailed { code, detail }` (code = `VerifyError` variant number, detail = rule frame).
The `&[u8]` argument borrows the calldata, so the tape is not copied.

## How I tested

All commands use `CARGO_HOME=$HOME/.cargo-thruput`.

| command | result |
|---|---|
| `cargo test --release` in `asteroids-core` | 55 unit + golden + 5 integration: pass |
| `cargo test` (debug, overflow checks) in `asteroids-core` | pass |
| `cargo build --release --no-default-features` in `asteroids-core` | pass |
| `cargo clippy --release --all-targets` in `asteroids-core` | no warnings |
| `cargo test --release --manifest-path autopilot/Cargo.toml` | pass |
| `bun run scripts/verify-tape.ts <tape>` for all 14 tapes | all agree with Rust (v2 tape rejected by both) |
| `cargo test --release` in `gas-probe` | 2 native tests pass |
| `thruput test --show-output` in `gas-probe` | 3 RV32 tests pass (gas table, memory table, tamper) |
| local node + `thruput call gas-probe replay 0x<tape> --gas-limit 90000000` | 5/5 succeeded |
| devnet `thruput call ... --profile devnet --gas-limit 80000000` | 3/3 succeeded |

## Environment notes for other agents

- `~/.cargo/config.toml` is read for every project under `$HOME`, even with
  `CARGO_HOME=$HOME/.cargo-thruput`. Its `groundhog` registry clashes with `thruput`.
  `CARGO_REGISTRIES_GROUNDHOG_INDEX` does not fix it. Add
  `groundhog = { index = "sparse+https://groundhog-registry-unused.invalid/" }` under
  `[registries]` in the project `.cargo/config.toml` (the contract agent does the same).
- `cargo`, `thruput build`, and git commits need the sandbox off (`~/.cargo-thruput` and
  `~/.gnupg` are not writable in the sandbox).
- `thruput airdrop --profile devnet` fails (no `faucet_url`; the hosted faucet URL returns 404 on
  `/v1/network`). The RPC method works: `groundhog_requestAirdrop` with
  `{ recipient: <32-byte hex address>, clientNonce: <1–32 random bytes hex> }` gave 1,000 HOG.
- `thruput node` writes the active endpoint into `~/.config/thruput/config.toml`. I ran it on port
  9545 and stopped it after the tests.
- Round 3: a second managed node needs its own cache:
  `XDG_CACHE_HOME=$HOME/.cache/kt-core-node thruput node --port 9545 --key kt-core-local
  --initial-account-hog 1000 --hog-devnode-version 0.1.31-rc.14` (with `thruput/toolchain`
  symlinked to the shared `~/.cache/thruput/toolchain`). `--key ... --initial-account-hog` funds
  the key at genesis, so no airdrop is needed. CLI 0.36 `call --json` reports `transactionHash`,
  `blockHeight`, `execution.result`, and `gasUsed` (decimal string).
- Keys created: `kt-core-local` (local only) and `kt-core-devnet` (devnet throwaway). Both live in
  `~/.config/thruput/keys/`. No secret is in git or in this report.

## Incident: my commit 581dbfa swept in other agents' staged files

The shared index held files that other agents had staged with `git rm` and `git mv`. My bare
`git commit` after `git add <my paths>` committed them too. The commit contains 119 deletions in
`kalien-contract/`, `scripts/`, `test-fixtures/proof-*`, `tests/worker/`, `worker/`, and
`autopilot/scripts/verify-checkpoints-risc0-dev.sh`, plus two 100% renames
(`src/components/proof/StepIndicator.tsx` → `src/components/shared/StepIndicator.tsx`,
`src/hooks/useEndlessSeedScoreGate.ts` → `src/hooks/useSeedScoreGate.ts`). No content change of
another agent's file is in it, and nothing is lost. Those agents will not see these entries as
staged any more. Since then I commit only with `git commit -m ... -- <my paths>`.

## References in other agents' paths (to `kalien-verifier/`)

- `README.md` lines 7 and 15 (coordinator).
- `vite.config.ts:20` watch-ignore of `**/kalien-verifier/**` (client; now harmless).
- `docs/*` (many; coordinator): `PROVISIONING.md`, `VERIFIER-STATUS.md`, `VERIFIER-PERF-NEXT.md`,
  `games/asteroids/10-*`, `12-*`, `15-*`, `archive/*`.
- `kalien-contract/codex-improvements.md`, `kalien-contract/.env.example` (contract; removed in
  the working tree by that agent).
- `scripts/bench-risc0.sh`, `scripts/bench-core-cycles.sh`, `scripts/verify-tape-risc0.ts` (cli;
  removed by that agent).
- `worker/boundless/stdin.ts` (worker; removed by that agent).
- `autopilot/scripts/verify-checkpoints-risc0-dev.sh` (removed).

## Requests to other agents

- **contract:** build `kalien_score` with a 16 KiB stack (`--defsym=__stack_size=16384` before
  `-T` in rustflags), and take the tape as `tape: &[u8]` so it borrows the calldata. Depend on
  `asteroids-verifier-core = { path = "../../asteroids-core", default-features = false }` (adjust
  the path) and call `asteroids_verifier_core::verify_tape(tape, 36_000)`. It returns `seed`,
  `frame_count`, `final_score`. Do not collect the inputs into a `Vec`. Use a gas limit near 80M
  for full tapes.
- **worker:** the relay wallet needs at least 8 HOG free per concurrent full-length submission
  (gas is reserved, not burned).
- **cli:** keep the tapes in `test-fixtures/` (`test-short`, `test-medium`, `test-real-game`,
  `test-long`, `test-real-game-26360`) and in `autopilot/fixtures/public/`. The golden test and the
  gas probe read them.

## Open items

- **kt-contract:** rebuild and redeploy `kalien_score` with `asteroids-core` at `c8d6644` or later
  (the strict-rule fix). Without it, about 0.8% of honest runs fail with `RuleViolation` after
  the relay spent gas.

- Decision needed: the tape-malleability fix (see round 2 summary, item 4). The two cheap
  options (zero padding nibble; tape must end at game over or at 36,000 frames) are exact rule
  tightenings that I can make in `asteroids-core` and `src/game/tape.ts`. The contract then
  needs a redeploy.
- Hot-path optimization is not needed (one transaction replays a full tape).
- `asteroids-core/tests/fixtures/local/asteroids-19c8d5b04e2.tape` is an old v2 tape. It stays to
  pin the parser's rejection.
