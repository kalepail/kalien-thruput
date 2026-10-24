# Operations: setup, tests, deploy, devnet reset

Commands for every part of Kalien on the Thruput devnet. Each component README has more detail.

## Versions (2026-10-24)

| Item | Version |
|---|---|
| Devnet | wire format 14.1.0, implementation 0.36.0 |
| Thruput CLI | `thruput 0.36.0` |
| Local node bundle | `hog-devnode 0.1.31-rc.14` |
| Contract SDK | `thruput-sdk =0.54.0` (registry `thruput`) |
| TS client | `@thruputchain/client@0.23.0` + `@thruputchain/protocol@0.18.0` |

Read the devnet's version and network hash with the RPC (`getVersionInfo`, `getNetworkInfo`,
`params: {}`) before you sign anything. Identifiers are base58.

## Setup

- **Bun dependencies.** `@thruputchain/*` packages come from GitHub Packages (see `.npmrc`).

  ```bash
  export GH_NPM_TOKEN="$(gh auth token)"
  bun install
  ```

- **Rust for contracts.** Always set `CARGO_HOME=$HOME/.cargo-thruput` for `cargo`,
  `thruput build`, `thruput test`, and `thruput deploy`. Contract projects pin their nightly
  toolchain in `rust-toolchain.toml`. Start new contract projects from `thruput new`.
- **Registry clash.** Cargo reads `~/.cargo/config.toml` for every project under `$HOME`. If it
  names the Thruput index `groundhog`, Cargo refuses the second name `thruput`. Each Thruput
  project's `.cargo/config.toml` points `groundhog` to an unused index.
- **Contract stack size.** Contracts that replay tapes put
  `"-C", "link-arg=--defsym=__stack_size=16384",` in `.cargo/config.toml` rustflags **before**
  the `-Tgroundhog-rv32.ld` line (after it, the linker ignores it).
- **RPC rules (wire 14).** Follow `docs/thruput/reference/json-rpc-alpha-guide.md`: named
  params objects, base58 identifiers, lowercase `0x` hex payloads, decimal-string heights and
  gas, admission vs commitment vs `receipt.execution.result`, cursor walks to
  `nextCursor: null`, `error.data.kind`, and no automatic resubmission after an uncertain send.

## Run locally

| Goal | Command |
|---|---|
| Browser app + Worker (Vite + Cloudflare plugin) | `bun run dev` |
| Browser app against another Worker | `KALIEN_API_PROXY=http://127.0.0.1:5174 node node_modules/vite/bin/vite.js dev --port 5173` |
| Worker alone on port 5174 | `worker/README.md` ("Local run"): `.dev.vars`, local D1 migrations, `vite dev --port 5174` |
| Local Thruput node | `thruput node --port 9545 --key <key> --initial-account-hog 1000` (funds the key at genesis) |
| Second local node on the same machine | add `XDG_CACHE_HOME=$HOME/.cache/<name>` with `thruput/toolchain` symlinked to `~/.cache/thruput/toolchain` (the CLI allows one managed node per cache) |
| CLI | `cd cli && bun install && bun run build`, then `cli/dist/kalien whoami` |

`thruput node` rewrites `[local_runtime_state]` in `~/.config/thruput/config.toml`. Pass
`--rpc-url` and `--runtime-manifest` to later commands when more than one node runs.

## Tests

| Area | Command |
|---|---|
| Rust game core (unit, golden, capacity bounds, strict regressions) | `cargo test --release --manifest-path asteroids-core/Cargo.toml` |
| TS/Rust parity (full state on every frame) | `bun run asteroids-core/parity/parity.ts` (`--count`, `--autopilot`, `--seed`, `--self-test`) |
| Gas and memory probe (RV32) | `cd asteroids-core/gas-probe && thruput test --show-output` |
| Contracts (native + RV32 + claim vectors) | `kalien-contract/scripts/test.sh` |
| Contracts on a local node | `bun kalien-contract/scripts/kalien.ts integration --rpc http://127.0.0.1:<port>` |
| Shared TS helpers | `bun test shared/thruput/` (`KALIEN_LIVE=1` for the live devnet test) |
| Worker | `bun test tests/worker`, `bun run typecheck:worker` |
| Browser modules | `bun test tests/src` |
| CLI | `cd cli && bun test src` |
| Autopilot | `cargo test --release --manifest-path autopilot/Cargo.toml` |
| One tape with the TS sim | `bun run scripts/verify-tape.ts <tape>` |
| One tape with the Rust core | `cargo run --release --manifest-path autopilot/Cargo.toml -- verify-tape --input <tape> --max-frames 36000` |
| End-to-end runs against a Worker | `bun run scripts/e2e-runs.ts --api-url <worker-url>` |
| Load test against a Worker | `bun tests/worker/live/load-runs.ts` |
| Repo checks (types, lint, format) | `bun run check` |

