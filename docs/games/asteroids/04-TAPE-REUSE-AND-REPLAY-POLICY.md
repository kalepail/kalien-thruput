# Asteroids Tape Reuse and Replay Policy

This page describes how the Thruput version stops a run from paying twice, where it does not,
and the open decision about copied tapes. The ZK-era policy (journal digests) is in
`docs/archive/zk/asteroids/11-TAPE-REUSE-AND-REPLAY-POLICY.md`.

## Current behavior (contract v2)

- **Best score per player and epoch.** The contract keeps `best(player_address, seed_id)`. A run
  must beat it. The contract mints only the improvement: `(new_best - previous_best) * 10^7`.
- **One claim per tape.** The contract stores `sha256(tape)` on success. A later `submit_score`
  with the same bytes fails `AlreadyClaimed`, for every player. The Worker returns 409
  `already_claimed` before it spends gas.
- **Canonical padding.** On an odd frame count, the padding nibble must be 0
  (`TapeBadPadding`). Before v2 a copier could make 16 byte variants of the same tape this way.
- **Signature binding.** The player signs
  `sha256("kalien-claim-v1" || network_hash || score_contract || seed_id || sha256(tape))`. The
  relay cannot change the tape, the epoch, the network, or the reward address.
- **Relay only.** Only allowed relay keys (the Worker's lanes) can submit, so every submission
  passes the Worker's checks first.
- **Epoch window.** A `seed_id` is active for 24 hours (the current 10-minute epoch and the
  previous 143). The tape seed must equal the stored seed of that epoch.
- **Tape access.** The Worker serves `GET /api/runs/:id/tape` only after the run is confirmed.
  The tape is also public in the transaction calldata on chain.

| Case | Result |
|---|---|
| Same tape, same player, again | rejected (`NotImproved`, checked first; the hash is also claimed) |
| Same tape bytes, another player | rejected (`AlreadyClaimed`) |
| Same tape with a changed padding nibble | rejected (`TapeBadPadding`) |
| Relay swaps the reward address | rejected (`BadSignature`) |
| Tape from another epoch | rejected (`SeedMismatch` or `SeedInactive`) |
| Submission that does not come from a relay | rejected (`NotRelay`) |

## Gap: copied tapes with different bytes

`sha256(tape)` hashes the raw bytes. Different bytes can still replay to the same score on the
same seed:

1. **Inputs the sim ignores.** While the ship respawns, turn and thrust do nothing. A change
   there (or any change that does not reach a score event) keeps the score.
2. **Frames after game over.** Ship bullets in flight can still score for up to 72 frames after
   game over; after that nothing can add score. A copier can append frames (up to 36,000 in total)
   and keep the score.

Each variant has a new CRC (easy to compute) and a new hash. So, within the 24-hour window, a
player can take a confirmed public tape, change it, sign it with their own key, and get the same
score and KALIEN on that seed. kt-contract's adversarial test
`residual_copycat_with_a_no_op_input_change_is_accepted` shows that it works today. A
front-runner can also try to submit an exact copy first; relay-only mode makes that harder,
because the copy must go through the Worker.

## Open decision (for the user)

**TODO(lead): choose one option, or accept the gap on devnet.**

| Option | Stops | Cost |
|---|---|---|
| Accept the gap on devnet | — | KALIEN on devnet has no value. Copiers can fill the leaderboard with duplicates of top runs. |
| Serve tapes only after their epoch closes (Worker) | copying from the API during the epoch | Small. The tape stays public in on-chain calldata, so a determined copier still can copy. Replays of the current epoch are hidden. |
| Require the tape to end within a fixed number of frames after game over | case 2 | Small rule change in `verify_tape`, the TS pre-check, and the contract (redeploy). |
| Dedupe on an "effective input" hash computed during the replay (only inputs that changed state, cut after game over) | cases 1–2 | Larger. A new hash in the replay loop; more gas per frame; the TS pre-check must compute the same hash. |
| Per-player game seed: `tape_seed = sha256(epoch_seed || player_pubkey)[0..4]` | all copying (a tape replays only for its player) | Medium. Players no longer share one asteroid layout per epoch. The browser, Worker pre-check, CLI, and autopilot must derive the player seed. kt-contract can add it quickly. |
| Shorter active window (for example the current epoch plus a grace period) | narrows the copy window | Changes the product (24-hour seeds). |

If shared epoch layouts matter (one race per epoch, comparable runs), the per-player seed
changes the game. Otherwise it is the only option that closes the gap completely.
