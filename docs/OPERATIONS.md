# Operations: setup, tests, deploy, devnet reset

This page collects the commands for every part of Kalien on Thruput. Each component README has
the details.

## Setup

- **Bun dependencies.** The `@thruputchain/*` packages come from GitHub Packages (see `.npmrc`).

  ```bash
  export GH_NPM_TOKEN="$(gh auth token)"
  bun install
  ```

  Keep `@thruputchain/client@0.18.0` and `@thruputchain/protocol@0.15.0`. They match the devnet
  wire format 11.x. Do not upgrade to 0.20 or later.
- **Rust for contracts.** Use the Thruput CLI `thruput 0.29.2` and always set
  `CARGO_HOME=$HOME/.cargo-thruput` for `cargo`, `thruput build`, `thruput test`, and
  `thruput deploy`. Contract projects pin their nightly toolchain in `rust-toolchain.toml`.
- **Registry clash.** Cargo reads `~/.cargo/config.toml` for every project under `$HOME`. If it
  names the Thruput index `groundhog`, Cargo refuses the second name `thruput`. Each Thruput
  project's `.cargo/config.toml` points `groundhog` to an unused index to stop the clash.
- **Contract stack size.** Contracts that replay tapes put
  `"-C", "link-arg=--defsym=__stack_size=16384",` in `.cargo/config.toml` rustflags, before the
  `-Tgroundhog-rv32.ld` line (after it, the linker ignores it).
- **Secrets.** Keep secrets out of git: `.dev.vars`, `.env`, `~/.config/thruput/keys/`,
  `~/.config/kalien-thruput/relay.secret`. Never print a secret key.

## Run locally

| Goal | Command |
|---|---|
| Browser app + Worker (Vite + Cloudflare plugin) | `bun run dev` |
| Browser app against another Worker | `KALIEN_API_PROXY=http://127.0.0.1:5174 node node_modules/vite/bin/vite.js dev --port 5173` |
| Worker alone on port 5174 | see `worker/README.md` ("Local run"): `.dev.vars`, D1 migrations `--local`, `vite dev --port 5174` |
| Local Thruput node | `thruput node --port 9545` (one managed node per machine; it rewrites `[local_runtime_state]` in `~/.config/thruput/config.toml`, so pass `--rpc-url` and `--runtime-manifest` to later commands) |
| CLI | `cd cli && bun install && bun run build`, then `cli/dist/kalien whoami` |

## Tests

| Area | Command |
|---|---|
| Rust game core (unit, golden baseline, capacity bounds) | `cargo test --release --manifest-path asteroids-core/Cargo.toml` |
| TS/Rust parity (full state on every frame) | `bun run asteroids-core/parity/parity.ts` (options: `--count`, `--autopilot`, `--seed`, `--self-test`) |
| Gas and memory probe (RV32) | `cd asteroids-core/gas-probe && thruput test --show-output` |
| Contracts (native + RV32 + claim vectors) | `kalien-contract/scripts/test.sh` |
| Contracts on a local node | `bun kalien-contract/scripts/kalien.ts integration --rpc http://127.0.0.1:9645` |
| Worker | `bun test tests/worker`, `bun run typecheck:worker` |
| Browser modules | `bun test tests/src` |
| CLI | `cd cli && bun test src` |
| Autopilot | `cargo test --release --manifest-path autopilot/Cargo.toml` |
| Tape check with the TS sim | `bun run scripts/verify-tape.ts <tape>` |
| Tape check with the Rust core | `cargo run --release --manifest-path autopilot/Cargo.toml -- verify-tape --input <tape> --max-frames 36000` |
| End-to-end runs against a Worker | `bun run scripts/e2e-runs.ts --api-url http://127.0.0.1:5174` |
| Repo checks (types, lint, format) | `bun run check` |

## Deploy

### Contracts (devnet)

```bash
kalien-contract/scripts/deploy-devnet.sh
```

The script creates or reuses the keys `kalien-deployer`, `kalien-relay`, and
`kalien-test-player`, funds them, deploys and links `kalien_token` and `kalien_score`, writes
`shared/thruput/deployments/devnet.json`, creates the current seed, submits the fixture tapes, and
writes the relay secret to `~/.config/kalien-thruput/relay.secret` (mode 600).

Funding: the devnet faucet works through the RPC method `groundhog_requestAirdrop`
(`client.requestAirdrop`). On devnet it gave 1,000 HOG per call. `thruput airdrop --profile devnet`
does not work with CLI 0.29.2 (no faucet URL).

### Worker

Steps from `docs/thruput/kt-worker.md`:

```bash
wrangler secret put RELAY_SECRET < ~/.config/kalien-thruput/relay.secret
wrangler secret put DEV_API_KEY
wrangler d1 migrations apply kalien-thruput-leaderboard --remote
vite build && wrangler deploy
```

The build includes the browser app. `wrangler.jsonc` holds the network hash and contract
addresses (`THRUPUT_NETWORK_HASH`, `SCORE_CONTRACT`, `TOKEN_CONTRACT`).

TODO (lead): the root `package.json` still has `deploy:testnet` and `deploy:mainnet` scripts
from the Stellar version. Rename or remove them when the Worker deploy is final.

## Devnet reset

A devnet wipe changes the network hash, all addresses, and all balances.

1. Read the new network hash: `groundhog_networkInfo` on `https://rpc.thruput.network`.
2. Run `kalien-contract/scripts/deploy-devnet.sh`.
3. Update `wrangler.jsonc` vars from the new `shared/thruput/deployments/devnet.json`, put the new
   relay secret, and deploy the Worker. The indexer restarts by itself when `SCORE_CONTRACT`
   changes.
4. Browsers keep their keys. Their addresses stay the same (the address depends only on the
   public key), but old balances are gone.

## Relay funding

- Gas is reserved, not burned. The relay needs free HOG at least equal to the gas limit of each
  in-flight run: up to about 9 HOG for a 36,000-frame tape.
- Storage deposits cost about 0.0012 HOG per new storage item. They come from the contract
  balance (each contract got 50 HOG at deploy).
