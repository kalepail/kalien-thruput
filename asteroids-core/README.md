# asteroids-core

Deterministic Asteroids simulation, tape format, and strict verifier (crate
`asteroids-verifier-core`). The Thruput score contract replays tapes with it on chain; the
autopilot uses it on the host. The TS sim in `src/game/` must match it on every frame.

- `no_std`; no allocation while it steps (fixed-capacity entity storage, packed tape reader).
- `default = ["std"]`, `std = ["alloc"]`. The `alloc` feature adds host helpers: `parse_tape`
  (unpacked inputs), `serialize_tape`, `LiveGame::snapshot`, `replay_with_checkpoints`.
- Contracts use `default-features = false` and call `verify_tape(tape, 36_000)`, which returns
  `VerifiedTape { seed, frame_count, final_score }` or a `VerifyError`.

## Layout

| Path | Content |
|---|---|
| `src/sim/` | Game state, step order, strict transition and invariant checks |
| `src/tape.rs` | Tape container, CRC-32, `parse_tape_ref` / `PackedInputs` |
| `src/verify.rs` | `verify_tape` |
| `src/fixed_point.rs`, `src/rng.rs`, `src/constants.rs` | Integer math, xorshift32, rules constants |
| `tests/golden.rs` + `tests/golden/` | Golden baseline: per-frame state hash for every known tape |
| `gas-probe/` | Minimal Thruput contract that measures replay gas and guest memory on RV32 |
| `parity/` | TS/Rust parity tool (`parity.ts` + Rust `asteroids-parity`) |

## Commands

Set `CARGO_HOME=$HOME/.cargo-thruput` (see `docs/OPERATIONS.md`).

```bash
cargo test --release --manifest-path asteroids-core/Cargo.toml
UPDATE_GOLDEN=1 cargo test --release --manifest-path asteroids-core/Cargo.toml --test golden  # only for an intended rules change
(cd asteroids-core/gas-probe && thruput test --show-output)                                  # gas and memory tables
bun run asteroids-core/parity/parity.ts                                                       # TS/Rust parity
```

Measured numbers (gas per frame, memory, parity counts) are in `docs/thruput/kt-core.md`.

License: Apache-2.0 (`LICENSE`).
