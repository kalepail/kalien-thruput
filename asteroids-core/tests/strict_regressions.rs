//! Honest tapes that the strict rules used to reject (found by `asteroids-core/parity`).
//!
//! - `ship-position-step-*`: the ship dies in a frame where it moves at full speed. `v >> 4`
//!   floors, so the step can exceed the old bound `(max_speed_sq >> 8) + 4`.
//! - `mode-lives-*`: a ship bullet still in flight after game over scores, crosses 10,000, and
//!   earns an extra life, so a finished game holds one life.
//!
//! The TS sim (and the loose replay) accept these tapes with the same score; the strict replay
//! must accept them too.

use asteroids_verifier_core::sim::replay_inputs;
use asteroids_verifier_core::tape::parse_tape_ref;
use asteroids_verifier_core::verify_tape;

const CASES: [(&str, u32, u32); 4] = [
    ("ship-position-step-runs-01135.tape", 3_956, 90),
    ("ship-position-step-pattern-00683.tape", 4_515, 3_240),
    ("mode-lives-uniform-01029.tape", 9_400, 10_010),
    ("mode-lives-uniform-01104.tape", 10_757, 10_670),
];

#[test]
fn strict_replay_accepts_former_false_positives() {
    let dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/strict-regressions");
    for (name, frames, score) in CASES {
        let bytes = std::fs::read(dir.join(name)).unwrap();
        let tape = parse_tape_ref(&bytes, 36_000).unwrap();
        let loose = replay_inputs(tape.seed, tape.inputs());
        assert_eq!(
            (loose.frame_count, loose.final_score),
            (frames, score),
            "{name} loose"
        );
        let verified = verify_tape(&bytes, 36_000).unwrap_or_else(|err| panic!("{name}: {err:?}"));
        assert_eq!(
            (verified.frame_count, verified.final_score),
            (frames, score),
            "{name}"
        );
    }
}
