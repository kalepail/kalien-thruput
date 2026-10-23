#!/usr/bin/env bash
# Native tests, RV32 artifact tests (prints gas per tape), then the TS vectors.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$KALIEN_CONTRACT_DIR"
cargo test --workspace
thruput build -p kalien_token >/dev/null
thruput test -p kalien_score --show-output --test-threads 1
cd "$KALIEN_REPO_DIR" && bun test shared/thruput/claim.test.ts
