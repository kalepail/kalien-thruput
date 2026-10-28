//! RV32 artifact tests: the real `kalien_token.rv32a` and `kalien_score.rv32a`
//! in the test executor (64 KiB guest memory, RV32 gas schedule).
//! Run via `thruput test -p kalien_score` after `thruput build -p kalien_token`
//! (or `kalien-contract/scripts/test.sh`). Full 36,000-frame tapes need the
//! 16 KiB guest stack set in `.cargo/config.toml`.

mod common;

use common::*;
use kalien_score::{ScoreError, ScoreSubmitted, UNITS_PER_POINT};
use thruput_sdk::TransactResult;

fn submit_fixture_rv32(fixture: Fixture) -> u64 {
    let world = setup_rv32();
    world.set_seed(T0_SEED_ID, fixture.seed);
    // As on Futurenet: relay-only mode with the submitter on the allowlist.
    let relay = world.relay;
    world.score_call(&world.admin, move |c| c.add_relay(&relay)).assert_success();
    world.score_call(&world.admin, |c| c.set_relay_only(true)).assert_success();
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


/// Gas of each rejection path with a full 18,024-byte tape: what a griefer can
/// make the relay (or any sender) spend. Gas is not burned, but it reserves
/// scheduling capacity.
#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_rejection_gas() {
    let world = setup_rv32();
    world.set_seed(T0_SEED_ID, LONG.seed);
    let player = Player::new(0x24);
    let other = Player::new(0x25);
    let tape = LONG.bytes();
    let report = |name: &str, result: &TransactResult, expected: ScoreError| {
        assert_eq!(result.assert_abort_as::<ScoreError>(), expected, "{name}");
        println!("GAS reject {name}: gas={}", child_gas(result));
    };

    report("UnknownSeed", &world.submit(&player, T0_SEED_ID + 1, &tape), ScoreError::UnknownSeed);
    report("SeedMismatch", &world.submit(&player, T0_SEED_ID, &MAX_GAME.bytes()), ScoreError::SeedMismatch);
    let mut bad_crc = tape.clone();
    bad_crc[1000] ^= 1;
    report("TapeCrcMismatch", &world.submit(&player, T0_SEED_ID, &bad_crc), ScoreError::TapeCrcMismatch);
    let sig = other.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    report("BadSignature", &world.submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), sig), ScoreError::BadSignature);
    let mut lie = tape.clone();
    let footer = lie.len() - 8;
    lie[footer..footer + 4].copy_from_slice(&(LONG.score + 20).to_le_bytes());
    report("ScoreMismatch (full replay)", &world.submit(&player, T0_SEED_ID, &lie), ScoreError::ScoreMismatch);

    let (ok, _) = world.submit_ok(&player, T0_SEED_ID, &tape);
    println!("GAS accept test-long: gas={}", child_gas(&ok));
    report("NotImproved", &world.submit(&player, T0_SEED_ID, &tape), ScoreError::NotImproved);
    report("AlreadyClaimed", &world.submit(&other, T0_SEED_ID, &tape), ScoreError::AlreadyClaimed);
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_accepts_former_strict_rule_false_positives() {
    for (name, frames, score) in STRICT_REGRESSIONS {
        let gas = accept_on_fresh_world(setup_rv32(), &strict_regression_tape(name), frames, score);
        println!("GAS regression {name}: frames={frames} score={score} gas={gas}");
    }
}
