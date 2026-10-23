#!/usr/bin/env bash
# Build both RV32 artifacts into kalien-contract/target/thruput/.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$KALIEN_CONTRACT_DIR"
for pkg in kalien_token kalien_score; do
  thruput build -p "$pkg" --stack-size "$KALIEN_STACK_SIZE" "$@"
done
