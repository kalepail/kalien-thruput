//! RV32 artifact tests: the real `kalien_token.rv32a` and `kalien_score.rv32a`
//! in the test executor (64 KiB guest memory, RV32 gas schedule).
//! Run via `kalien-contract/scripts/test.sh`. It builds both artifacts with
//! the 16 KiB stack the long tapes need (`thruput test` rebuilds with the
//! default 30 KiB stack, which leaves too little heap for an 18 KB tape).

mod common;

use common::*;
use kalien_score::{ScoreError, ScoreSubmitted, UNITS_PER_POINT};

fn submit_fixture_rv32(fixture: Fixture) -> u64 {
    let world = setup_rv32();
    world.set_seed(T0_SEED_ID, fixture.seed);
    let player = Player::new(0x21);
    let tape = fixture.bytes();

    let (result, receipt) = world.submit_ok(&player, T0_SEED_ID, &tape);
    assert_eq!(receipt.frame_count, fixture.frames);
    assert_eq!(receipt.final_score, fixture.score);
    assert_eq!(receipt.minted_delta, fixture.score as i128 * UNITS_PER_POINT);
    let events = result.filter_events::<ScoreSubmitted>(&world.score);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].payload().final_score, fixture.score);
    assert_eq!(world.balance(&player.address()), fixture.score as i128 * UNITS_PER_POINT);

    let gas = child_gas(&result);
    println!(
        "GAS {}: frames={} score={} tape_bytes={} gas={}",
        fixture.file,
        fixture.frames,
        fixture.score,
        tape.len(),
        gas
    );
    gas
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replays_short() {
    submit_fixture_rv32(SHORT);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replays_medium() {
    submit_fixture_rv32(MEDIUM);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replays_real_game() {
    submit_fixture_rv32(REAL_GAME);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replays_long() {
    submit_fixture_rv32(LONG);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replays_max_game() {
    submit_fixture_rv32(MAX_GAME);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_rejections() {
    let world = setup_rv32();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(0x22);
    let other = Player::new(0x23);
    let tape = SHORT.bytes();

    let signature = other.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    assert_eq!(world.submit_err(&player, T0_SEED_ID, &REAL_GAME.bytes()), ScoreError::SeedMismatch);
    assert_eq!(world.submit_err(&player, T0_SEED_ID + 1, &tape), ScoreError::UnknownSeed);
    assert_eq!(
        world.submit_err(&player, T0_SEED_ID, &build_tape(SHORT.seed, &[0u8; 30], 0)),
        ScoreError::ZeroScore
    );

    let mut bad_crc = tape.clone();
    bad_crc[100] ^= 1;
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_crc), ScoreError::TapeCrcMismatch);

    let mut bad_score = tape.clone();
    let footer = bad_score.len() - 8;
    bad_score[footer..footer + 4].copy_from_slice(&(SHORT.score + 20).to_le_bytes());
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_score), ScoreError::ScoreMismatch);

    world.submit_ok(&player, T0_SEED_ID, &tape);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &tape), ScoreError::NotImproved);
    assert_eq!(world.submit_err(&other, T0_SEED_ID, &tape), ScoreError::AlreadyClaimed);
    assert_eq!(world.balance(&player.address()), SHORT.score as i128 * UNITS_PER_POINT);
    assert_eq!(world.balance(&other.address()), 0);
}

