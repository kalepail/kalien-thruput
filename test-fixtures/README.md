# Test Fixtures

Last reviewed: 2026-10-23 (Thruput port).

These tapes are the shared replay fixtures for the TS game, the Rust
`asteroids-core` tests, the Thruput score contract tests, and the Worker tests.
The ZK proof fixtures (`*.seal`, `*.journal_raw`, `*.image_id`) were removed with
the RISC Zero prover.

## Canonical Tape Fixtures (v4 nibble-packed)

| File | Seed | Frames | Score | Bytes |
|---|---|---|---|---|
| `test-short.tape` | `0xdeadbeef` | 700 | 1480 | 374 |
| `test-medium.tape` | `0xdeadbeef` | 5000 | 11190 | 2524 |
| `test-real-game.tape` | `0x43c9c6cd` | 6643 | 14870 | 3346 |
| `test-long.tape` | `0x7f80916e` | 36000 | 92820 | 18024 |

## Additional Validated Tape (Not Canonical)

| File | Seed | Frames | Score |
|---|---|---|---|
| `test-real-game-26360.tape` | `0x4dbd5fb7` | 7328 | 15200 |

The worst-case gas tape is outside this directory:
`autopilot/fixtures/public/kalien-911140-seed1598125870.tape` (36,000 frames,
score 911,140).

## Verification Commands

`scripts/verify-tape.ts` replays a tape with the TS game and compares the score
with the footer. Its frame cap is 36,000, so it works for every fixture.

```bash
bun run scripts/verify-tape.ts test-fixtures/test-long.tape
```

The Rust replay uses the autopilot verifier:

```bash
cargo run --release --manifest-path autopilot/Cargo.toml -- verify-tape \
  --input test-fixtures/test-long.tape \
  --max-frames 36000
```

To submit a fixture to the API, the tape seed must equal the seed of the
`seed_id` you claim. Fixtures use fixed seeds, so they only submit on a local
chain or a test contract that serves the same seed. See `cli/README.md`.

## Tape Format v4

- Header: 16 bytes (magic `ZKTP`, version 4, rules tag 4, seed, frame count).
- Body: `ceil(frameCount/2)` bytes (2 frames per byte, low nibble first).
- Footer: `finalScore(4) + checksum(4)` = 8 bytes (CRC-32 of header + body).

## Candidate Promotion Checklist

1. Verify determinism (TS and Rust replay give the same score).
2. Replace the target tape fixture.
3. Update score expectations in tests and scripts.
4. Re-run the Rust core tests, the contract tests (`thruput test`), and the
   Worker tests.
