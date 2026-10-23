# Kalien Thruput contracts

Two Rust `no_std` contracts for the Thruput RV32 VM (SDK `=0.51.1`, CLI 0.29.2):

- `contracts/kalien_score/`: replays an Asteroids tape on-chain with `asteroids-core`
  (strict rules, up to 36,000 frames), keeps the best score per player per 10-minute seed
  epoch, mints the improvement in KALIEN, and emits `ScoreSubmitted`.
- `contracts/kalien_token/`: KALIEN, a standard ERC20 (+ metadata) whose only minter is the
  score contract.

The interface (methods, claim message, address rule, errors, events, gas) is in
`docs/thruput/PORT-PLAN.md`, section "Interface v2".

## Setup

- Always set `CARGO_HOME=$HOME/.cargo-thruput` (`scripts/env.sh` does this).
- `.cargo/config.toml` comes from `thruput new`, plus two changes:
  - a 16 KiB guest stack (`--defsym=__stack_size=16384`, before `-T`). The default 30 KiB stack
    leaves too little heap for the 18,024-byte calldata of a full tape.
  - an unused `groundhog` registry entry, so a parent `~/.cargo/config.toml` that names the
    same index `groundhog` cannot clash with `thruput`.
- `kalien_score` enables the sdk `alloc` feature on RV32. Without it, calldata is capped at
  4,096 bytes.

## Build and test

```bash
kalien-contract/scripts/build.sh        # both .rv32a artifacts + TS bindings in shared/thruput/bindings/
kalien-contract/scripts/test.sh         # cargo test, RV32 tests (prints gas), bun claim vectors
```

- `cargo test --workspace`: 25 native tests (all fixtures, every rejection, mint amounts, token)
  and 9 adversarial tests (`tests/adversarial.rs`).
- `thruput test -p kalien_score`: the same fixtures on the real RV32 artifacts. Build
  `kalien_token` first (`thruput build -p kalien_token`).
- Local node test (fresh keys, deploy, submit, events, balances):

```bash
thruput node --port 9645 &        # one managed node per machine: see docs/thruput/kt-contract.md
bun kalien-contract/scripts/kalien.ts integration --rpc http://127.0.0.1:9645
```

## Devnet

```bash
kalien-contract/scripts/deploy-devnet.sh            # after a devnet wipe, too
```

It creates the keys `kalien-deployer`, `kalien-relay`, `kalien-test-player` if missing (in
`~/.config/thruput/keys`), funds them from the faucet, deploys and links both contracts,
writes `shared/thruput/deployments/devnet.json`, creates the current seed, submits the fixture
tapes (`deployments/devnet-fixture-runs.json`), allows only `kalien-relay` to submit
(`relay_only`), locks `set_seed` for good, and writes the relay secret for the Worker to
`~/.config/kalien-thruput/relay.secret` (mode 600).

Other commands of `scripts/kalien.ts`: `fund`, `deploy`, `ensure-seed`, `set-seed`, `submit`,
`fixtures`, `harden`, `export-secret`. Run it with no command for usage.

## Files

- `fixtures/`: copies of the test tapes with known seed, frames and score.
- `deployments/`: devnet fixture-run results and the last local integration run.
- `scripts/gen-claim-vectors.ts`: regenerates `shared/thruput/claim-vectors.json`.
