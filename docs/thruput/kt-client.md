# kt-client report

Agent: `kt-client`. Scope: `src/` (not `src/game/`), `index.html`, `public/`, `vite.config.ts`,
`.env.example`, browser deps in root `package.json`, and the `tests/src/` tests for those modules.

## Round 7 (2026-10-24): review items 14–17, deployed

**Status: fixed, deployed, verified live.** Commit `0e9b175`; Worker version
`082aa0c7-2fe1-4d7c-910c-7691584d4626` (built by `worker/ops/deploy.sh` from clean HEAD, proxy
variables unset; its checks passed: 84 worker tests, lint, format). `review.md` marks 14–17 fixed.

| Item | Fix |
|---|---|
| 14 stale config after a reset | `src/thruput/config.ts`: `refreshThruputConfig()` re-reads `/api/config`; a new network hash or contract notifies subscribers. `NetworkChangeNotice` checks on focus/visibility (at most every 30 s) and every 5 min, and shows "The Thruput devnet was reset…". Subscribers: the client (new pinned client), `useSeed` (clears the seed cache), `useTokenBalance` (re-reads), `useThruputConfig`. A submit refused with `bad_signature` refreshes the config and, if it changed, re-signs once (the POST was refused, no chain write). |
| 15 polling | `nextPollStep`: stop on 404 ("the Worker has no record of this run…"), stop after 15 min ("may still confirm; check My Runs"), errors back off 5 s, 10 s, 20 s, 40 s, 60 s. A stopped run is no longer shown as busy. |
| 16 endless gate | `src/runs/endlessGate.ts` `decideEndlessSubmit`: the confirmed chain best decides; a pending run blocks a weaker one only while it is queued/submitting (or still posting); rejected, failed or unknown pending runs do not block; a best is recorded only on confirmation. |
| 17 proxies + CSP | `vite.config.ts` `resolveDevProxies`: `KALIEN_API_PROXY`/`KALIEN_RPC_PROXY` work only for `vite dev`. `public/_headers` (`/*`): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://rpc.thruput.network; media-src 'self' https://api.smol.xyz; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. `media-src` covers the game music (`src/game/AudioSystem.ts`). If `/api/config` ever names another RPC, update `connect-src`. |

Tests: `tests/src/review-low-findings.test.ts` (11 cases: config change and notify; 404 stop,
backoff, time limit; 6 gate cases; proxies ignored in a build; CSP directives, incl. the
`devnet.json` RPC origin). `bun test tests/src`: 78 pass, 0 fail. Typecheck (app, node), lint,
format clean.

Checks before deploy: a build with `KALIEN_API_PROXY` and `KALIEN_RPC_PROXY` set contains neither
the `/rpc` override nor the proxy host, and still includes the Worker. A production build served
with the `_headers` rules (Bun test server, `/api` proxied to the live Worker) ran the game,
wallet balance, `/runs`, leaderboard, player page, `/tx`, and replay with 0 CSP violations (a
`securitypolicyviolation` recorder; a deliberate fetch to another origin was caught, so the
recorder works). A changed `/api/config` showed the reset notice.

Live (`https://kalien-thruput.sdf-ecosystem.workers.dev`, fresh key): CSP header on `/`,
`/replay/*`, `/tx/*`, `/wallet`, `/assets/`; a run of 1,430 confirmed in 6 s (+1,430 KALIEN, tx
`6Diiedkj…KTfXk5B3`, block 29,887); tx page, replay, wallet (1,430 KALIEN), `/runs`, leaderboard
all work; 0 CSP violations, 0 CSP console lines.

Screenshots: `/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/c5af48fa-61eb-44a6-b03d-e26eb2b4d2c5/scratchpad/live1417/` (`01-confirmed.png`, `02-tx.png`, `03-replay.png`, `04-wallet.png`,
`05-leaderboard.png`); `/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/c5af48fa-61eb-44a6-b03d-e26eb2b4d2c5/scratchpad/csp/` (`tx.png`, `replay.png`, `network-change-notice.png`).

Processes: the CSP test server and all agent-browser sessions are stopped.

## Round 6 (2026-10-24): review items 3 and 6

