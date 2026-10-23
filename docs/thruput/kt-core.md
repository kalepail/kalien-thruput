# kt-core report: simulation core and gas measurement

Agent: `kt-core`. Branch: `thruput-devnet`. Status: **STOP point A reached** (tasks 1–4 done).

## Result

One transaction can replay a full 36,000-frame tape. A chunked replay is not necessary.

- Gas for a full tape is 67M to 74M. The sender needs that much free HOG (7.4 HOG). Gas is not burned.
- Peak guest memory is about 47.7 KiB of 64 KiB, with a 16 KiB stack.
- The contract **must** build with a 16 KiB stack. The default 30 KiB stack leaves too little heap
  for an 18,024-byte tape (see "Memory").

## Gas table

Measured with `thruput test` (RV32 executor). The local node and devnet transactions report the
same numbers + 50 gas (the wallet wrapper).

| tape | frames | bytes | noop gas | parse gas | replay gas | gas/frame | executor wall ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| test-short | 700 | 374 | 1,001 | 6,423 | 1,243,024 | 1,767 | 6.7 |
| test-medium | 5,000 | 2,524 | 1,001 | 36,523 | 9,488,037 | 1,890 | 50.4 |
| test-real-game | 6,643 | 3,346 | 1,001 | 48,031 | 14,003,931 | 2,101 | 73.4 |
| test-long | 36,000 | 18,024 | 10,360 | 262,882 | 74,026,010 | 2,049 | 393.0 |
| kalien-911140 | 36,000 | 18,024 | 10,360 | 262,882 | 67,118,230 | 1,857 | 349.8 |

- `noop` = calldata only. `parse` = container checks and CRC-32. `replay` = parse + strict replay.
- gas/frame = (replay − parse) / frames.
- Planning number: **75M gas** covers every tape up to 36,000 frames that we measured. Use a gas
  limit of 80M for a 36,000-frame tape (8 HOG free in the relay wallet).
- `maxViewGas` is 10M, so `view` can preview tapes up to about 5,000 frames only.

### Real transactions

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
cursor), 16 KiB stack:

| item | bytes |
|---|---:|
| stack reserve (16 KiB) | 16,384 |
| stack used by `replay` (peak, includes SDK entry) | 5,296–5,340 |
| statics (`.rodata` + `.data` + `.bss`) | 9,160 |
| heap used, 374–3,346-byte tapes | 4,096 |
| heap used, 18,024-byte tape | 22,123 |
| **peak total, 18,024-byte tape** | **47,667 of 65,536** |

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
- Headroom for the score contract (signature check, SHA-256, storage, mint call): about 17.9 KiB
  of heap plus about 11 KiB of unused stack reserve.
- Possible saving, if needed: the legal-score-delta table is a `[bool; 3961]` in `.rodata`. A
  bitset would save about 3.4 KiB with the same semantics.

## What changed

Commits (all on `thruput-devnet`):

1. `c78f14b test(core): add golden replay baseline for all known tapes` — before any code change.
2. `28042b6 refactor(core): move asteroids-core to repo root, remove RISC Zero verifier`.
3. `581dbfa refactor(core): make the replay core allocation-free for the RV32 guest`.
4. Gas probe and this report (next commit).

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

All commands use `CARGO_HOME=/Users/kalepail/.cargo-thruput`.

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
  `CARGO_HOME=/Users/kalepail/.cargo-thruput`. Its `groundhog` registry clashes with `thruput`.
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

- Task 5 waits for the lead: hot-path optimization (not needed for feasibility) and any
  resumable replay shape.
- `asteroids-core/tests/fixtures/local/asteroids-19c8d5b04e2.tape` is an old v2 tape. It stays to
  pin the parser's rejection.
