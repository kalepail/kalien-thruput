# Kalien CLI

Terminal client for autonomous Asteroids farming, run submission, and tape
replay on Thruput Futurenet.

The CLI plays headless games, keeps the best tape for each seed epoch, signs a
claim with a local Ed25519 key, and submits the tape to the Kalien Worker API.
The Worker relays the run to the Thruput score contract, which replays the tape
on-chain and mints KALIEN to your address.

## Identity

The CLI keeps one player key file. It makes the file on first use.

- Default path: `$KALIEN_KEY_FILE`, else `$XDG_CONFIG_HOME/kalien/key.json`, else
  `~/.config/kalien/key.json`. Override with `--key <path>`.
- The file has mode `0600`. It holds a 32-byte Ed25519 seed as `0x` hex, plus the
  public key and the address (base58) for reference. The browser wallet can
  import this file.
- Your player address is the Thruput pubkey account address of the public key
  (nonce 0, Futurenet wire 14 rules), in base58. `kalien whoami` prints it.
- A key file from before the 2026-10-24 Futurenet upgrade (hex `0x` address) is
  upgraded in place on first use. The secret does not change; the address does.
- Back up the key with `kalien key export` (`--format hex|base58|strkey`; hex is
  the default). `--format strkey` or `base58` imports into `thruput keys import`.
  Anyone with the secret controls your runs.

## Commands

- `kalien run [--threads <n|max|%>]`: run autopilot workers and submit the best
  tape of each epoch.
- `kalien submit <file.tape> [--seed-id <n>] [--no-wait] [--json]`: sign and
  submit one tape, then wait for `confirmed`, `rejected`, or `failed`.
- `kalien status <run-id> [--wait]`: show one run.
- `kalien whoami [--json]`: show the address, public key, and key file.
- `kalien key path|export|import|new`: manage the key file. `import` takes the
  secret as an argument, as `-` for stdin, or from `KALIEN_SECRET_KEY`. It accepts
  hex, base58, an S StrKey, the browser backup string
  (`kalien-key-v1:<hex>:<checksum>`), or the text of a key or backup JSON file.
  It never overwrites a key file.
- `kalien replay <file.tape>`: ASCII replay in the terminal.
- `kalien ps`: list active `kalien run` processes.
- `kalien cleanup [options]`: terminate stale `kalien run` processes.

`--address` was removed. Runs are tied to the key that signs them.

### Cleanup options

- `--dry-run`: show what would be terminated without killing processes.
- `--orphan-only`: only target orphaned runs (`PPID=1`, default unless `--all`).
- `--all`: target all matching `kalien run` processes.
- `--older-than <dur>`: only target older processes (`30s`, `10m`, `2h`, `1d`).

## API

Default API: `https://thruput.kalien.xyz` (the same Worker answers at
`https://kalien-thruput.sdf-ecosystem.workers.dev`). Override with
`--api-url <url>` or `KALIEN_API_URL` (for a local Worker, use
`http://localhost:8787`).

The CLI uses Worker API v0:

1. `GET /api/config` for `networkHash` and `scoreContract`.
2. `GET /api/seed/current` for `{ seedId, seed }`.
3. `POST /api/runs?pubkey=<hex>&seed_id=<n>&sig=<hex>` with the raw tape as the
   body. `pubkey` is the 32-byte public key and `sig` is the 64-byte Ed25519
   signature, both as lowercase hex with no `0x`.
4. `GET /api/runs/:id` until the status is final.

The signature covers the claim message:

```text
sha256("kalien-claim-v1" || network_hash || score_contract || seed_id u32 LE || sha256(tape))
```

The score contract checks the same message, so a relay cannot move a run to
another player, seed, or contract.

## Local Usage

From `cli/`:

```bash
bun run src/index.ts --help
bun run src/index.ts whoami
bun run src/index.ts run --threads 4
bun run src/index.ts run --api-url http://localhost:8787
bun run src/index.ts submit ../generated-tapes/asteroids-1a2b3c4d.tape
bun run src/index.ts replay ../test-fixtures/test-short.tape
bun run src/index.ts cleanup --orphan-only --older-than 5m
```

Autopilot (`autopilot/`) tapes and `scripts/generate-tape.ts` tapes submit with
`kalien submit`. The tape seed must equal the current seed, or pass the
`--seed-id` that the seed belongs to (the contract accepts the last 144 epochs).

## Test

From `cli/`:

```bash
bun test src
../node_modules/.bin/tsc --noEmit -p tsconfig.json
```

The tests check the claim message against fixed vectors, the Ed25519 signer
against RFC 8032, the address against the `thruput` CLI, the key file, and the
API client against a mock API. When `shared/thruput/claim.ts` exists, a test also
checks that it gives the same bytes as the CLI.

End-to-end run test against a live Worker:

```bash
bun run scripts/e2e-runs.ts --api-url http://localhost:8787
```

## Build

From `cli/`:

```bash
bun run build
```

Cross-target builds:

```bash
bun run build:all
```

Outputs are written to `cli/dist/`.
