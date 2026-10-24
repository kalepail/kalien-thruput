//! Attacker-minded tests for the score contract (native executor).
//! Each test names the attack it covers. See docs/thruput/kt-contract.md,
//! "Adversarial review", for the analysis and the residual risks.

mod common;

use std::sync::{Arc, Mutex};

use asteroids_verifier_core::verify::verify_tape;
use common::*;
use kalien_score::{
    KalienScoreClient, MAX_FRAMES, RelayChanged, ScoreError, ScoreSubmitted, SettingsChanged,
    UNITS_PER_POINT,
};
use thruput_sdk::*;

static SECOND_SCORE_NONCE: SHA256Hash = thruput_sdk::sha256_static!("KALIEN_SCORE_SECOND_NONCE");

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
        .score_call(&world.relay, move |c| c.add_relay(&relay))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);

    admin_ok(&world, |c| c.set_relay_only(true));
    // The relay is not allowed yet.
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::NotRelay);

    let result = world.score_call(&world.admin, move |c| c.add_relay(&relay));
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
    admin_ok(&world, move |c| c.remove_relay(&relay));
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

// ---------------------------------------------------------------------------
// v3: relay set, event fields, pruning, token hand-off.

#[test]
fn relay_set_allows_several_lanes_and_is_bounded() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let lanes: Vec<ContractAddress> = (1..=4).map(|i| ContractAddress::named(&format!("relay-{i}"))).collect();
    for lane in &lanes {
        let lane = *lane;
        admin_ok(&world, move |c| c.add_relay(&lane));
    }
    // Adding again changes nothing.
    let lane0 = lanes[0];
    let again = world.score_call(&world.admin, move |c| c.add_relay(&lane0));
    again.assert_success();
    assert!(again.filter_events::<RelayChanged>(&world.score).is_empty());
    admin_ok(&world, |c| c.set_relay_only(true));

    let set = world.view(|s, _| s.relays());
    assert_eq!(set.count, 4);
    assert_eq!(&set.relays[..4], &lanes[..]);

    // Every lane can submit; each run's event names its lane.
    let tapes = [SHORT.bytes(), MEDIUM.bytes()];
    for (i, tape) in tapes.iter().enumerate() {
        let player = Player::new(0x60 + i as u8);
        let sig = player.sign(&world.network_hash, &world.score, T0_SEED_ID, tape);
        let pubkey = player.pubkey();
        let tape = tape.clone();
        let result = world.score_call(&lanes[i + 2], move |c| c.submit_score(&pubkey, T0_SEED_ID, &tape, &sig));
        result.assert_success();
        let events = result.filter_events::<ScoreSubmitted>(&world.score);
        assert_eq!(events[0].payload().relay, lanes[i + 2]);
        assert_eq!(events[0].payload().submitted_at, T0_SECONDS);
    }
    // Not on the list.
    // `world.relay` (the default submitter) is not on this list.
    assert_eq!(world.submit_err(&Player::new(0x70), T0_SEED_ID, &REAL_GAME.bytes()), ScoreError::NotRelay);

    // Remove a middle lane: the last one moves into its slot.
    let lane1 = lanes[1];
    let removed = world.score_call(&world.admin, move |c| c.remove_relay(&lane1));
    removed.assert_success();
    assert!(!removed.filter_events::<RelayChanged>(&world.score)[0].payload().allowed);
    let set = world.view(|s, _| s.relays());
    assert_eq!(set.count, 3);
    assert_eq!(&set.relays[..3], &[lanes[0], lanes[3], lanes[2]]);
    assert!(!world.view(move |s, _| s.is_relay(&lane1)));
    // Removing an unknown address changes nothing.
    let stranger = ContractAddress::named("stranger");
    admin_ok(&world, move |c| c.remove_relay(&stranger));
    assert_eq!(world.view(|s, _| s.relays()).count, 3);

    // Fill to MAX_RELAYS, then one more fails.
    for i in 0..(kalien_score::MAX_RELAYS - 3) {
        let extra = ContractAddress::named(&format!("extra-{i}"));
        admin_ok(&world, move |c| c.add_relay(&extra));
    }
    assert_eq!(world.view(|s, _| s.relays()).count as usize, kalien_score::MAX_RELAYS);
    let err = world
        .score_call(&world.admin, move |c| c.add_relay(&stranger))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::RelaySetFull);

    // Only the admin manages the set.
    let err = world
        .score_call(&lanes[0], move |c| c.remove_relay(&lane0))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);
}

