# kt-client report

Agent: `kt-client`. Scope: `src/` (not `src/game/`), `index.html`, `public/`, `vite.config.ts`,
`.env.example`, browser deps in root `package.json`, and the `tests/src/` tests for those modules.

## Status

**STOP point A reached.** The wallet and submit flow works against the local Worker (port 5174),
which talks to the live devnet contracts. A browser run confirmed on devnet:

| Field | Value |
|---|---|
| Player | `0x43333af76cc66f2150121156256b529cb1523baf9a048e8b2eab21fee2549b4f` (browser key) |
| Run id | `15ed2dedb1fd07a2b3a7c1d2c2b346f99fec0add7bb5aec9d294101f551ef7c2` |
| Seed id | 2987990 (seed `0xA2994B5B`) |
| Score / previous best | 1,630 / 0 |
| Minted | `16300000000` base units = 1,630 KALIEN |
| Tx | `0xf08b93a9622a39357a1b9ca383cadecb5b3f8e5b46ca2168019b58efa870a985` |

Status went `submitting` → `confirmed` in about 6 s. The header balance changed from 0 to
1,630 KALIEN (ERC20 view on devnet). The tape replays from `/api/runs/:id/tape`.

Not done yet: tests against the deployed Worker (`kalien-thruput.sdf-ecosystem.workers.dev`).

## Commits

| Commit | Content |
|---|---|
| `fa72241` | Drop `@simplewebauthn/browser`; add `typecheck:cli` to `typecheck` (lead request) |
| `161632a` | Main port: key wallet, run submission, run history, leaderboard/profile, removals |
| `94dac08` | `KALIEN_API_PROXY` for `vite dev`; Tailwind scans only `index.html` and `src` |
| `70aadef` | Best score and balance through `shared/thruput/bindings`; `KALIEN_RPC_PROXY` |

Note: commit `581dbfa` (core agent) swept in two of my staged renames
(`useEndlessSeedScoreGate` → `useSeedScoreGate`, `StepIndicator` move). The content landed in
`161632a`. No harm.

## What changed

### Wallet (`src/wallet/keyWallet.ts`, `src/hooks/useWallet.ts`)

- The browser makes a 32-byte Ed25519 seed on the first visit and keeps it in `localStorage`
  (`kalien:wallet:v1`). There is no connect step: one tap on "Submit Score" signs and sends.
- Address = nonce-0 pubkey account. It uses `derivePubkeyAccountAddress` from
  `@thruputchain/client@0.18.0`. Tests check that it equals `createPubkeyAccount().address` and
  the `addresses` vectors in `shared/thruput/claim-vectors.json`.
- Signing uses `PrivateKeySigner` from the client.
- Backup export: a string `kalien-key-v1:<64 hex secret>:<8 hex sha256 checksum>` (show + copy)
  or a JSON file (`format`, `address`, `pubkey`, `secretKey`, `createdAt`). Warnings say the
  backup is the secret key.
- Import accepts: the backup string (checksum checked), the JSON file (address checked), the
  `kalien` CLI key file (`version`, `secretKey`), and a bare 32-byte hex seed with or without
  `0x` (`kalien key export`). Import needs a confirm checkbox, because it replaces the key.
- Other tabs follow key changes (`storage` event). If storage is blocked, the key lives in memory
  and the UI warns.
- Removed: `smart-account-kit` code, passkey UI (`WalletConnect`), sign out, KALE/KALIEN
  transfer and Soroswap swap. Transfers need the player to pay gas in HOG, which conflicts with
  "no faucet". The Wallet page now shows the address, explorer link, balance, backup, and import.

### Submit flow (`src/hooks/useRunSubmission.ts`, `src/runs/api.ts`, `src/components/runs/`)

- After a run: serialize the tape, `claimMessage` (now a thin wrapper over
  `shared/thruput/claim.ts`), sign the 32-byte digest, `POST /api/runs?pubkey=&seed_id=&sig=`
  (lowercase hex, no `0x`), then poll `/api/runs/:id` every 2 s until a terminal status.
- `RunProgress` shows queued / submitting / confirmed / rejected / failed, score, previous best,
  KALIEN minted, and the tx with an explorer link. Steps are Play → Score → Submit → Earn.
- The best-score gate now applies in manual mode too: the button says "Not a new best" when the
  score does not beat the best for that seed. Endless mode keeps its auto-submit gate. The best
  comes from `KalienScore.v0_1.bestScore` (shared binding); if the RPC view fails, it falls back
  to `GET /api/runs?player=`.
- Run history at `/runs` replaces `/proofs` and `/proofs/:address` (both redirect). It lists
  status, score, frames, minted, seed, tx, time, replay, and tape download.
- Removed: `src/proof/`, `src/components/proof*/`, `useProofJob`, `src/chain/`.

### Config, seed, balance

