# Kalien on Thruput devnet: port plan

Branch `thruput-devnet`, worktree `/Users/kalepail/Desktop/Web/Soroban/kalien-thruput`.
Final home: private repo `kalepail/kalien-thruput`, Worker `kalien-thruput` at
`https://kalien-thruput.sdf-ecosystem.workers.dev` (Cloudflare account "Ecosystem - Stellar",
`ba55b7ae9acfb3ed152103e3497c0752`).

## Goal

Run Kalien on the Thruput devnet with no ZK. A Thruput contract replays the tape on-chain with
the Rust `asteroids-core` simulation, checks the claimed score, records the best score per player
per seed epoch, and mints KALIEN. Everything else (leaderboard, profiles, tape storage and replay,
CLI, autopilot) stays unless it only existed for proving.

Remove: RISC Zero guest/host/api-server, Boundless, Vast.ai, proof queues, the proof coordinator's
ZK job machinery, OpenZeppelin Channels relay, smart-account-kit passkeys, Soroswap KALE swap,
Soroban contract, Stellar mainnet env, SEP-1 `stellar.toml`.

## Thruput facts that shape the design

- Docs authority: `/Users/kalepail/Desktop/groundhog/developers-site/src/content/docs/`.
  Agent skill: `~/.agents/skills/thruput/SKILL.md` (still says `@groundhogchain`; the packages
  are now `@thruputchain/*`). Workspace notes: `/Users/kalepail/Desktop/groundhog/CLAUDE.md`.
- Contracts: Rust `no_std`, RV32IM, no floats, `sdk =0.51.1` from registry `thruput`.
  Guest memory is **64 KiB total** (stack + statics + heap + calldata). The allocator is a
  **bump allocator that never frees**. So the replay must not allocate per frame and must not
  unpack the tape into a one-byte-per-frame `Vec` (36 KB). Read nibbles from the packed tape.
- Calldata is copied whole into guest memory. A max tape is 18,024 bytes, which should fit.
  `Bytestring` storage items are capped at 4,096 bytes.
- Gas is not burned. The sender must hold free HOG >= declared gas limit (1 gas = 1 base unit,
  1 HOG = 1e7 base units). `maxViewGas` is 10M, so a full replay cannot be previewed by `view`.
- No randomness syscall. There is `GetSourceTransactionHash`, `GetNetworkHash`, block timestamp,
  SHA-256, and `verify_signature_ed25519`.
- No passkeys. Accounts are Ed25519 pubkey accounts: address = derived from
  `PubkeyAccountPreimage { pubkey, nonce }`; an undeployed pubkey account falls back to the
  network DefaultWallet.
- Contracts are immutable. Redeploy to change. Devnet gets wiped: network hash, addresses and
  wallets change. Read the network hash from `groundhog_networkInfo`; never hard-code it in code
  paths that cannot be updated by config.
- Devnet RPC `https://rpc.thruput.network` (CORS ok, Worker fetch ok). Explorer
  `https://explorer.thruput.network/`. Faucet: `thruput airdrop`, `wallet.requestAirdrop()`,
  `https://thruput-faucet.up.railway.app` (about 10 HOG / address / 24 h).
- TS client: pin `@thruputchain/client@0.18.0` + `@thruputchain/protocol@0.15.0` (devnet wire
  format 11.x). Do **not** upgrade to 0.20+. Reference usage: `/Users/kalepail/Desktop/groundhog/thruput-spray-pray/worker/`
  (server-side signing in Durable Objects) and `/Users/kalepail/Desktop/groundhog/groundhog-wall/public-site/funding-service.mjs`.

## Environment rules (every agent)

- **Cargo:** always run cargo / `thruput build` / `thruput test` / `thruput deploy` with
  `CARGO_HOME=/Users/kalepail/.cargo-thruput`. The global `~/.cargo` names the registry
  `groundhog`, which clashes with `thruput`. Do not edit `~/.cargo`.
- **npm/bun:** `export GH_NPM_TOKEN="$(gh auth token)"` before `bun install`/`bun add`. The repo
  `.npmrc` maps `@thruputchain` to GitHub Packages. Root deps are already installed.
- CLI: `thruput 0.29.2` matches devnet. Do not install another version.
- Keys: devnet only. Keep secrets out of git (`.dev.vars`, `.env`, `~/.config/thruput`). Never
  print secret keys in logs or commit them.
- **Git:** all agents share this one worktree and branch. Commit often, but only your own paths:
  `git add <your paths>` then `git commit`. Never `git add -A`, `git stash`, `git reset`,
  `git checkout -- <others' files>`, `git rebase`, or `git push`. If `index.lock` exists, wait a
  few seconds and retry. Use Conventional Commit messages, e.g. `feat(contract): ...`.
- Do not edit files that another agent owns. If you need a change there, say so in your final
  report and the coordinator relays it.
- Ports: client agent Vite 5173; worker agent Vite/wrangler 5174 and 8787; local Thruput nodes:
  core agent 9545, contract agent 9645 (or whatever `--port` the CLI allows; avoid collisions).
- Write in ASD-STE100 Simplified Technical English in docs and reports (short active sentences).

## Ownership

