use crate::error::VerifyError;
use crate::sim::{replay_strict_inputs, ReplayResult, ReplayViolation};
use crate::tape::{parse_tape_ref, PackedInputs};

/// Result of a successful strict verification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VerifiedTape {
    pub seed: u32,
    pub frame_count: u32,
    pub final_score: u32,
}

/// Verify a tape end to end: container checks, strict replay (rule checks every frame), and
/// claimed frame count / final score against the replay. Does not allocate.
pub fn verify_tape(bytes: &[u8], max_frames: u32) -> Result<VerifiedTape, VerifyError> {
    verify_tape_with_replay(bytes, max_frames, |seed, inputs| {
        replay_strict_inputs(seed, inputs)
    })
}

/// Shared verification implementation parameterized by replay function.
fn verify_tape_with_replay<F>(
    bytes: &[u8],
    max_frames: u32,
    replay_fn: F,
) -> Result<VerifiedTape, VerifyError>
where
    F: FnOnce(u32, PackedInputs<'_>) -> Result<ReplayResult, ReplayViolation>,
{
    let tape = parse_tape_ref(bytes, max_frames)?;
    let replay_result =
        replay_fn(tape.seed, tape.inputs()).map_err(|err| VerifyError::RuleViolation {
            frame: err.frame_count,
            rule: err.rule,
        })?;

    if replay_result.frame_count != tape.frame_count {
        return Err(VerifyError::FrameCountMismatch {
            claimed: tape.frame_count,
            computed: replay_result.frame_count,
        });
    }

    if replay_result.final_score != tape.final_score {
        return Err(VerifyError::ScoreMismatch {
            claimed: tape.final_score,
            computed: replay_result.final_score,
        });
    }

    Ok(VerifiedTape {
        seed: tape.seed,
        frame_count: tape.frame_count,
        final_score: replay_result.final_score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{TAPE_HEADER_SIZE, TAPE_MAGIC, TAPE_VERSION};
    use crate::error::RuleCode;
    use crate::sim::replay;
    use crate::tape::{body_bytes, serialize_tape};

    fn footer_offset(frame_count: usize) -> usize {
        TAPE_HEADER_SIZE + body_bytes(frame_count)
    }

    fn valid_tape(seed: u32, inputs: &[u8]) -> Vec<u8> {
        let replay_result = replay(seed, inputs);
        serialize_tape(seed, inputs, replay_result.final_score)
    }

    #[test]
    fn returns_seed_frames_and_score() {
        let inputs = [0x00u8; 60];
        let seed = 0x1234_5678;
        let tape = valid_tape(seed, &inputs);
        let expected = replay(seed, &inputs);
        assert_eq!(
            verify_tape(&tape, 10_000).unwrap(),
            VerifiedTape {
                seed,
                frame_count: 60,
                final_score: expected.final_score,
            }
        );
    }

    #[test]
    fn detects_score_tampering() {
        let inputs = [0x00u8; 60];
        let seed = 0x1234_5678;
        let mut good_tape = valid_tape(seed, &inputs);
        let verified = verify_tape(&good_tape, 10_000).unwrap();

        let offset = footer_offset(inputs.len());
        let tampered_score = verified.final_score + 1;
        good_tape[offset..offset + 4].copy_from_slice(&tampered_score.to_le_bytes());

        let err = verify_tape(&good_tape, 10_000).unwrap_err();
        assert!(matches!(err, VerifyError::ScoreMismatch { .. }));
    }

    #[test]
    fn maps_replay_violation_to_verify_error() {
        let inputs = [0x00u8; 4];
        let tape = valid_tape(0xDEAD_BEEF, &inputs);
        let err = verify_tape_with_replay(&tape, 100, |_seed, _inputs| {
            Err(ReplayViolation {
                frame_count: 3,
                rule: RuleCode::ShipBounds,
            })
        })
        .unwrap_err();

        assert!(matches!(
            err,
            VerifyError::RuleViolation {
                frame: 3,
                rule: RuleCode::ShipBounds
            }
        ));
    }

    #[test]
    fn detects_frame_count_mismatch_when_replay_disagrees() {
        let inputs = [0x00u8; 4];
        let tape = valid_tape(0xDEAD_BEEF, &inputs);
        let expected = replay(0xDEAD_BEEF, &inputs);
        let err = verify_tape_with_replay(&tape, 100, |_seed, _inputs| {
            Ok(ReplayResult {
                frame_count: expected.frame_count + 1,
                ..expected
            })
        })
        .unwrap_err();

        assert!(matches!(
            err,
            VerifyError::FrameCountMismatch {
                claimed: 4,
                computed: 5
            }
        ));
    }

    #[test]
    fn single_byte_tampering_is_rejected() {
        let inputs = [0x01u8, 0x02, 0x04, 0x08, 0x03, 0x0C, 0x00, 0x07];
        let good_tape = valid_tape(0xFEED_BEEF, &inputs);
        assert!(verify_tape(&good_tape, 100).is_ok());

        for idx in 0..good_tape.len() {
            let mut tampered = good_tape.clone();
            tampered[idx] ^= 0x01;
            assert!(
                verify_tape(&tampered, 100).is_err(),
                "tampering byte index {idx} must fail verification"
            );
        }
    }

    #[test]
    fn parse_checks_happen_before_replay() {
        let mut tape = valid_tape(0xDEAD_BEEF, &[0x00u8; 4]);
        tape[0..4].copy_from_slice(&TAPE_MAGIC.wrapping_add(1).to_le_bytes());
        tape[4] = TAPE_VERSION + 1;

        let err = verify_tape_with_replay(&tape, 10, |_seed, _inputs| {
            panic!("replay must not run when parse fails")
        })
        .unwrap_err();

        assert!(matches!(err, VerifyError::InvalidMagic { .. }));
    }
}
