# Asteroids Tape Reuse and Replay Policy

This page describes how the Thruput version stops a run from paying twice, and where it does
not. The ZK-era policy (journal digests) is in
`docs/archive/zk/asteroids/11-TAPE-REUSE-AND-REPLAY-POLICY.md`.

## Current behavior

- **Best score per player and epoch.** The contract keeps `best(player_address, seed_id)`. A run
  must beat it. The contract mints only the improvement: `(new_best - previous_best) * 10^7`.
- **One claim per tape.** The contract stores `sha256(tape)` on success. `is_claimed(hash)` is
  true after that, and any later `submit_score` with the same bytes fails `AlreadyClaimed`, for
  every player. The Worker returns 409 `already_claimed` before it spends gas.
- **Signature binding.** The player signs
  `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id || sha256(tape))`. The
  relay cannot change the tape, the epoch, the network, or the reward address.
- **Epoch window.** A `seed_id` is active for 24 hours (the current 10-minute epoch and the
  previous 143). The tape seed must equal the stored seed of that epoch.
- **Tape access.** The Worker serves `GET /api/runs/:id/tape` only after the run is confirmed,
  so a pending tape cannot be copied from the API.

What this blocks:

| Case | Result |
|---|---|
| Same tape, same player, again | rejected (`NotImproved`, checked first; the hash is also claimed) |
| Same tape bytes, another player | rejected (`AlreadyClaimed`) |
| Relay swaps the reward address | rejected (`BadSignature`) |
| Tape from another epoch | rejected (`SeedMismatch` or `SeedInactive`) |

## Gap: different bytes, same run

`sha256(tape)` is a hash of the raw bytes. Many different byte strings replay to the same score
on the same seed:

1. **Padding nibble.** With an odd frame count, the high nibble of the last body byte is not a
   frame. Neither parser checks that it is zero, so up to 16 byte variants give the same replay.
   The parity corpus has such a tape; both sims accept it.
2. **Frames after game over.** After game over, nothing can add score. A copier can append frames
   (up to 36,000 in total) and keep the score.
3. **Inputs the sim ignores.** While the ship respawns, turn and thrust do nothing. Changes there
   (and other changes that do not reach a score event) keep the score.

Each variant has a new CRC (easy to compute) and a new hash. So, within the 24-hour window, a
player can download a confirmed public tape, change it, sign it with its own key, and get the
same score on that seed. A front-runner who sees a pending transaction in the mempool can do the
same with the original bytes.

## Options (TODO for the lead)

| Option | Closes | Cost |
|---|---|---|
| Reject a non-zero padding nibble | case 1 | Small. Rust parser, `src/game/tape.ts`, the contract (redeploy), and the Worker change together. Existing tapes are not affected (all writers write 0). |
| Require the tape to end at game over or at 36,000 frames | case 2 | Small rule change in `verify_tape` and the TS pre-check; the client already stops at game over. |
| Dedupe on an "effective input" hash computed during the replay (only inputs that changed state, cut at game over) | cases 1–3 | Larger. A new hash in the replay loop; more gas per frame. |
| Shorter active window (for example the current epoch plus a grace period) | narrows the copy window | Changes the product (24-hour seeds). |
| Accept the gap on devnet | — | KALIEN on devnet has no value. |

The kt-core report recommends the first two rows as cheap, exact rule tightenings if the lead
wants them, and the effective-input hash only if copied runs become a real problem.
