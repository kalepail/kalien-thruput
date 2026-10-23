# Shared environment for the Kalien contract scripts. Source it.
# The repo-wide rule: cargo / thruput run with the Thruput-only CARGO_HOME.
export CARGO_HOME="${CARGO_HOME_THRUPUT:-$HOME/.cargo-thruput}"
KALIEN_CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KALIEN_REPO_DIR="$(cd "$KALIEN_CONTRACT_DIR/.." && pwd)"
# 16 KiB guest stack: the replay needs 4-8 KiB; the rest of the 64 KiB guest
# memory goes to the heap, which holds the 18,024-byte calldata of a full tape.
KALIEN_STACK_SIZE="${KALIEN_STACK_SIZE:-16K}"
export KALIEN_CONTRACT_DIR KALIEN_REPO_DIR KALIEN_STACK_SIZE