| Agent | Owns |
|---|---|
| `core` | `kalien-verifier/asteroids-core/` (move to `asteroids-core/` at repo root), `autopilot/` Cargo wiring, removal of the rest of `kalien-verifier/`, `src/game/` only for parity fixes |
| `contract` | `kalien-contract/` (rewrite as Thruput contracts: score + KALIEN token), `shared/thruput/` (bindings, claim-message helper, deployments), devnet keys and deploys |
| `worker` | `worker/`, `wrangler.jsonc`, `worker-configuration.d.ts`, `.dev.vars.example`, D1 migrations |
| `client` | `src/` (except `src/game/`), `index.html`, `public/`, `vite.config.ts`, `.env.example`, root `package.json` deps for the browser |
| `cli` | `cli/`, `scripts/`, `benchmarks/`, `autopilot/` submit paths (not its Cargo deps), `test-fixtures/` cleanup |

Root `README.md` and `docs/`: the coordinator merges at the end; each agent may add
`docs/thruput/<agent>.md`.

## Interface v0 (the `contract` agent owns it and may change it; record changes here)

### Score contract `kalien_score`

- Init: `initialize(admin, token)`; one-time, atomic with deploy.
- `current_seed() -> { seed_id: u32, seed: u32 }` — `seed_id = block_timestamp / 600`. The seed
  for an epoch is created the first time anything touches it, from
  `sha256(source_tx_hash || seed_id)` (first 4 bytes, LE; 0 maps to `0xDEADBEEF`), and stored.
  The Worker cron touches it every 10 minutes. Active window: the current epoch and the previous
  143 epochs (24 h), as today.
- `submit_score(player_pubkey: [u8;32], seed_id: u32, tape: bytes, signature: [u8;64]) -> u32`
  1. Check not paused, seed active, tape seed equals stored seed for `seed_id`.
  2. Verify `signature` (Ed25519, `player_pubkey`) over the claim message:
     `sha256("kalien-claim-v1" || network_hash || score_contract_address || seed_id u32 LE || sha256(tape))`.
     This binds the run to the player; the relay that submits cannot redirect it.
  3. Replay the tape (strict rules, max 36,000 frames). Require replayed frame count and score to
     equal the tape header/footer.
  4. Reject score 0, reject not-improved vs `best(player_address, seed_id)`.
  5. Store the new best, mint `(new - prev) * 1e7` KALIEN to the player address (the pubkey account
     address derived from `player_pubkey`, nonce per the chain's default), emit `ScoreSubmitted`.
- `best_score(player: address, seed_id: u32) -> u32`, `is_claimed(tape_hash) -> bool` (dedupe).
- Event `ScoreSubmitted { #[topic] player, #[topic] seed_id, seed, frame_count, final_score,
  previous_best, new_best, minted_delta, tape_hash }`.
- Admin: `set_paused`, `set_admin`.

If one transaction cannot replay a 36,000-frame tape within practical gas or memory, the `contract`
agent designs a chunked replay (sim state checkpointed in storage between transactions) and
updates this section. The Worker hides the number of transactions from the browser.

### KALIEN token

ERC20-style Thruput contract (see `/Users/kalepail/Desktop/groundhog/groundhog-examples/contracts/erc20`),
7 decimals, admin = score contract, only the score contract mints.

### Shared TS (`shared/thruput/`, owned by `contract`)

- `deployments/devnet.json`: `{ networkHash, rpcUrl, scoreContract, tokenContract, deployedAt }`.
- Generated bindings (`thruput codegen ts`).
- `claim.ts`: `claimMessage({networkHash, scoreContract, seedId, tape}) -> Uint8Array` and
  `pubkeyAccountAddress(pubkey) -> string`. Used by browser, Worker, and CLI. Must match the
  contract byte for byte (test vectors in `shared/thruput/claim.test.ts`).

### Worker API v0 (owned by `worker`)

- `GET /api/config` → `{ networkHash, rpcUrl, scoreContract, tokenContract, explorerUrl }`
- `GET /api/seed/current` → `{ seedId, seed }`
- `POST /api/runs?pubkey=<hex>&seed_id=<n>&sig=<hex>` with raw tape body →
  `{ runId, status }`. The Worker checks header/CRC, does a TS replay pre-check of the score,
  checks the signature and `best_score`, stores the tape in R2, then a relay wallet (Durable
  Object, holds HOG) submits the transaction.
- `GET /api/runs/:id` → `{ runId, status: queued|submitting|confirmed|rejected|failed, txHash,
  score, previousBest, minted, error }`; `GET /api/runs?player=<address>`
- `GET /api/runs/:id/tape` → raw tape
- Leaderboard: `GET /api/leaderboard?window=10m|day|all`, `GET /api/leaderboard/player/:address`,
  profile update signed by the player's Ed25519 key (no passkeys, no smart-account indexer).
- Leaderboard data: index `ScoreSubmitted` events from Thruput into D1 (cron).

### Browser wallet (owned by `client`)

Ed25519 key made in the browser on first visit, kept in `localStorage`. Feels like the passkey
flow: one tap, no extension, no faucet step. Add export (copy/download a backup string) and
import, so a player can move the key to another browser. Show the address, KALIEN balance, and
explorer link.

## Test assets

- `test-fixtures/*.tape` (known seed/frames/score; see its README).
- `autopilot/fixtures/public/kalien-911140-seed1598125870.tape`: 36,000 frames, score 911,140 —
  worst case for gas.
- `checkpoints/*.tape`, `generated-tapes/`.

## Definition of done

1. Contract replays all fixture tapes on RV32 (`thruput test`) with exact scores, and on devnet.
2. Gas and memory measured and recorded for short, medium, 36k-frame tapes.
3. Browser: play a game, submit, see the confirmed score, KALIEN balance, leaderboard entry, and
   the replay, on `kalien-thruput.sdf-ecosystem.workers.dev`.
4. CLI and autopilot submit runs to the new API.
5. `bun run check` passes; Rust tests pass; no ZK code left.
