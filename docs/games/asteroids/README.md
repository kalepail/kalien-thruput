# Asteroids Docs

Source-of-truth specs for the Asteroids rules, the tape format, and on-chain verification.
The Rust core (`asteroids-core/`) is the reference implementation; the TS sim (`src/game/`) must
match it on every frame.

| File | Purpose |
|---|---|
| `01-GAME-SPEC.md` | Gameplay rules, progression, and difficulty |
| `02-VERIFICATION-SPEC.md` | Tape format, transition order, strict rule checks, Worker pre-check |
| `03-INTEGER-MATH-SPEC.md` | Fixed-point formats, operations, and consensus constants |
| `04-TAPE-REUSE-AND-REPLAY-POLICY.md` | How a run is stopped from paying twice, and the known gap |

System view: [docs/ARCHITECTURE.md](../../ARCHITECTURE.md).

## History

- ZK-era Asteroids specs (RISC Zero proving, Soroban contract, proof gateway, guest
  optimization): [docs/archive/zk/asteroids/](../../archive/zk/asteroids/).
- Ruleset variance audit and plans: [docs/archive/asteroids-variance/](../../archive/asteroids-variance/).

If a rule changes, update the matching file here and the golden tests
(`asteroids-core/tests/golden/`) in the same change.
