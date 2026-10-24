#!/usr/bin/env bash
# Deploy the Kalien Worker `kalien-thruput` to the Ecosystem - Stellar account
# (https://kalien-thruput.sdf-ecosystem.workers.dev).
#
#   worker/ops/deploy.sh             # checks, build, D1 migrations, deploy
#   worker/ops/deploy.sh --secrets   # also upload RELAY_SECRETS and DEV_API_KEY
#   worker/ops/deploy.sh --skip-checks
#
# Secrets come from KALIEN_RELAY_DIR (default ~/.config/kalien-thruput):
# relay.secret, relay-2.secret, ... (one per lane) and dev-api.key (made if
# missing). They are piped to wrangler and never printed.
set -euo pipefail

cd "$(dirname "$0")/../.."
export WRANGLER_LOG_PATH=.wrangler/logs
export CLOUDFLARE_ACCOUNT_ID=ba55b7ae9acfb3ed152103e3497c0752
RELAY_DIR="${KALIEN_RELAY_DIR:-$HOME/.config/kalien-thruput}"
WRANGLER="npx wrangler"

secrets=0
checks=1
for arg in "$@"; do
  case "$arg" in
    --secrets) secrets=1 ;;
    --skip-checks) checks=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ $checks -eq 1 ]]; then
  echo "== checks"
  bun run typecheck:worker
  bunx oxlint worker
  bunx oxfmt worker --check
  bun test tests/worker
fi

echo "== build"
node node_modules/vite/bin/vite.js build
# The Vite plugin copies .dev.vars next to the built Worker for `vite preview`.
rm -f dist/*/.dev.vars

echo "== D1 migrations (remote)"
DB=kalien-thruput-leaderboard
if ! $WRANGLER d1 migrations apply "$DB" --remote; then
  # On this account `migrations apply --remote` fails with API error 7403 while
  # `execute --file` works. Apply each pending file that way and record it.
  echo "migrations apply failed; applying pending files with d1 execute --file"
  pending=$($WRANGLER d1 migrations list "$DB" --remote 2>/dev/null | grep -oE '[0-9]{4}_[A-Za-z0-9_-]+\.sql' || true)
  for name in $pending; do
    echo "-- $name"
    $WRANGLER d1 execute "$DB" --remote --file "worker/migrations/$name"
    $WRANGLER d1 execute "$DB" --remote --command "INSERT INTO d1_migrations (name) VALUES ('$name')"
  done
fi

echo "== deploy"
$WRANGLER deploy

if [[ $secrets -eq 1 ]]; then
  echo "== secrets"
  bun worker/ops/relay-keys.ts --secrets | $WRANGLER secret put RELAY_SECRETS --env=""
  key_file="$RELAY_DIR/dev-api.key"
  if [[ ! -s "$key_file" ]]; then
    (umask 077 && node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))' > "$key_file")
  fi
  $WRANGLER secret put DEV_API_KEY --env="" < "$key_file"
fi

echo "== done: https://kalien-thruput.sdf-ecosystem.workers.dev"
