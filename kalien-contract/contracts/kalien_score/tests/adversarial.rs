//! Attacker-minded tests for the score contract (native executor).
//! Each test names the attack it covers. See docs/thruput/kt-contract.md,
//! "Adversarial review", for the analysis and the residual risks.

mod common;

use std::sync::{Arc, Mutex};

use asteroids_verifier_core::verify::verify_tape;
use common::*;
use kalien_score::{KalienScoreClient, MAX_FRAMES, RelayChanged, ScoreError, SettingsChanged, UNITS_PER_POINT};
use sdk::*;

static SECOND_SCORE_NONCE: SHA256Hash = sdk::sha256_static!("KALIEN_SCORE_SECOND_NONCE");

fn admin_ok(world: &World, f: impl FnOnce(KalienScoreClient) + std::panic::UnwindSafe) {
    world.score_call(&world.admin, f).assert_success();
}

// ---------------------------------------------------------------------------
// Relay redirect.

#[test]
fn relay_cannot_redirect_the_reward() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let victim = Player::new(0x41);
    let attacker = Player::new(0x42);
    let tape = SHORT.bytes();
    let victim_sig = victim.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);

    // Swap in the attacker's pubkey with the victim's signature.
    let err = world
        .submit_raw(attacker.pubkey(), T0_SEED_ID, tape.clone(), victim_sig)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    // Submitted as signed: the reward goes to the signer, never to the relay.
    let (_, receipt) = world.submit_ok(&victim, T0_SEED_ID, &tape);
    assert_eq!(receipt.player, victim.address());
    assert_eq!(world.balance(&victim.address()), 1_480 * UNITS_PER_POINT);
    assert_eq!(world.balance(&world.relay), 0);
    assert_eq!(world.balance(&attacker.address()), 0);
}

// ---------------------------------------------------------------------------
// Replay of a signed claim in another context.

#[test]
fn signed_claim_does_not_replay_on_another_epoch_with_the_same_seed() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    world.set_seed(T0_SEED_ID - 1, SHORT.seed);
    let player = Player::new(0x43);
    let tape = SHORT.bytes();
    let sig = player.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    world.submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), sig).assert_success();
    world.env.advance_block_at(seconds_to_timepoint(world.now.get()));
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID - 1, tape, sig)
        .assert_abort_as::<ScoreError>();
    // The tape hash is already claimed; that check runs before the signature.
    assert_eq!(err, ScoreError::AlreadyClaimed);

    // A fresh tape signed for epoch E is refused on epoch E-1 even with the same seed.
    let tape = MEDIUM.bytes();
    let sig = player.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID - 1, tape, sig)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);
}

#[test]
fn signed_claim_does_not_replay_on_a_second_deployment() {
    let world = setup();
    let score_hash = world.score_hash;
    let token = world.token;
    let admin = world.admin;
    let out: Arc<Mutex<Option<ContractAddress>>> = Arc::new(Mutex::new(None));
    let out_inner = out.clone();
    world
        .transact(|tx| {
            tx.call(&admin).run(move || {
                let second = deploy_contract(&SECOND_SCORE_NONCE, &score_hash);
                KalienScoreClient::new(&second).initialize(&admin, &token);
                KalienScoreClient::new(&second).set_seed(T0_SEED_ID, SHORT.seed);
                *out_inner.lock().unwrap() = Some(second);
            })
        })
        .assert_success();
    let second = out.lock().unwrap().unwrap();

    let player = Player::new(0x44);
    let tape = SHORT.bytes();
    // Signed for the first contract, sent to the second.
    let sig = player.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    let pubkey = player.pubkey();
    let err = world
        .transact(|tx| {
            tx.call(&world.relay).run(move || {
                KalienScoreClient::new(&second).submit_score(&pubkey, T0_SEED_ID, &tape, &sig)
            })
        })
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);
}