**Status: fixed and tested; not deployed.** Commit `b33ab18`. I did not run `worker/ops/deploy.sh`:
the lead asked me to deploy only after kt-worker reports its deploy is done. The fix ships with
the next Worker deploy (kt-worker, or me on the lead's go).

### Item 3: key import accepted public values as a secret

- `parseBackup(input, { current })` rejects the current address or public key in every form
  (base58, `0x` hex, bare hex, `C…` StrKey of the address, base58 and `G…` StrKey of the public
  key). It also rejects a seed that equals its own address or public key. Message: "this is an
  address or public key, not a secret key. Paste the backup string, the S... secret, or the
  backup file".
- Checksummed or self-checking formats import directly: the backup string (sha256 checksum), the
  `S…` StrKey (CRC), the browser backup JSON and the CLI key JSON (address check).
- A bare 32-byte hex or base58 value is `checked: false`. The Import card then shows "This is a
  bare 32-byte key with no checksum. It gives this address: …" and imports only after "Import
  This Key" (the backup checkbox must also be ticked). Editing the input clears the prompt.
- Tests (`tests/src/key-wallet.test.ts`): 7 rejection cases (one per form), the real secret still
  imports, checked/raw flags per format, and a pasted address without a current key stays raw and
  gives a different address.
- Browser (local Vite → deployed API): own address → error, address unchanged; own `G…` key →
  error; random raw hex → confirm panel, address unchanged; after confirm → imported.

### Item 6: seed depended on the local clock

- `src/hooks/useSeed.ts` keeps `serverOffsetMs` (Worker time minus local time). Each
  `/api/seed/current` answer gives the Worker time as `((seedId + 1) * 600 - secondsLeft) s`
  (+0.5 s); the offset changes only when a sample differs by more than 1.5 s. All epoch math
  (current `seed_id`, countdown, epoch roll-over) uses the corrected clock, and the server
  `seedId` is trusted even without `secondsLeft`.
- Tests (`tests/src/use-seed.test.ts`): local clocks −25…+25 min off map to the server epoch
  within 1 s; jitter handling; the real store loads the seed with `Date.now` 15 min behind.
- Browser: an init script set the page clock 17 min behind (page 16:24, real 16:41 UTC). The
  seed loaded (`0xB6B5426E`, the server's), the countdown matched real time (8:14 left), and a run
  submitted and confirmed (1,160 points, +1,160 KALIEN, tx `Dewz1ruA…bRytAFXD`).

Checks: typecheck, lint, format clean for `src`; `bun test tests/src` 67 pass, 0 fail.

Screenshots (`/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/c5af48fa-61eb-44a6-b03d-e26eb2b4d2c5/scratchpad/review/`): `import-raw-confirm.png`, `skew-17min-playing.png`,
`skew-17min-confirmed.png`.

Processes: local Vite and both agent-browser sessions are stopped.

## Round 5 (2026-10-24): in-app transaction view

**Status: done, deployed, tested on the deployed site.** Commit `f216ada`. I deployed with
`worker/ops/deploy.sh` (no `worker/` change; its checks passed: 74 worker tests, lint, format).
Worker version `63c1be6f-f206-4165-82ca-679f00e9d0a5`.

Why: `explorer.thruput.network` answers 401 for players, so every tx/address link was a dead end.

What changed:

- `/tx/:hash` (`src/components/runs/TxPage.tsx`, `src/thruput/tx.ts`): reads
  `getTransactionStatus` and `getTransactionReceipt` in parallel, then the block time. It shows the
  lifecycle status, `execution.result`, block height, time, gas used, the event count, and for a
  Kalien run the decoded `ScoreSubmitted` event (player, seed, seed id, frames, score, previous
  best, new best, KALIEN minted, relay) with Replay (`/replay/<tape hash>`) and Player page links.
  A rejected run shows the contract error name. It polls every 3 s while the status is pending or
  the receipt is not indexed. With no receipt it says that `unknown`/`dropped` does not prove that
  the transaction never ran (wire-14 rule). Decoding uses `decodeSubmitReceipt` and `getBlockTime`
  from `shared/thruput/kalien.ts`.
- Links: `TxLink` opens `/tx/:hash` first, with a small explorer icon ("Explorer (team access)").
  `AddressLinks` opens the player page, with a secondary "Explorer (team access)" link (header
  menu, Wallet page, player card). `/address/:a` redirects to `/leaderboard/:a`.
- `src/thruput/client.ts` now uses the shared `connectKalien`, `getBestScore`, `getKalienBalance`.
- Page subtitles wrap long hashes on phones.

Tests (deployed site, fresh key):

| Check | Result |
|---|---|
| New run → confirmed card | 1,330 points; card links `/tx/J9C2DixjFjbmHmaQwxCWXq8hTm4HdQenVq6B73s9QGtR` + explorer icon |
| `/tx/<hash>` | committed, execution return, block 28,481, 14 s ago, gas 3,052,889, 2 events; run: player `FzrDTWaz…oP7hv`, score 1,330, previous best 0, +1,330 KALIEN, 1,839 frames, seed `0x2361197D` |
| Replay from the tx page | `/replay/f0174e6e…` plays |
| `/address/<player>` | Redirects to the player page; "Explorer (team access)" points at `/address/<base58>` |
| `/runs` and leaderboard tx links | `/tx/<base58>` first, explorer second |
| Unknown hash (`1111…1111`) | status unknown, "does not prove the transaction never ran" |
| Bad hash (`/tx/not-a-hash`) | "This is not a transaction hash" |
| 375 px | 0 px horizontal overflow; hash wraps |
| Old run `4J5JPfWX…` (local Vite proxied to the deployed API) | block 17,863, gas 3,616,081, run 1,880, Replay `33d2553a…` |

Screenshots (`/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/c5af48fa-61eb-44a6-b03d-e26eb2b4d2c5/scratchpad/txview/`): `prod-01-confirmed.png`, `prod-02-tx-page.png`, `prod-03-player-page.png`,
`prod-04-replay.png`, `prod-05-tx-m375.png`, `local-tx.png`, `local-tx-unknown.png`,
`local-tx-m375b.png`.

Processes: the local Vite (5173) and all agent-browser sessions are stopped.

## Round 4 (2026-10-24): real pass on the deployed Worker

**Status: done, all green.** Site: `https://kalien-thruput.sdf-ecosystem.workers.dev` (Worker API
on wire-14 devnet `DWELtFbb…48uj`, v3 contracts: score `8fFcXcMD…ktjTT`, token `AZGTgZfo…Hk87`).
The deployed bundle is the current client (base58 address, `G…` key on the Wallet page).
No bug found in client paths; no code change this round.

| Check | Result |
|---|---|
| Fresh key | Made on first visit; base58 address, `G…` StrKey, balance view `0 KALIEN` from devnet |
| Manual-ish run (autopilot 15 s, then off) | 1,880 points, 2,446 frames; Submit → `submitting` → `confirmed` in about 6 s |
| Confirmed card | Score 1,880, previous best 0, `+1,880` KALIEN, tx `4J5JPfWX767wfi1jVWSRZ1ytuJbeRq4tzMcxUvQh8uAg` |
| On-chain check | `getTransactionReceipt`: block 17,863, `execution.result: "return"`, events present |
| Header balance | 0 → 1,880 KALIEN right after confirmation |
| `/runs` | Row `confirmed`, minted, seed, base58 tx link, replay, tape |
| Leaderboard | Entry #4 with base58 address and tx |
| Player page + profile | Saved "kt-client" + link; survives reload (Worker accepts the base58-signed message) |
| Replay | `/replay/<runId>` plays the stored tape (2,446 frames) |
| Endless mode | New key, 7 min: auto-submitted 15,820 (seed 2988096) and 34,210 (seed 2988097, "Any score" after the epoch change); both confirmed; balance 50,030 KALIEN; no reload |
| Export → import | Backup string from the endless key imported in a fresh browser profile: same address `8szzsYYZ…q23cMZSd`, same balance 50,030 KALIEN, same run history |
| Seed gate on import | A 1,930 run on the same seed shows "Not a new best … 34,210" (contract `best_score` view) |
| Mobile 375 / 768 | Game, wallet, `/runs`, leaderboard, player page, replay: 0 px horizontal overflow; result card is a full-screen sheet on phones |
| Explorer link format | `https://explorer.thruput.network/tx/<base58>` and `/address/<base58>`. This matches the explorer source (`src/app/api/search/route.ts`, `hashFromBase58`). The explorer returns **HTTP 401 on every path** (even `/`), so the page did not open (`04-explorer-tx.png` is blank) |

Screenshots (`/private/tmp/claude-501/-Users-kalepail-Desktop-Web-Soroban-kalien-thruput/c5af48fa-61eb-44a6-b03d-e26eb2b4d2c5/scratchpad/deployed/`):
`01-wallet-fresh.png`, `02-game-over.png`, `03-confirmed.png`, `05-runs.png`, `06-leaderboard.png`,
`07-player-profile.png`, `08-replay.png`, `09-endless-start.png`, `10-endless-running.png`,
`11-wallet-source.png`, `12-wallet-imported.png`, `m375-{game,wallet,runs,leaderboard,player,replay,result-card}.png`,
`m768-{game,wallet,runs,leaderboard,player,replay}.png`.

Notes:

- Closing an agent-browser session drops its browser profile, so the round-3 key is gone. Players
  are not affected; this is only the test harness.
- **Report to lead (not my paths):** `explorer.thruput.network` is behind auth (401). Players who
  click a tx or address link see an error until it is public.
- All processes I started are stopped: both agent-browser sessions closed; no Vite or mock server
  runs.

## Round 3 (2026-10-24): wire-14 migration, endless fix, mobile, cleanup

**Status: green on the mock API.** Typecheck, lint, format clean for `src`; `bun test tests/src`
46 pass, 0 fail. The real end-to-end pass waits for a migrated Worker and new devnet contracts
(the local Worker on 5174 is down; `devnet.json` still holds pre-upgrade hex ids).

| Commit | Content |
|---|---|
| `5f3318f` | Remove dead Stellar/ZK code and deps (`stellar.toml`, dialog/collapsible + Radix deps, `smart-account-kit(-bindings)`, `asteroids-score`, `playwright-core`, old field names) |
| `38267a9` | Mobile layouts (result card sheet, run cards, stat grids, title wrap); ignore `worker/` in proxy mode |
| `9c14ac3` + `0050f20` | Client 0.23 / wire-14 migration (see below). `0050f20` adds two new files that `git commit -- src` left out (untracked files are not committed by a pathspec) |
| `41a6101` | Clear message on a network reset; drop unused `with0x` |

### Endless-mode bug (root cause and fix)

The runs were lost in dev, not by the endless logic. I edited `src` files while endless mode ran.
Vite HMR re-ran `contexts/WalletContext.tsx` (it imports `useTokenBalance`, which imports the
edited `lib/format.ts`), so `createContext` made new context objects. Mounted consumers then threw
"useWalletState must be used inside <WalletProvider>", and the error boundary remounted the game,
which dropped the run. Fix: the context objects live in `contexts/walletContextObjects.ts` with
type-only imports, so HMR does not re-create them. Verified on the mock API with no edits in
flight: 6 minutes of endless mode auto-submitted 2 runs, both confirmed (5,020, then 18,260 with
previous best 5,020). No page reload.

### Wire-14 / client 0.23 migration

- Signer: `Ed25519Signer.fromSeed`. The 32-byte seed in `localStorage` (`kalien:wallet:v1`) is
  unchanged, so existing players keep their key. Their **address changes**: wire 14 derives the
  pubkey account from the public-key hash (`pubkeyAccountPreimage`). The browser derivation
  matches `createPubkeyAccount().address` and the base58 vectors in
  `shared/thruput/claim-vectors.json` (test passes).
- Identifiers: new `src/thruput/ids.ts`. Addresses, tx hashes, network hash and contract ids parse
  from base58 or legacy hex and always display and compare as base58 (case kept). `/api/config`,
  run records, leaderboard rows and explorer links go through it. Run ids stay hex (`sha256(tape)`).
- Views pass `address` (0.23 API). The client pins the base58 network hash; tested: connects to
  devnet `DWELtFbb…` at height 17,376.
- Claim: the wrapper passes bytes to `shared/thruput/claim.ts`, so it works with either id format.
- Profile message: identifiers in base58, case kept (no `toLowerCase`).
- Backups and import: accept the browser backup string, the JSON backup file (a pre-upgrade hex
  address is not checked; a base58 one must match), `kalien` CLI key files (base58 address checked
  with the same rule as `shared/thruput/claim.ts`), a bare seed as hex or base58, and a Stellar
  `S…` secret. Export adds "Show as Stellar Secret".
- StrKey: on Thruput, `G…` is the StrKey of the Ed25519 public key, `S…` of the seed, and `C…` is
  only the 32 address bytes (no network). So the natural secondary identity is the `G…` key. The
  Wallet page shows it under the base58 address ("The same Ed25519 key in Stellar G... form"),
  and the backup file carries `stellarPublicKey`. A Stellar user who imports the `S…` secret sees
  the same `G…`. Leaderboard search and `/leaderboard/:address` accept `C…` and hex, and redirect
  to the base58 URL.
- The browser never sends transactions; the JSON-RPC guide's admission/commitment rules apply to
  the Worker relay. Browser reads go through the SDK views only.

### Browser checks this round (agent-browser, mock API on base58)

Endless mode as above; profile save (signed base58 message); replay; export of the backup string
and the `S…` secret, each imported into a fresh profile → same address
`BGqA46RJ…QMG8BRC1` and same `G…` key; hex player URL → redirect to base58; search by `C…` StrKey
→ "Your Rank: #1"; Wallet page at 375 px, no horizontal overflow.

Mobile (`38267a9`): at 375 and 768 px every page has 0 px horizontal overflow (game, result card,
wallet, `/runs`, leaderboard, player page, replay, header menu).

### Requests

- **kt-worker:** `worker/profile.ts` lowercases `networkHash` and `playerAddress`. Base58 is
  case-sensitive, so please use the canonical base58 strings unchanged (the browser signs them
  unchanged). Accept base58 addresses in `normalizeAddress`, return base58 for addresses and tx
  hashes. Tell me when a migrated local Worker runs, so I can repeat the real pass.
- **kt-contract:** `deployments/devnet.json` still has the old hex ids; the browser accepts both.
- **core:** `src/game/math.ts` and `src/game/Autopilot.ts` comments still mention ZK/Stellar.

## Round 1 (STOP point A)

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
