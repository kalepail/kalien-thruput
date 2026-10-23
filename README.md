![Kalien](public/kalien-meta-2.jpg)
# Kalien

Kalien is a deterministic Asteroids game on the **Thruput devnet**. You play in the browser. The
game records your inputs on a tape. A Thruput smart contract replays the tape on chain with the
Rust game core, checks the score, keeps your best score per 10-minute seed epoch, and mints
KALIEN for each improvement.

There is no zero-knowledge proof and no wallet setup. The browser makes an Ed25519 key on your
first visit. A relay pays the transaction, and your signature binds the run to your address.

- App (TODO: not deployed yet): `https://kalien-thruput.sdf-ecosystem.workers.dev`
- Chain: Thruput devnet, RPC `https://rpc.thruput.network`, explorer
  `https://explorer.thruput.network/`
- Contract addresses: `shared/thruput/deployments/devnet.json`

## Components

| Path | What it is |
|---|---|
| [`asteroids-core/`](asteroids-core/README.md) | Rust game core and strict tape verifier (`no_std`, used on chain) |
| [`src/game/`](src/game/) | TypeScript twin of the game core (browser play, Worker pre-check) |
| [`kalien-contract/`](kalien-contract/README.md) | Thruput contracts: `kalien_score` (on-chain replay, best scores, mint) and `kalien_token` (KALIEN) |
| [`shared/thruput/`](shared/thruput/README.md) | Claim digest helper, generated TS bindings, devnet deployment record |
| [`worker/`](worker/README.md) | Cloudflare Worker: API, relay Durable Object, seed cron, leaderboard indexer |
| [`src/`](src/) | React client: key wallet, play, submit, run history, leaderboard, replay |
| [`cli/`](cli/README.md) | `kalien` terminal client: key file, bots, submit, status |
| [`autopilot/`](autopilot/README.md) | Rust bot lab for tape generation and benchmarks |
| [`scripts/`](scripts/) | Tape tools and end-to-end scripts |
| [`test-fixtures/`](test-fixtures/README.md) | Known tapes used by every test layer |

How the parts fit: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

```bash
export GH_NPM_TOKEN="$(gh auth token)"   # @thruputchain packages come from GitHub Packages
bun install
bun run dev                              # browser app + Worker
```

Checks:

```bash
bun run check                                                   # types, lint, format
cargo test --release --manifest-path asteroids-core/Cargo.toml  # with CARGO_HOME=$HOME/.cargo-thruput
bun run asteroids-core/parity/parity.ts                         # TS/Rust replay parity
```

Contracts, Worker deploy, devnet reset, and every test command: [docs/OPERATIONS.md](docs/OPERATIONS.md).

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