#[test]
fn prune_expired_runs_and_seeds() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(0x71);
    let tape = SHORT.bytes();
    world.submit_ok(&player, T0_SEED_ID, &tape);
    let address = player.address();
    let hash = sha256_bytes(&tape);
    assert_eq!(world.view(move |s, _| s.claimed_seed_id(&hash)), Some(T0_SEED_ID));

    // Still active: refused.
    let err = world
        .score_call(&world.relay, move |c| c.prune_run(&address, T0_SEED_ID, &hash))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::SeedNotExpired);
    let err = world
        .score_call(&world.relay, |c| c.prune_seed(T0_SEED_ID))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::SeedNotExpired);
    // A future epoch is not expired either.
    let err = world
        .score_call(&world.relay, |c| c.prune_seed(T0_SEED_ID + 500))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::SeedNotExpired);

    world.advance_to(T0_SECONDS + 600 * kalien_score::ACTIVE_EPOCHS as u64);
    // The wrong epoch for this tape keeps its claim.
    let wrong = world.score_call(&world.relay, move |c| c.prune_run(&address, T0_SEED_ID - 1, &hash));
    let pruned = wrong.assert_return_as::<kalien_score::Pruned>();
    assert!(!pruned.best && !pruned.claimed);

    let result = world.score_call(&world.relay, move |c| c.prune_run(&address, T0_SEED_ID, &hash));
    let pruned = result.assert_return_as::<kalien_score::Pruned>();
    assert!(pruned.best && pruned.claimed);
    assert_eq!(world.best(&address, T0_SEED_ID), 0);
    assert!(!world.view(move |s, _| s.is_claimed(&hash)));
    // KALIEN stays with the player.
    assert_eq!(world.balance(&address), 1_480 * UNITS_PER_POINT);

    let result = world.score_call(&world.relay, |c| c.prune_seed(T0_SEED_ID));
    assert!(result.assert_return_as::<kalien_score::Pruned>().seed);
    assert_eq!(world.view(|s, _| s.seed(T0_SEED_ID)), None);
    // Twice is harmless.
    let again = world.score_call(&world.relay, |c| c.prune_seed(T0_SEED_ID));
    assert!(!again.assert_return_as::<kalien_score::Pruned>().seed);
}

#[test]
fn token_handover_moves_mint_authority() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let successor = ContractAddress::named("score-v4");
    let token = world.token;

    let err = world
        .score_call(&world.relay, move |c| c.handover_token(&successor))
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);

    let result = world.score_call(&world.admin, move |c| c.handover_token(&successor));
    result.assert_success();
    assert_eq!(result.filter_events::<kalien_score::TokenHandedOver>(&world.score).len(), 1);
    assert_eq!(
        world.view(move |_, _| kalien_token::KalienTokenAdminClient::new(&token).administrator()),
        successor
    );

    // This contract can no longer mint, so a submission rolls back whole.
    let player = Player::new(0x72);
    let result = world.submit(&player, T0_SEED_ID, &SHORT.bytes());
    assert_eq!(result.assert_abort_as::<kalien_token::ERC20Error>(), kalien_token::ERC20Error::MustBeContractOwner);
    assert_eq!(world.best(&player.address(), T0_SEED_ID), 0);

    // The successor mints with the same token and balances.
    let receiver = player.address();
    world
        .transact(|tx| tx.call(&successor).run(move || kalien_token::ERC20Client::new(&token).mint(&receiver, 5)))
        .assert_success();
    assert_eq!(world.balance(&player.address()), 5);
}