- `/api/config` is read once per page load (`src/thruput/config.ts`). No `VITE_*` variables
  are needed any more; `.env.example` and `src/vite-env.d.ts` say so.
- `/api/seed/current` reads `{ seedId, seed, secondsLeft }`. A `null` seed or a `seedId` that does
  not match the local clock retries with backoff (the old `POST /api/seed/refresh` is gone).
- KALIEN balance: `ERC20.v0_1.getBalanceOf` from `shared/thruput/bindings/kalien-token.ts`,
  refreshed on confirm and every 30 s. The client pins the network hash from `/api/config`.

### Leaderboard, player page, profile

- `src/leaderboard/api.ts` parses the v0 Worker shapes (`playerAddress`, `runId`, `mintedDelta`
  as base units, `closedAt`, `latestBlock`) and still reads old names.
- Tables show a Transaction column instead of the old Claim status.
- Profile edit signs `["kalien-profile-v1", networkHash, address, timestamp, username, linkUrl]`
  joined with `\n` (same as `worker/profile.ts`; a test compares the bytes) and sends
  `{ pubkey, username, linkUrl, timestamp, signature }`.

### Other

- `index.html`, `useDocumentTitle`, `robots.txt`, `sitemap.xml`: Thruput text and the
  `kalien-thruput.sdf-ecosystem.workers.dev` URL. Removed `public/_headers` (only `stellar.toml`).
- `vite.config.ts`: `KALIEN_API_PROXY=<url>` skips the Cloudflare plugin and proxies `/api`;
  `KALIEN_RPC_PROXY=<url>` proxies `/rpc` to a local node (local nodes send no CORS headers).
- `src/index.css`: `@import "tailwindcss" source(none)` + `@source` for `index.html` and `src`.
- Root deps: removed `@simplewebauthn/browser`; added `@noble/hashes` `2.2.0` (same as
  `@thruputchain/protocol`'s pin; `shared/thruput/claim.ts` imports it).

## Tests and results

| Command | Result |
|---|---|
| `bun run typecheck:app` | 0 errors |
| `bun run typecheck:node` | 0 errors |
| `node_modules/.bin/oxlint src` | 0 warnings, 0 errors |
| `node_modules/.bin/oxfmt src --check` | clean |
| `bun test tests/src` | 45 pass, 0 fail (9 files) |

New tests: `tests/src/key-wallet.test.ts` (address vs `createPubkeyAccount` and shared vectors,
sign/verify, backup round trips, checksum typo, CLI formats, bad input), `claim.test.ts` (shared
claim vectors), `runs-api.test.ts` (parsing, request shape, errors, list), `leaderboard-api.test.ts`
(parsing, signed profile bytes equal `worker/profile.ts`). Removed the proof/smart-account/swap/
SAC tests. Renamed the gate test.

Browser runs (`agent-browser`, Vite on 5173):

1. Mock API (a temporary Bun server that checks the claim signature with the shared helper and
   the profile signature with `worker/profile.ts`): key made on first visit; autopilot run of
   2,640; submit → queued → submitting → confirmed with previous best and minted; error path
   (mock 500) shows the error and keeps the Submit button; `/proofs` redirects to `/runs`;
   leaderboard row; replay of the stored tape; signed profile save; backup export, import in a
   fresh browser profile (same address, run history follows, survives reload); second weaker
   run on the same seed shows "Not a new best".
2. Local Worker on 5174 (devnet contracts): the confirmed run in the table above, balance view,
   leaderboard (3 entries), tape download (958 B) and replay.

Dev commands:

```bash
KALIEN_API_PROXY=http://127.0.0.1:5174 node node_modules/vite/bin/vite.js dev --port 5173
# local node: add KALIEN_RPC_PROXY=http://127.0.0.1:9745
```

## Decisions

- Make the key on first visit, not on first submit. The plan says "made on first visit", and it
  removes every wallet step before play.
- No KALIEN transfer UI: it needs HOG for gas. A relayed transfer would need a new Worker API.
- The gate disables Submit when the known best is not beaten. The Worker and contract still
  reject `not_improved`, so the gate is only UX.
- `src/thruput/claim.ts` stays as an async wrapper so call sites do not change if the shared
  helper changes.

## Open issues and requests

- **kt-worker:** `GET /api/runs?player=` has no `offset`; `/runs` shows at most 25 rows with no
  next page. Please add `offset` + `total`/`nextOffset` if you want paging.
- **kt-worker:** optional, a small `GET /api/balance/:address` would let the header balance work
  where the RPC is not reachable from the browser. Not needed for devnet (CORS is fine).
- **kt-contract:** I use `shared/thruput/bindings/*` directly. I will switch to the new shared
  read helpers when they land.
- **coordinator:** `bun run lint` (`oxlint src worker`) fails today on `worker/` warnings/errors
  from the worker rewrite, not on `src/`.
- Next: test the deployed Worker, endless mode on devnet, and a mobile-width pass.
