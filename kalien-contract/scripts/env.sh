# Shared environment for the Kalien contract scripts. Source it.
KALIEN_CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KALIEN_REPO_DIR="$(cd "$KALIEN_CONTRACT_DIR/.." && pwd)"
export KALIEN_CONTRACT_DIR KALIEN_REPO_DIR
