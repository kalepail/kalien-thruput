//! The tape checks and the on-chain replay, behind a small interface so a
//! chunked replay can replace `replay_tape` without touching the contract.

use asteroids_verifier_core::VerifyError;
use asteroids_verifier_core::tape::parse_tape_ref;
use asteroids_verifier_core::verify::verify_tape;

use crate::implementation::ScoreError;

/// Header and footer fields of a tape that passed the container checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TapeSummary {
    pub seed: u32,
    pub frame_count: u32,
    pub final_score: u32,
}

/// A tape whose strict replay matched its claimed frame count and score.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Replayed {
    pub seed: u32,
    pub frame_count: u32,
    pub final_score: u32,
}

/// Container checks only: magic, version, rules tag, length, frame range, CRC,
/// and a zero padding nibble.
pub fn tape_summary(tape: &[u8], max_frames: u32) -> Result<TapeSummary, ScoreError> {
    let tape = parse_tape_ref(tape, max_frames).map_err(map_error)?;
    // An odd frame count leaves the high nibble of the last body byte unused.
    // Require it to be zero, so one game has exactly one tape encoding (and one
    // tape hash for the duplicate check).
    if tape.frame_count % 2 == 1 {
        let last = tape.body()[tape.body().len() - 1];
        if last >> 4 != 0 {
            return Err(ScoreError::TapeBadPadding);
        }
    }
    Ok(TapeSummary {
        seed: tape.seed,
        frame_count: tape.frame_count,
        final_score: tape.final_score,
    })
}

/// Full strict replay of every frame.
pub fn replay_tape(tape: &[u8], max_frames: u32) -> Result<Replayed, ScoreError> {
    let verified = verify_tape(tape, max_frames).map_err(map_error)?;
    Ok(Replayed {
        seed: verified.seed,
        frame_count: verified.frame_count,
        final_score: verified.final_score,
    })
}

fn map_error(err: VerifyError) -> ScoreError {
    match err {
        VerifyError::TapeTooShort { .. } => ScoreError::TapeTooShort,
        VerifyError::InvalidMagic { .. } => ScoreError::TapeBadMagic,
        VerifyError::UnsupportedVersion { .. } => ScoreError::TapeBadVersion,
        VerifyError::UnknownRulesTag { .. } => ScoreError::TapeBadRulesTag,
        VerifyError::HeaderReservedNonZero => ScoreError::TapeReservedNonZero,
        VerifyError::FrameCountOutOfRange { .. } => ScoreError::TapeFrameCountOutOfRange,
        VerifyError::TapeLengthMismatch { .. } => ScoreError::TapeLengthMismatch,
        VerifyError::CrcMismatch { .. } => ScoreError::TapeCrcMismatch,
        VerifyError::RuleViolation { .. } => ScoreError::RuleViolation,
        VerifyError::FrameCountMismatch { .. } => ScoreError::FrameCountMismatch,
        VerifyError::ScoreMismatch { .. } => ScoreError::ScoreMismatch,
        #[allow(unreachable_patterns)]
        _ => ScoreError::RuleViolation,
    }
}