## Deploy

### Contracts (devnet)

```bash
kalien-contract/scripts/deploy-devnet.sh
```

The script creates or reuses the keys `kalien-deployer`, `kalien-relay`, and
`kalien-test-player`, funds them, deploys `kalien_token` and `kalien_score`, hands the token to
the score contract, creates the current seed, submits the fixture tapes, allows the relay
addresses, turns on relay-only mode, locks seeding, writes
`shared/thruput/deployments/devnet.json`, and writes the relay secret to
`~/.config/kalien-thruput/relay.secret` (mode 600).

TODO(lead): v3 contract on the new devnet (relay allowlist up to 8, pruning, new event fields).
Confirm the script steps and the addresses after kt-contract's redeploy.

### Worker

```bash
bun run deploy                       # worker/ops/deploy.sh: checks, build, remote D1 migrations, deploy
bash worker/ops/deploy.sh --secrets  # also uploads RELAY_SECRETS and DEV_API_KEY
bun run smoke                        # worker/ops/smoke.ts against the deployed Worker
```

- The deploy script reads secrets from `KALIEN_RELAY_DIR` (default
  `~/.config/kalien-thruput`): `relay.secret`, `relay-2.secret`, … (one per lane) and
  `dev-api.key`. It pipes them to wrangler and never prints them.
- The Worker reads the contract addresses and network hash from
  `shared/thruput/deployments/devnet.json`; `wrangler.jsonc` vars can override them.
- `worker/ops/relay-keys.ts` lists, funds, and exports lane keys. Each lane address must be
  allowed on the score contract (relay allowlist).
- Target: `https://kalien-thruput.sdf-ecosystem.workers.dev`. TODO(lead): confirm it is live on
  the new devnet.

## Devnet reset (after a wipe)

A wipe changes the network hash, all addresses, and all balances. Keys in
`~/.config/thruput/keys/` survive; their devnet accounts are empty.

1. Read the new network hash: `getNetworkInfo` on `https://rpc.thruput.network`. Check that
   `getVersionInfo.wireFormat` matches the pinned TS client and CLI; upgrade them first if not.
2. Fund the deployer and every relay lane key with `faucet_requestAirdrop` (keep the request
   and its nonce; the SDK calls it once and only waits). For the lanes:
   `bun worker/ops/relay-keys.ts --fund` (airdrops to lanes under `--min` HOG, default 50).
3. Run `kalien-contract/scripts/deploy-devnet.sh`. It writes the new
   `shared/thruput/deployments/devnet.json`.
4. Allow every lane relay on the new score contract, then `bun run deploy` (with `--secrets` if
   the lane keys changed). The Worker's state is per score contract, so it starts clean.
5. Run `bun run smoke` and `bun run scripts/e2e-runs.ts --api-url <worker-url>`.
6. Browsers keep their keys and addresses (the address depends only on the public key), but old
   balances and best scores are gone.

## Funding and monitoring

- **Relay lanes.** Gas is reserved, not burned. A lane needs free HOG at least equal to the gas
  limits of its in-flight runs: up to about 9 HOG for one 36,000-frame run.
- **Contracts.** Storage deposits come from the contract's own HOG: about 0.0036 HOG per new best
  entry on the score contract and about 0.002 HOG per new KALIEN holder on the token. Alert when
  a contract balance drops below 5 HOG; top up with `thruput transfer`. An empty contract stalls
  new runs (they are excluded from blocks, not failed).
- **Faucet.** `faucet_requestAirdrop` on devnet (on the old devnet it gave 1,000 HOG per call).

## Secrets

| Secret | Where | Never |
|---|---|---|
| Relay lane seeds | `~/.config/kalien-thruput/relay*.secret` (mode 600), Worker secret `RELAY_SECRETS` | in git, logs, or `.dev.vars` committed |
| Admin API key | `~/.config/kalien-thruput/dev-api.key`, Worker secret `DEV_API_KEY` | in git or logs |
| Deploy and test keys | `~/.config/thruput/keys/` | printed |
| Player keys | the player's browser `localStorage` or CLI key file (mode 0600) | sent to the Worker (only the public key and signatures are sent) |

`.dev.vars` and `.env` are gitignored. Never print a secret key.
