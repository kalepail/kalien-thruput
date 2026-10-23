#!/usr/bin/env bash
# Full Kalien devnet deploy. Run it again after a devnet wipe.
#
#   kalien-contract/scripts/deploy-devnet.sh [--skip-fixtures]
#
# 1. Builds both RV32 artifacts and the TS bindings.
# 2. Creates the stored keys kalien-deployer / kalien-relay / kalien-test-player
#    if they are missing (keys stay in ~/.config/thruput/keys, never in git).
# 3. Funds deployer and relay from the faucet when they hold < 100 HOG.
# 4. Deploys the token and the score contract, links them, and writes
#    shared/thruput/deployments/devnet.json.
# 5. Creates the current seed, then (unless --skip-fixtures) fixes fixture seeds
#    on three earlier epochs and submits the short, medium, real-game and
#    911,140-point tapes signed by kalien-test-player, through kalien-relay.
#    Results go to kalien-contract/deployments/devnet-fixture-runs.json.
# 6. Writes the relay secret for the Worker to ~/.config/kalien-thruput/relay.secret (0600).
set -euo pipefail
source "$(dirname "$0")/env.sh"
RPC="${KALIEN_RPC_URL:-https://rpc.thruput.network}"
DEPLOYMENT="$KALIEN_REPO_DIR/shared/thruput/deployments/devnet.json"
TOOL=(bun "$KALIEN_CONTRACT_DIR/scripts/kalien.ts")
SKIP_FIXTURES=0
[[ "${1:-}" == "--skip-fixtures" ]] && SKIP_FIXTURES=1

"$KALIEN_CONTRACT_DIR/scripts/build.sh" >/dev/null 2>&1
echo "built artifacts"

for key in kalien-deployer kalien-relay kalien-test-player; do
  if [[ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/thruput/keys/$key.json" ]]; then
    thruput keys generate "$key" >/dev/null
    echo "generated key $key"
  fi
done

hog_of() { thruput balance "$1" --profile devnet --json 2>/dev/null | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(Math.floor(Number(j.data?.rawBalance ?? 0)/1e7))' || echo 0; }
for key in kalien-deployer kalien-relay; do
  if (( $(hog_of "$key") < 100 )); then
    "${TOOL[@]}" fund --rpc "$RPC" --key "$key"
  fi
done

cd "$KALIEN_REPO_DIR"
"${TOOL[@]}" deploy --rpc "$RPC" --deployer-key kalien-deployer --out "$DEPLOYMENT" \
  --fund-score "${KALIEN_FUND_SCORE_HOG:-50}" --fund-token "${KALIEN_FUND_TOKEN_HOG:-50}"
"${TOOL[@]}" ensure-seed --deployment "$DEPLOYMENT" --key kalien-relay

if (( SKIP_FIXTURES == 0 )); then
  "${TOOL[@]}" fixtures --deployment "$DEPLOYMENT" --admin-key kalien-deployer \
    --relay-key kalien-relay --player-key kalien-test-player \
    --out "$KALIEN_CONTRACT_DIR/deployments/devnet-fixture-runs.json"
fi

mkdir -p "$HOME/.config/kalien-thruput"
( umask 077; "${TOOL[@]}" export-secret --key kalien-relay > "$HOME/.config/kalien-thruput/relay.secret" )
chmod 600 "$HOME/.config/kalien-thruput/relay.secret"
echo "relay secret -> ~/.config/kalien-thruput/relay.secret (0600)"
echo "deployment  -> $DEPLOYMENT"
