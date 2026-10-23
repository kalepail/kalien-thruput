#!/usr/bin/env bash
# Native tests, then RV32 artifact tests (with gas numbers), then the TS vectors.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$KALIEN_CONTRACT_DIR"
cargo test --workspace
"$KALIEN_CONTRACT_DIR/scripts/build.sh" >/dev/null
cargo test -p kalien_score --test test_rv32 -- --ignored --nocapture --test-threads 1
cd "$KALIEN_REPO_DIR" && bun test shared/thruput/claim.test.ts