// ---------------------------------------------------------------------------
// Tape reuse by another player.

#[test]
fn padding_nibble_variants_are_rejected() {
    // An odd frame count leaves 4 unused bits; without this check one game
    // would have 16 encodings and 16 tape hashes.
    let world = setup();
    world.set_seed(T0_SEED_ID, REAL_GAME.seed);
    assert_eq!(REAL_GAME.frames % 2, 1);
    let attacker = Player::new(0x45);
    let mut tape = REAL_GAME.bytes();
    let last_body = tape.len() - 9;
    assert_eq!(tape[last_body] >> 4, 0);
    tape[last_body] |= 0x50;
    fix_crc(&mut tape);
    assert_eq!(world.submit_err(&attacker, T0_SEED_ID, &tape), ScoreError::TapeBadPadding);
    // The canonical tape is fine.
    world.submit_ok(&attacker, T0_SEED_ID, &REAL_GAME.bytes());
}

/// RESIDUAL RISK (documented, not fixed): a copycat can change an input that does
/// not affect the outcome (here: a frame after the last scoring event), so the
/// tape hash differs and the replay still gives the same score. The tape-hash
/// check stops exact copies only. A real fix needs a per-player seed; see the
/// report. When that lands, flip this test.
#[test]
fn residual_copycat_with_a_no_op_input_change_is_accepted() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let original = SHORT.bytes();
    let frames = SHORT.frames as usize;
    // Find the latest frame whose input can change without changing the result.
    let mut copy = None;
    'search: for frame in (0..frames).rev() {
        for new_input in [0u8, 0x01, 0x02, 0x04, 0x08] {
            let mut t = original.clone();
            let byte = 16 + frame / 2;
            let shift = (frame % 2) * 4;
            if (t[byte] >> shift) & 0x0F == new_input {
                continue;
            }
            t[byte] = (t[byte] & !(0x0F << shift)) | (new_input << shift);
            fix_crc(&mut t);
            if let Ok(v) = verify_tape(&t, MAX_FRAMES) {
                if v.final_score == SHORT.score {
                    copy = Some(t);
                    break 'search;
                }
            }
        }
    }
    let copy = copy.expect("a no-op mutation exists");
    assert_ne!(sha256_bytes(&copy), sha256_bytes(&original));

    let author = Player::new(0x46);
    let copycat = Player::new(0x47);
    world.submit_ok(&author, T0_SEED_ID, &original);
    // Exact copy: refused.
    assert_eq!(world.submit_err(&copycat, T0_SEED_ID, &original), ScoreError::AlreadyClaimed);
    // Near copy: accepted today.
    let (_, receipt) = world.submit_ok(&copycat, T0_SEED_ID, &copy);
    assert_eq!(receipt.final_score, SHORT.score);
}

// ---------------------------------------------------------------------------
// Seed control.

#[test]
fn lock_seeding_disables_set_seed_for_good() {
    let world = setup();
    // Only the admin can lock.
    let err = world
        .score_call(&world.relay, |c| c.lock_seeding())
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);

    let result = world.score_call(&world.admin, |c| c.lock_seeding());
    result.assert_success();
    let settings = result.filter_events::<SettingsChanged>(&world.score);
    assert!(settings[0].payload().seeding_locked);
    assert!(world.view(|s, _| s.config()).seeding_locked);

    assert_eq!(world.try_set_seed(&world.admin, T0_SEED_ID, 7), Some(ScoreError::SeedingLocked));
    // The open path still works.
    world
        .score_call(&world.relay, |c| c.ensure_current_seed())
        .assert_success();
    assert!(world.view(|s, _| s.current_seed()).is_some());
}

// ---------------------------------------------------------------------------
// Direct-call spam and storage drain: relay-only mode.

