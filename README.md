![Kalien](public/kalien-meta-2.jpg)
# Kalien

Kalien is a deterministic Asteroids game on the **Thruput devnet**. You play in the browser. The
game records your inputs on a tape. A Thruput smart contract replays the tape on chain with the
Rust game core, checks the score, keeps your best score per 10-minute seed epoch, and mints
KALIEN for each improvement.

There is no zero-knowledge proof and no wallet setup. The browser makes an Ed25519 key on your
first visit. A relay pays the transaction, and your signature binds the run to your address.

- App: `https://thruput.kalien.xyz` (live; the same Worker also answers at
  `https://kalien-thruput.sdf-ecosystem.workers.dev`)
- Chain: Thruput devnet (wire format 14, base58 identifiers), RPC `https://rpc.thruput.network`,
  explorer `https://explorer.thruput.network/`
- Contracts (v3): score `EBTr2RMKd4bdv2yvrChvRHmV7qcRrqW89vJFDYrgQP73`, token
  `FLVWcma7YdSPbfSPESD185wUNWemURHA1xA2L86Qnm5i` on network
  `6RgqYi69r94rCG1qKZ5NfCMAxonNAMXbDsFZMgGwgP2J` (source of truth:
  `shared/thruput/deployments/devnet.json`)

## Components

| Path | What it is |
|---|---|
| [`asteroids-core/`](asteroids-core/README.md) | Rust game core and strict tape verifier (`no_std`, used on chain) |
| [`src/game/`](src/game/) | TypeScript twin of the game core (browser play, Worker pre-check) |
| [`kalien-contract/`](kalien-contract/README.md) | Thruput contracts (`thruput-sdk =0.57.0`): `kalien_score` (on-chain replay, best scores, mint) and `kalien_token` (KALIEN) |
| [`shared/thruput/`](shared/thruput/README.md) | Claim digest helper, generated TS bindings, devnet deployment record |
| [`worker/`](worker/README.md) | Cloudflare Worker: API, relay lanes (Durable Objects), seed cron, leaderboard indexer |
| [`src/`](src/) | React client: key wallet, play, submit, run history, leaderboard, replay |
| [`cli/`](cli/README.md) | `kalien` terminal client: key file, bots, submit, status |
| [`autopilot/`](autopilot/README.md) | Rust bot lab for tape generation and benchmarks |
| [`scripts/`](scripts/) | Tape tools and end-to-end scripts |
| [`test-fixtures/`](test-fixtures/README.md) | Known tapes used by every test layer |

How the parts fit: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How to run and deploy

### Play against the live devnet (fastest)

```bash
export GH_NPM_TOKEN="$(gh auth token)"   # @thruputchain packages come from GitHub Packages
bun install
bun run dev                              # browser app + Worker; contracts from shared/thruput/deployments/devnet.json
```

The local Worker needs `.dev.vars` (copy `.dev.vars.example`: `RELAY_SECRETS`, `DEV_API_KEY`).
To use the deployed API instead: `KALIEN_API_PROXY=https://thruput.kalien.xyz bun run dev`.

### Full stack on a local node

```bash
export CARGO_HOME=$HOME/.cargo-thruput
# 1. A local chain (CLI 0.40.0, hog-devnode rc.16). The key gets 1,000 HOG at genesis.
thruput node --port 9745 --key <your-key> --initial-account-hog 1000
# 2. Contracts on it: deploy-devnet.sh in rehearsal mode (separate deployment file and secrets).
KALIEN_RPC_URL=http://127.0.0.1:9745 KALIEN_DEPLOYMENT_FILE=$TMPDIR/local-deploy.json \
KALIEN_SECRETS_DIR=$TMPDIR/kalien-secrets KALIEN_FIXTURE_RUNS_FILE=$TMPDIR/local-fixtures.json \
  kalien-contract/scripts/deploy-devnet.sh --skip-fixtures
# 3. Worker + app against the node: copy .dev.vars.example to .dev.vars.local and fill the
#    local-node block (THRUPUT_RPC_URL, SCORE_CONTRACT, TOKEN_CONTRACT) and the relay secrets.
CLOUDFLARE_ENV=local node node_modules/vite/bin/vite.js dev --port 5174
```

Details: `kalien-contract/README.md` (rehearsal overrides, including `XDG_CONFIG_HOME` for
separate keys), `worker/README.md` ("Local run"), `docs/OPERATIONS.md` (second node on one
machine).

### Tests

```bash
bun run check                                                       # types, lint, format
bun test tests/                                                     # Worker, browser, CLI preflight
(cd cli && bun test src)                                            # CLI
bun test shared/thruput/                                            # shared chain helpers
cargo test --release --manifest-path asteroids-core/Cargo.toml      # game core, golden, regressions
cargo test --release --manifest-path autopilot/Cargo.toml
kalien-contract/scripts/test.sh                                     # contracts: native + RV32 + vectors
bun run asteroids-core/parity/parity.ts                             # TS/Rust replay parity
```

### Deploy after a devnet wipe

```bash
kalien-contract/scripts/deploy-devnet.sh   # new contracts, relay lanes allowed, writes devnet.json
                                            # (the Worker refuses its fixtureSeedIds by itself)
bun worker/ops/relay-keys.ts --fund         # fund relay lanes below 50 HOG
bash worker/ops/deploy.sh --secrets         # checks, build from HEAD, D1 migrations, deploy, secrets
bun run smoke                               # smoke test against the deployed Worker
```

Step by step, with funding and secrets: [docs/OPERATIONS.md](docs/OPERATIONS.md#devnet-reset-after-a-wipe).

Copied tapes can earn the same reward under another key. Decision 2026-10-24: accepted for
devnet; options kept for a future mainnet-like deployment. See
[docs/games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md](docs/games/asteroids/04-TAPE-REUSE-AND-REPLAY-POLICY.md).

## Docs

- [docs/README.md](docs/README.md): documentation map.
- [docs/games/asteroids/](docs/games/asteroids/README.md): game rules, tape format, verification.
- [docs/thruput/](docs/thruput/PORT-PLAN.md): port plan, interfaces, and agent reports with
  measured gas, memory, and test results.
- [docs/archive/zk/](docs/archive/README.md): the earlier ZK (RISC Zero + Soroban) version.

## Notes

- Secrets live in `.dev.vars`, `.env`, `~/.config/thruput/keys/`, and
  `~/.config/kalien-thruput/` (never in git).
- Devnet can be wiped. Then the network hash and all addresses change; see
  [docs/OPERATIONS.md](docs/OPERATIONS.md#devnet-reset).
