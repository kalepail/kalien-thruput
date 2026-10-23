# Asteroids Deterministic Verification Spec

The score contract verifies a run by replaying its tape on chain with
`asteroids_verifier_core::verify_tape(tape, 36_000)` (`asteroids-core/src/verify.rs`). The
Worker runs the same checks off chain with the TS sim before it spends gas (see "Pre-check").

## Acceptance criteria

A tape is valid only if all of these hold:

1. The container is valid (header, length, CRC; see "Tape format").
2. The replay runs exactly `frame_count` frames.
3. After every frame, the strict rule checks pass (see "Rule checks").
4. The replayed final score equals the footer's claimed score.

The contract adds its own checks around the replay (seed, epoch window, signature, best score,
duplicate tape). See `docs/ARCHITECTURE.md` and `docs/thruput/PORT-PLAN.md`.

## Tape format (version 4, rules tag AST4)

All integers are little-endian.

### Header (16 bytes)

| Offset | Size | Field | Rule |
|---:|---:|---|---|
| 0 | 4 | magic | `0x5A4B5450` |
| 4 | 1 | version | `4` |
| 5 | 1 | rules tag | `4` (`AST4`) |
| 6 | 2 | reserved | both bytes `0` |
| 8 | 4 | seed | game RNG seed; must equal the stored seed of the claimed `seed_id` |
| 12 | 4 | frame count | `1..=36,000` |

### Body (nibble-packed)

- `ceil(frame_count / 2)` bytes. Low nibble = frame `2i`, high nibble = frame `2i + 1`.
- Each nibble: bit 0 = left, bit 1 = right, bit 2 = thrust, bit 3 = fire.
- If `frame_count` is odd, the writers set the last high nibble to 0. The parsers do **not**
  check it today (see `04-TAPE-REUSE-AND-REPLAY-POLICY.md`).

### Footer (8 bytes)

| Offset from body end | Size | Field |
|---:|---:|---|
| 0 | 4 | claimed final score |
| 4 | 4 | CRC-32 (IEEE) of header + body |

The CRC does not cover the claimed score. The replay checks the score.

Total size: `16 + ceil(frame_count / 2) + 8` bytes; at most 18,024 bytes.

### Container errors

Checked in this order: too short (`< 24` bytes), magic, version, rules tag, reserved bytes,
frame count range, exact length, CRC. The Rust (`VerifyError`) and TS (`deserializeTape`)
parsers give the same verdict and class for every case in the parity corpus.

## Canonical transition order (one frame)

1. Increment the frame counter.
2. Read the frame input.
3. Update the ship (cooldown, fire latch, respawn, turn, thrust, drag, clamp, fire, move).
4. Update asteroids.
5. Update player bullets.
6. Update saucers (spawn, move, cull, drift, fire).
7. Update saucer bullets.
8. Resolve collisions (bullets vs asteroids, saucer bullets vs asteroids, bullets vs saucers,
   saucers vs asteroids, then ship vs asteroids, saucer bullets, saucers).
9. Prune destroyed entities (stable order).
10. Increment the anti-lurk timer.
11. Spawn the next wave if the game is running and no asteroids or saucers are left.

The replay keeps running after game over until `frame_count` frames.

## Rule checks

`replay_strict` checks the start state, then checks every transition and the new state after
each frame. A failure rejects the tape with `RuleViolation { frame, rule }`.

| Group | Rules |
|---|---|
| Global | `GLOBAL_WAVE_NONZERO`, `GLOBAL_MODE_LIVES_CONSISTENCY`, `GLOBAL_NEXT_EXTRA_LIFE_SCORE` |
| Ship | `SHIP_BOUNDS`, `SHIP_ANGLE_RANGE`, `SHIP_COOLDOWN_RANGE`, `SHIP_RESPAWN_TIMER_RANGE`, `SHIP_INVULNERABILITY_RANGE`, `SHIP_SPEED_CLAMP`, `SHIP_TURN_RATE_STEP`, `SHIP_POSITION_STEP` |
| Bullets | `PLAYER_BULLET_LIMIT`, `PLAYER_BULLET_COOLDOWN_BYPASS`, `SAUCER_BULLET_LIMIT` |
| Saucers | `SAUCER_CAP` |
| Progression | `PROGRESSION_SCORE_DELTA` (each frame's score delta must be a sum of at most four score events), `PROGRESSION_WAVE_ADVANCE` |

These rules check the simulation's own state. Inputs alone do not trip them: the parity corpus
and the fuzz tests found no input stream that fails a rule check while the loose replay gives the
claimed score (see `docs/thruput/kt-core.md`). They stay as defense in depth.

## RNG integrity

- The game RNG algorithm and its call order are consensus-critical.
- Visual randomness is separate and never changes game state.

## Pre-check in the Worker

`worker/replay.ts` parses the tape with `src/game/tape.ts` and replays it with
`src/game/AsteroidsGame.ts` (headless). It rejects the run if the replayed score differs from the
claim. The TS sim has no strict rule checks. That is safe because the TS and Rust sims give the
same full state on every frame, and no input stream trips a strict rule.

## Result

On success `verify_tape` returns `VerifiedTape { seed, frame_count, final_score }`. On failure it
returns a `VerifyError`: a container error, `RuleViolation { frame, rule }`,
`FrameCountMismatch`, or `ScoreMismatch`. The contract maps these to `ScoreError` codes 20–32.