#[test]
fn relay_only_mode_blocks_other_callers() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let relay = world.relay;
    let player = Player::new(0x48);

    // Admin only.
    let err = world
        .score_call(&world.relay, |c| c.set_relay_only(true))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);
    let err = world
        .score_call(&world.relay, move |c| c.set_relay(&relay, true))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);

    admin_ok(&world, |c| c.set_relay_only(true));
    // The relay is not allowed yet.
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::NotRelay);

    let result = world.score_call(&world.admin, move |c| c.set_relay(&relay, true));
    result.assert_success();
    let changed = result.filter_events::<RelayChanged>(&world.score);
    assert!(changed[0].payload().allowed);
    assert!(world.view(move |s, _| s.is_relay(&relay)));
    world.submit_ok(&player, T0_SEED_ID, &SHORT.bytes());

    // Anyone else, even with a valid player signature, is refused.
    let stranger = ContractAddress::named("stranger");
    let tape = MEDIUM.bytes();
    let sig = player.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    let pubkey = player.pubkey();
    let err = world
        .score_call(&stranger, move |c| c.submit_score(&pubkey, T0_SEED_ID, &tape, &sig))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotRelay);

    // Removing the relay closes it again; switching the mode off reopens.
    admin_ok(&world, move |c| c.set_relay(&relay, false));
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &MEDIUM.bytes()), ScoreError::NotRelay);
    admin_ok(&world, |c| c.set_relay_only(false));
    world.submit_ok(&player, T0_SEED_ID, &MEDIUM.bytes());
}

// ---------------------------------------------------------------------------
// Tape length and header edge cases.

#[test]
fn tape_length_edge_cases() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let p = Player::new(0x49);

    // Zero frames.
    let zero = build_tape(SHORT.seed, &[], 1);
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &zero), ScoreError::TapeFrameCountOutOfRange);

    // One extra trailing byte.
    let mut long = SHORT.bytes();
    long.push(0);
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &long), ScoreError::TapeLengthMismatch);

    // Header claims more frames than the body holds.
    let mut lie = SHORT.bytes();
    lie[12..16].copy_from_slice(&(SHORT.frames + 2).to_le_bytes());
    fix_crc(&mut lie);
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &lie), ScoreError::TapeLengthMismatch);

    // Header claims fewer frames: the length no longer matches either.
    let mut short_claim = SHORT.bytes();
    short_claim[12..16].copy_from_slice(&(SHORT.frames - 2).to_le_bytes());
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &short_claim), ScoreError::TapeLengthMismatch);

    // A consistent, shorter prefix of a real game replays to a smaller score: the
    // footer must carry that exact score.
    let inputs: Vec<u8> = (0..400)
        .map(|i| {
            let t = SHORT.bytes();
            (t[16 + i / 2] >> ((i % 2) * 4)) & 0x0F
        })
        .collect();
    let prefix_claiming_full = build_tape(SHORT.seed, &inputs, SHORT.score);
    assert_eq!(
        world.submit_err(&p, T0_SEED_ID, &prefix_claiming_full),
        ScoreError::ScoreMismatch
    );

    // Max frames + 1 and an absurd frame count.
    let over = build_tape(SHORT.seed, &vec![0u8; MAX_FRAMES as usize + 1], 1);
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &over), ScoreError::TapeFrameCountOutOfRange);
    let mut huge = SHORT.bytes();
    huge[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(world.submit_err(&p, T0_SEED_ID, &huge), ScoreError::TapeFrameCountOutOfRange);
    assert_eq!(world.balance(&p.address()), 0);
}

// ---------------------------------------------------------------------------
// Mint arithmetic.

#[test]
fn mint_amount_cannot_overflow() {
    // The largest possible improvement (u32::MAX points) fits easily in i128.
    let max = (u32::MAX as i128) * UNITS_PER_POINT;
    assert!(max < i128::MAX / 1_000_000_000);
    // Improvement is computed only when final > previous, so the u32 subtraction
    // cannot wrap; NotImproved covers the rest (see rejects_score_not_above_best).
}
