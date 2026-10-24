#!/usr/bin/env bash
# Full Kalien devnet deploy. Run it again after a devnet wipe.
#
#   kalien-contract/scripts/deploy-devnet.sh [--skip-fixtures] [--force]
#
# Refuses to run when shared/thruput/deployments/devnet.json already names the endpoint's
# current network (a live deploy: the old relays stay allowed on the old contract, and the
# Worker would lose its contracts). Pass --force to deploy a second pair anyway.
#
# 1. Builds both RV32 artifacts and the TS bindings.
# 2. Creates the stored keys kalien-deployer / kalien-test-player / the relay lanes
#    (kalien-relay, kalien-relay-2..4) if they are missing (keys stay in ~/.config/thruput/keys, never in git).
# 3. Funds deployer and relays from the faucet (faucet_requestAirdrop, ~1,000 HOG) when they
#    hold < 100 HOG.
# 4. Deploys the token and the score contract, links them, and writes
#    shared/thruput/deployments/devnet.json.
# 5. Creates the current seed, then (unless --skip-fixtures) fixes fixture seeds on three
#    unseeded epochs near the old end of the active window (they expire within about an
#    hour), submits the short, medium, real-game and 911,140-point tapes signed by
#    kalien-test-player through kalien-relay, claims every other repo tape with a fixture
#    seed, and records `fixtureSeedIds` in devnet.json (the Worker refuses those epochs).
#    Results go to kalien-contract/deployments/devnet-fixture-runs.json.
#    Then only the relay lanes may submit (relay-only mode), and set_seed is locked.
# 6. Writes the relay secret for the Worker to ~/.config/kalien-thruput/relay.secret (0600).
set -euo pipefail
source "$(dirname "$0")/env.sh"
RPC="${KALIEN_RPC_URL:-https://rpc.thruput.network}"
# Overrides for a rehearsal against a local node (see kalien-contract/README.md).
DEPLOYMENT="${KALIEN_DEPLOYMENT_FILE:-$KALIEN_REPO_DIR/shared/thruput/deployments/devnet.json}"
FIXTURE_RUNS="${KALIEN_FIXTURE_RUNS_FILE:-$KALIEN_CONTRACT_DIR/deployments/devnet-fixture-runs.json}"
SECRETS_DIR="${KALIEN_SECRETS_DIR:-$HOME/.config/kalien-thruput}"
FUND_TIMES="${KALIEN_FUND_TIMES:-1}"
TOOL=(bun "$KALIEN_CONTRACT_DIR/scripts/kalien.ts")
# The Worker's relay lanes (kt-worker owns kalien-relay-2..4 and their secret files).
RELAY_KEYS="${KALIEN_RELAY_KEYS:-kalien-relay,kalien-relay-2,kalien-relay-3,kalien-relay-4}"
SKIP_FIXTURES=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-fixtures) SKIP_FIXTURES=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ -f "$DEPLOYMENT" ]] && (( FORCE == 0 )); then
  live_hash="$("${TOOL[@]}" network-hash --rpc "$RPC")"
  saved_hash="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).networkHash)' "$DEPLOYMENT")"
  if [[ "$live_hash" == "$saved_hash" ]]; then
    echo "devnet.json already names the live network $live_hash; refusing to redeploy (use --force)" >&2
    exit 1
  fi
fi

"$KALIEN_CONTRACT_DIR/scripts/build.sh" >/dev/null 2>&1
echo "built artifacts"

for key in kalien-deployer kalien-test-player ${RELAY_KEYS//,/ }; do
  if [[ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/thruput/keys/$key.json" ]]; then
    thruput keys generate "$key" >/dev/null
    echo "generated key $key"
  fi
done

hog_of() { "${TOOL[@]}" balance --rpc "$RPC" --key "$1" 2>/dev/null || echo 0; }
for key in kalien-deployer ${RELAY_KEYS//,/ }; do
  if (( $(hog_of "$key") < 100 )); then
    "${TOOL[@]}" fund --rpc "$RPC" --key "$key" --times "$FUND_TIMES"
  fi
done

cd "$KALIEN_REPO_DIR"
"${TOOL[@]}" deploy --rpc "$RPC" --deployer-key kalien-deployer --out "$DEPLOYMENT" \
  --fund-score "${KALIEN_FUND_SCORE_HOG:-50}" --fund-token "${KALIEN_FUND_TOKEN_HOG:-50}"
"${TOOL[@]}" ensure-seed --deployment "$DEPLOYMENT" --key kalien-relay
# Only the relay lanes may submit (the Worker rate-limits players before it relays).
"${TOOL[@]}" harden --deployment "$DEPLOYMENT" --admin-key kalien-deployer --relay-keys "$RELAY_KEYS"

if (( SKIP_FIXTURES == 0 )); then
  "${TOOL[@]}" fixtures --deployment "$DEPLOYMENT" --admin-key kalien-deployer \
    --relay-key kalien-relay --player-key kalien-test-player \
    --out "$FIXTURE_RUNS"
fi
# After the fixtures, nobody (not even the admin) can choose a seed again.
"${TOOL[@]}" harden --deployment "$DEPLOYMENT" --admin-key kalien-deployer --relay-keys "$RELAY_KEYS" --lock-seeding

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
# Write a secret file via a temp file + mv, so a failed export never truncates the old file.
write_secret() {
  local key="$1" file="$2" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  ( umask 077; "${TOOL[@]}" export-secret --key "$key" > "$tmp" )
  if [[ ! -s "$tmp" ]]; then rm -f "$tmp"; echo "export of $key failed" >&2; return 1; fi
  chmod 600 "$tmp" && mv -f "$tmp" "$file"
  echo "relay secret -> $file (0600)"
}
write_secret kalien-relay "$SECRETS_DIR/relay.secret"
# Other lanes: kalien-relay-N -> relay-N.secret, written only when missing.
for key in ${RELAY_KEYS//,/ }; do
  [[ "$key" == kalien-relay ]] && continue
  file="$SECRETS_DIR/${key#kalien-}.secret"
  [[ -f "$file" ]] || write_secret "$key" "$file"
done
echo "deployment  -> $DEPLOYMENT"
