# Cloudflare Worker

API, relay, and leaderboard for Kalien on the Thruput devnet. No ZK: the
`kalien_score` contract replays each tape on-chain.

## Responsibilities

- Checks a submitted run (tape header, CRC, size, claim signature, active
  seed, TS replay of the score, best score, tape hash) before it spends gas.
- Stores tapes in R2 (`TAPES`, key `tapes/<runId>.tape`). `runId` = `sha256(tape)` hex.
- Relays runs with `RelayDO`: one Durable Object per relay key. It signs
  `submit_score`, journals the signed bytes before broadcast, polls receipts,
  and maps failures to `rejected` with the contract error.
- Touches the seed epoch every 10 minutes (`ensure_current_seed`).
- Indexes `ScoreSubmitted` events into D1 every minute, and writes the row
  right after a confirmed run.
- Serves the leaderboard (10m/day/all), player pages, and Ed25519-signed
  profiles.

## Layout

- `index.ts`: Hono app, crons, `RelayDO` export.
- `api/`: routes (`routes.ts` config/seed/health/admin, `runs.ts`, `leaderboard.ts`).
- `relay/`: run journal (`store.ts`), state machine (`engine.ts`), service
  shared by the Durable Object and tests (`service.ts`), gas policy.
- `durable/relay.ts`: the Durable Object wrapper.
- `chain/`: Thruput client, relay wallet, `kalien_score` adapter over
  `shared/thruput/bindings/kalien-score.ts`.
- `leaderboard/`: D1 store, event indexer, cron entry.
- `migrations/`: D1 schema (`wrangler d1 migrations apply kalien-thruput-leaderboard`).

## Relay safety

- A signed transaction goes into the journal before broadcast.
- The same signed bytes may be broadcast again (same hash).
- A run gets a new transaction only when the old one is dead: tip past its
  expiry height plus a margin, no receipt, and `is_claimed(tape_hash)` false.
- The contract rejects a claimed tape hash, so a run never mints twice.

## Local run

```bash
thruput node --port 9745 --key <key> --data-dir <dir>   # or use devnet
cp .dev.vars.example .dev.vars                            # fill in
WRANGLER_LOG_PATH=.wrangler/logs npx wrangler d1 migrations apply kalien-thruput-leaderboard --local
node node_modules/vite/bin/vite.js dev --port 5174
bun tests/worker/live/submit-runs.ts --api http://127.0.0.1:5174 <tape>:<seedId> ...
```

## Verification

```bash
bun run typecheck:worker
bun test tests/worker
```
