# kalien-contract agent guide

Thruput RV32 contracts (`thruput new` layout, SDK `=0.51.1`, CLI 0.29.2). Read `README.md`
first, then `thruput skill show contracts` for the SDK model.

- Run cargo and thruput with `CARGO_HOME=$HOME/.cargo-thruput` (`source scripts/env.sh`).
- Keep features `entrypoints`, `dev`, `thruput-integration-test`, the RV32 `[[bin]]` names, and the
  self dev-dependencies. Keep `.cargo/`, `rust-toolchain.toml` and `thruput.toml` at this root.
- Keep the 16 KiB stack `--defsym` before `-T` in `.cargo/config.toml`, and the sdk `alloc`
  feature in `kalien_score`: full 36,000-frame tapes need both.
- Contract logic lives in `src/implementation.rs`; byte layouts that TS must mirror live in
  `kalien_score/src/claim.rs` (mirror: `shared/thruput/claim.ts`, vectors in
  `shared/thruput/claim-vectors.json`); the replay sits behind `kalien_score/src/replay.rs`.
- After an interface change: `scripts/build.sh` (regenerates `shared/thruput/bindings/`),
  `scripts/test.sh`, update "Interface v3" in `docs/thruput/PORT-PLAN.md`, and redeploy with
  `scripts/deploy-devnet.sh` (contracts are immutable).
- Never print or commit secret keys. Keys live in `~/.config/thruput/keys`.
