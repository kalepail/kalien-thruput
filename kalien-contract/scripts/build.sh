#!/usr/bin/env bash
# Build both RV32 artifacts into kalien-contract/target/thruput/ and refresh
# the TS bindings in shared/thruput/bindings/. The 16 KiB guest stack comes
# from .cargo/config.toml.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$KALIEN_CONTRACT_DIR"
for pkg in kalien_token kalien_score; do
  thruput build -p "$pkg" "$@"
  thruput codegen ts "target/thruput/$pkg.spec.xdr" \
    --output "$KALIEN_REPO_DIR/shared/thruput/bindings/${pkg//_/-}.ts"
done
