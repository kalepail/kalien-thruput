# Shared environment for the Kalien contract scripts. Source it.
# Repo rule: cargo / thruput run with the Thruput-only CARGO_HOME.
export CARGO_HOME="${CARGO_HOME_THRUPUT:-$HOME/.cargo-thruput}"
KALIEN_CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KALIEN_REPO_DIR="$(cd "$KALIEN_CONTRACT_DIR/.." && pwd)"
export KALIEN_CONTRACT_DIR KALIEN_REPO_DIR
