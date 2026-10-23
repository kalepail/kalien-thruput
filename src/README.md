# Frontend App (`src/`)

React application for gameplay, the local player key, run submission, and leaderboard UX.

## Layout

- `src/components/`: UI components (game, leaderboard, runs, wallet, shared/ui).
- `src/game/`: core game runtime and tape handling.
- `src/thruput/`: Thruput network config, read-only client views, and the claim message.
- `src/runs/`: Worker runs API client (submit, status, history, tapes).
- `src/wallet/`: local Ed25519 player key (localStorage), backup export and import.
- `src/leaderboard/`: leaderboard data layer and signed profile edits.
- `src/hooks/`, `src/contexts/`, `src/lib/`: app support modules.

## Player key

The browser makes an Ed25519 key on the first visit and keeps it in `localStorage`
(`kalien:wallet:v1`). The address is the Thruput pubkey-account address (nonce 0).
After a run, the key signs the claim message; the Worker relay submits the
transaction and pays for gas, so the player needs no extension, faucet, or HOG.
The Wallet page exports a backup string (`kalien-key-v1:<secret>:<checksum>`) or a
JSON backup file, and imports either one.

## Common Commands

From repo root:

```bash
bun run dev
bun run typecheck:app
bun run lint
```
