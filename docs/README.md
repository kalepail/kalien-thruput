# Documentation Map

Kalien runs on the Thruput devnet. A smart contract replays each game tape on chain and mints
KALIEN for new best scores. There is no zero-knowledge proof in this version.

## Start here

- [ARCHITECTURE.md](ARCHITECTURE.md): components, game core and tape, contracts and gas,
  Worker relay lanes and API, key wallet, leaderboard, CLI, devnet operations, trust model, and
  the copycat decision.
- [OPERATIONS.md](OPERATIONS.md): versions, setup, tests, deploy, devnet reset after a wipe,
  funding, secrets.
- [games/asteroids/](games/asteroids/README.md): game rules, tape format, verification, and the
  tape reuse policy.

## Port reports

`thruput/` holds the port plan and one report per port agent, with measured numbers and the
exact test commands:

- [thruput/PORT-PLAN.md](thruput/PORT-PLAN.md): goal, the 2026-10-24 devnet upgrade, environment
  rules, and the contract and Worker interfaces.
- [Thruput JSON-RPC reference](https://www.thruput.network/docs/reference/json-rpc-api/): the public wire-14
  JSON-RPC reference (follow it for every RPC call).
- [thruput/kt-core.md](thruput/kt-core.md): game core, gas and memory, TS/Rust parity.
- [thruput/kt-contract.md](thruput/kt-contract.md): contracts and devnet deployment.
- [thruput/kt-worker.md](thruput/kt-worker.md): Worker, relay, leaderboard indexer.
- [thruput/kt-client.md](thruput/kt-client.md): browser key wallet and submit flow.
- [thruput/kt-cli.md](thruput/kt-cli.md): CLI, scripts, fixtures.

## Component READMEs

`asteroids-core/README.md`, `kalien-contract/README.md`, `shared/thruput/README.md`,
`worker/README.md`, `cli/README.md`, `autopilot/README.md`, `test-fixtures/README.md`.

## Archive

[archive/](archive/README.md) keeps superseded docs for history. `archive/zk/` has the ZK-era
material: RISC Zero, Boundless, Vast.ai, the Soroban contract, Stellar event sourcing, and the
ZK reference library. Archive docs do not describe the current system.

## Editing policy

- Keep these docs short and matched to the code. When code and docs disagree, fix the docs.
- Move dated or superseded material to `archive/` instead of deleting it.
- Mark facts that are not final as `TODO` with an owner.
