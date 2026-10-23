//! Native (mock executor) tests for the score contract and the token.

mod common;

use common::*;
use kalien_score::{
    ACTIVE_EPOCHS, KalienScoreClient, ScoreError, ScoreSubmitted, SeedCreated, SeedInfo,
    UNITS_PER_POINT, ZERO_SEED_FALLBACK, claim, derive_seed,
};
use kalien_token::{ERC20Client, ERC20Error, KalienTokenAdminClient, KalienTokenError, MintEvent};
use sdk::*;

// ---------------------------------------------------------------------------
// Replay of the fixture tapes, end to end through submit_score.

fn submit_fixture(fixture: Fixture) {
    let world = setup();
    world.set_seed(T0_SEED_ID, fixture.seed);
    let player = Player::new(1);
    let tape = fixture.bytes();

    let (result, receipt) = world.submit_ok(&player, T0_SEED_ID, &tape);
    assert_eq!(receipt.player, player.address());
    assert_eq!(receipt.seed_id, T0_SEED_ID);
    assert_eq!(receipt.seed, fixture.seed);
    assert_eq!(receipt.frame_count, fixture.frames);
    assert_eq!(receipt.final_score, fixture.score);
    assert_eq!(receipt.previous_best, 0);
    assert_eq!(receipt.minted_delta, fixture.score as i128 * UNITS_PER_POINT);
    assert_eq!(receipt.tape_hash, sha256_bytes(&tape));

    let events = result.filter_events::<ScoreSubmitted>(&world.score);
    assert_eq!(events.len(), 1);
    let event = &events[0];
    let topic_player: &ContractAddress = event.topic(1).unwrap().into();
    assert_eq!(topic_player, &player.address());
    let payload = event.payload();
    assert_eq!(payload.player_pubkey, player.pubkey());
    assert_eq!(payload.seed, fixture.seed);
    assert_eq!(payload.frame_count, fixture.frames);
    assert_eq!(payload.final_score, fixture.score);
    assert_eq!(payload.previous_best, 0);
    assert_eq!(payload.new_best, fixture.score);
    assert_eq!(payload.minted_delta, fixture.score as i128 * UNITS_PER_POINT);
    assert_eq!(payload.tape_hash, sha256_bytes(&tape));

    let mints = result.filter_events::<MintEvent>(&world.token);
    assert_eq!(mints.len(), 1);

    assert_eq!(world.balance(&player.address()), fixture.score as i128 * UNITS_PER_POINT);
    assert_eq!(world.best(&player.address(), T0_SEED_ID), fixture.score);
    let hash = sha256_bytes(&tape);
    assert!(world.view(move |score, _| score.is_claimed(&hash)));
}

#[test]
fn replays_short_fixture() {
    submit_fixture(SHORT);
}

#[test]
fn replays_medium_fixture() {
    submit_fixture(MEDIUM);
}

#[test]
fn replays_real_game_fixture() {
    submit_fixture(REAL_GAME);
}

#[test]
fn replays_long_fixture() {
    submit_fixture(LONG);
}

#[test]
fn replays_max_game_fixture() {
    submit_fixture(MAX_GAME);
}

// ---------------------------------------------------------------------------
// Best score and mint deltas.

#[test]
fn mints_only_the_improvement() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(2);

    let (_, first) = world.submit_ok(&player, T0_SEED_ID, &SHORT.bytes());
    assert_eq!(first.previous_best, 0);
    assert_eq!(first.minted_delta, 1_480 * UNITS_PER_POINT);

    let (result, second) = world.submit_ok(&player, T0_SEED_ID, &MEDIUM.bytes());
    assert_eq!(second.previous_best, 1_480);
    assert_eq!(second.final_score, 11_190);
    assert_eq!(second.minted_delta, (11_190 - 1_480) * UNITS_PER_POINT);
    let events = result.filter_events::<ScoreSubmitted>(&world.score);
    assert_eq!(events[0].payload().previous_best, 1_480);
    assert_eq!(events[0].payload().new_best, 11_190);

    assert_eq!(world.balance(&player.address()), 11_190 * UNITS_PER_POINT);
    assert_eq!(world.best(&player.address(), T0_SEED_ID), 11_190);
    let total = world.view(|_, token| token.total_supply());
    assert_eq!(total, 11_190 * UNITS_PER_POINT);
}

#[test]
fn rejects_score_not_above_best() {
    let world = setup();
    world.set_seed(T0_SEED_ID, MEDIUM.seed);
    let player = Player::new(3);
    world.submit_ok(&player, T0_SEED_ID, &MEDIUM.bytes());
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::NotImproved);
    // The same tape again is also not an improvement.
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &MEDIUM.bytes()), ScoreError::NotImproved);
    assert_eq!(world.balance(&player.address()), 11_190 * UNITS_PER_POINT);
}

#[test]
fn best_scores_are_per_player_and_per_epoch() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let alice = Player::new(4);
    let bob = Player::new(5);
    world.submit_ok(&alice, T0_SEED_ID, &MEDIUM.bytes());
    world.submit_ok(&bob, T0_SEED_ID, &SHORT.bytes());
    assert_eq!(world.best(&alice.address(), T0_SEED_ID), 11_190);
    assert_eq!(world.best(&bob.address(), T0_SEED_ID), 1_480);

    // Next epoch: a fresh best for Alice.
    world.advance_to(T0_SECONDS + 600);
    world.set_seed(T0_SEED_ID + 1, REAL_GAME.seed);
    let (_, receipt) = world.submit_ok(&alice, T0_SEED_ID + 1, &REAL_GAME.bytes());
    assert_eq!(receipt.previous_best, 0);
    assert_eq!(world.best(&alice.address(), T0_SEED_ID + 1), 14_870);
    assert_eq!(world.best(&alice.address(), T0_SEED_ID), 11_190);
}

// ---------------------------------------------------------------------------
// Rejections.

#[test]
fn rejects_bad_signature() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(6);
    let other = Player::new(7);
    let tape = SHORT.bytes();

    // Signed by another key.
    let signature = other.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    // Signed for another epoch.
    let signature = player.sign(&world.network_hash, &world.score, T0_SEED_ID + 1, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    // Signed for another network.
    let signature = player.sign(&[0x11; 32], &world.score, T0_SEED_ID, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    // Signed for another contract.
    let signature = player.sign(&world.network_hash, &world.token, T0_SEED_ID, &tape);
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    // One flipped signature bit.
    let mut signature = player.sign(&world.network_hash, &world.score, T0_SEED_ID, &tape);
    signature[10] ^= 1;
    let err = world
        .submit_raw(player.pubkey(), T0_SEED_ID, tape.clone(), signature)
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::BadSignature);

    assert_eq!(world.balance(&player.address()), 0);
}

#[test]
fn rejects_wrong_seed() {
    let world = setup();
    world.set_seed(T0_SEED_ID, REAL_GAME.seed);
    let player = Player::new(8);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::SeedMismatch);
}

#[test]
fn rejects_unknown_seed() {
    let world = setup();
    let player = Player::new(9);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::UnknownSeed);
}

#[test]
fn rejects_inactive_seed() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(10);

    // The last active epoch still accepts it.
    world.advance_to(T0_SECONDS + 600 * (ACTIVE_EPOCHS as u64 - 1));
    world.submit_ok(&player, T0_SEED_ID, &SHORT.bytes());

    // One epoch later it is inactive.
    world.advance_to(T0_SECONDS + 600 * ACTIVE_EPOCHS as u64);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &MEDIUM.bytes()), ScoreError::SeedInactive);
    assert!(!world.view(|score, _| score.is_seed_active(T0_SEED_ID)));
}

#[test]
fn rejects_zero_score() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(11);
    let tape = build_tape(SHORT.seed, &[0u8; 30], 0);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &tape), ScoreError::ZeroScore);
}

#[test]
fn rejects_duplicate_tape_from_another_player() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let alice = Player::new(12);
    let mallory = Player::new(13);
    world.submit_ok(&alice, T0_SEED_ID, &SHORT.bytes());
    assert_eq!(world.submit_err(&mallory, T0_SEED_ID, &SHORT.bytes()), ScoreError::AlreadyClaimed);
    assert_eq!(world.balance(&mallory.address()), 0);
}

#[test]
fn rejects_when_paused_and_resumes() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(14);
    let score = world.score;

    // Only the admin may pause.
    let err = world.transact(|tx| {
            tx.call(&world.relay)
                .run(move || KalienScoreClient::new(&score).set_paused(true))
        })
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::NotAdmin);

    world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || KalienScoreClient::new(&score).set_paused(true))
        })
        .assert_success();
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &SHORT.bytes()), ScoreError::Paused);

    world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || KalienScoreClient::new(&score).set_paused(false))
        })
        .assert_success();
    world.submit_ok(&player, T0_SEED_ID, &SHORT.bytes());
}

#[test]
fn rejects_bad_tape_container() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(15);
    let good = SHORT.bytes();

    let mut bad_magic = good.clone();
    bad_magic[0] ^= 0xFF;
    fix_crc(&mut bad_magic);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_magic), ScoreError::TapeBadMagic);

    let mut bad_version = good.clone();
    bad_version[4] = 3;
    fix_crc(&mut bad_version);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_version), ScoreError::TapeBadVersion);

    let mut bad_rules = good.clone();
    bad_rules[5] = 9;
    fix_crc(&mut bad_rules);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_rules), ScoreError::TapeBadRulesTag);

    let mut bad_reserved = good.clone();
    bad_reserved[6] = 1;
    fix_crc(&mut bad_reserved);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_reserved), ScoreError::TapeReservedNonZero);

    let mut bad_crc = good.clone();
    let len = bad_crc.len();
    bad_crc[len - 1] ^= 0x01;
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_crc), ScoreError::TapeCrcMismatch);

    let mut bad_body = good.clone();
    bad_body[100] ^= 0x01;
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &bad_body), ScoreError::TapeCrcMismatch);

    let truncated = good[..good.len() - 1].to_vec();
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &truncated), ScoreError::TapeLengthMismatch);

    assert_eq!(world.submit_err(&player, T0_SEED_ID, &good[..10]), ScoreError::TapeTooShort);

    let too_long = build_tape(SHORT.seed, &vec![0u8; 36_001], 10);
    assert_eq!(
        world.submit_err(&player, T0_SEED_ID, &too_long),
        ScoreError::TapeFrameCountOutOfRange
    );

    assert_eq!(world.balance(&player.address()), 0);
}

#[test]
fn rejects_claimed_score_that_replay_does_not_reach() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(16);

    // The footer score is outside the CRC: raise it and keep the CRC valid.
    let mut tape = SHORT.bytes();
    let footer = tape.len() - 8;
    tape[footer..footer + 4].copy_from_slice(&(SHORT.score + 20).to_le_bytes());
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &tape), ScoreError::ScoreMismatch);

    // A replay of different inputs does not match the claimed score either.
    let mut tape = SHORT.bytes();
    tape[200] ^= 0x0F;
    fix_crc(&mut tape);
    assert_eq!(world.submit_err(&player, T0_SEED_ID, &tape), ScoreError::ScoreMismatch);
}

// ---------------------------------------------------------------------------
// Seeds.

#[test]
fn ensure_current_seed_creates_once() {
    let world = setup();
    let score = world.score;
    assert_eq!(world.view(|score, _| score.current_seed()), None);
    assert_eq!(world.view(|score, _| score.current_seed_id()), T0_SEED_ID);

    let result = world.transact(|tx| {
        tx.call(&world.relay)
            .run(move || KalienScoreClient::new(&score).ensure_current_seed())
    });
    result.assert_success();
    let first = result.assert_return_as::<SeedInfo>();
    assert_eq!(first.seed_id, T0_SEED_ID);
    assert_ne!(first.seed, 0);
    let created = result.filter_events::<SeedCreated>(&world.score);
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].payload().seed, first.seed);

    // A second call returns the stored seed and emits nothing.
    let result = world.transact(|tx| {
        tx.call(&world.admin)
            .run(move || KalienScoreClient::new(&score).ensure_current_seed())
    });
    assert_eq!(result.assert_return_as::<SeedInfo>(), first);
    assert!(result.filter_events::<SeedCreated>(&world.score).is_empty());
    assert_eq!(world.view(|score, _| score.current_seed()), Some(first));
    assert_eq!(world.view(|score, _| score.seed(T0_SEED_ID)), Some(first.seed));

    // An admin cannot overwrite it.
    assert_eq!(
        world.try_set_seed(&world.admin, T0_SEED_ID, 1),
        Some(ScoreError::SeedAlreadySet)
    );

    // The next epoch gets a new seed.
    world.advance_to(T0_SECONDS + 600);
    let result = world.transact(|tx| {
        tx.call(&world.relay)
            .run(move || KalienScoreClient::new(&score).ensure_current_seed())
    });
    let next = result.assert_return_as::<SeedInfo>();
    assert_eq!(next.seed_id, T0_SEED_ID + 1);
}

#[test]
fn set_seed_rules() {
    let world = setup();
    assert_eq!(world.try_set_seed(&world.relay, T0_SEED_ID, 7), Some(ScoreError::NotAdmin));
    assert_eq!(world.try_set_seed(&world.admin, T0_SEED_ID, 0), Some(ScoreError::ZeroSeed));
    assert_eq!(
        world.try_set_seed(&world.admin, T0_SEED_ID + 1, 7),
        Some(ScoreError::SeedInactive)
    );
    assert_eq!(
        world.try_set_seed(&world.admin, T0_SEED_ID - ACTIVE_EPOCHS, 7),
        Some(ScoreError::SeedInactive)
    );
    assert_eq!(world.try_set_seed(&world.admin, T0_SEED_ID - ACTIVE_EPOCHS + 1, 7), None);
    assert_eq!(world.try_set_seed(&world.admin, T0_SEED_ID, 7), None);
    assert_eq!(world.view(|score, _| score.seed(T0_SEED_ID)), Some(7));
}

#[test]
fn derive_seed_matches_spec() {
    let tx_hash = [0xABu8; 32];
    let mut preimage = tx_hash.to_vec();
    preimage.extend_from_slice(&123_456u32.to_le_bytes());
    let hash = sha256_bytes(&preimage);
    let expected = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);
    let world = setup();
    let derived = world.view(move |_, _| derive_seed(&tx_hash, 123_456));
    assert_eq!(derived, expected);
    assert_ne!(ZERO_SEED_FALLBACK, 0);
}

// ---------------------------------------------------------------------------
// Claim message and pubkey account address.

#[test]
fn claim_message_view_matches_local_digest() {
    let world = setup();
    let tape_hash = sha256_bytes(&SHORT.bytes());
    let digest = world.view(move |score, _| score.claim_message(T0_SEED_ID, &tape_hash));
    let expected = sha256_bytes(&claim::claim_preimage(
        &world.network_hash,
        &*world.score,
        T0_SEED_ID,
        &tape_hash,
    ));
    assert_eq!(digest, expected);

    let player = Player::new(17);
    let pubkey = player.pubkey();
    let address = world.view(move |score, _| score.player_address(&pubkey));
    assert_eq!(address, player.address());
}

#[test]
fn claim_and_address_vectors_match_shared_ts() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../shared/thruput/claim-vectors.json");
    let text = std::fs::read_to_string(&path).expect("shared/thruput/claim-vectors.json");
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    let hex32 = |v: &serde_json::Value| -> [u8; 32] {
        let s = v.as_str().unwrap().trim_start_matches("0x");
        ::hex::decode(s).unwrap().try_into().unwrap()
    };

    for case in json["addresses"].as_array().unwrap() {
        let pubkey = hex32(&case["pubkey"]);
        let preimage = claim::pubkey_account_preimage(&pubkey);
        let address = sha256_bytes(&preimage);
        assert_eq!(address, hex32(&case["address"]), "address for {}", case["pubkey"]);
    }

    for case in json["claims"].as_array().unwrap() {
        let tape = std::fs::read(fixtures_dir().join(case["tape"].as_str().unwrap())).unwrap();
        let tape_hash = sha256_bytes(&tape);
        assert_eq!(tape_hash, hex32(&case["tapeHash"]));
        let preimage = claim::claim_preimage(
            &hex32(&case["networkHash"]),
            &hex32(&case["scoreContract"]),
            case["seedId"].as_u64().unwrap() as u32,
            &tape_hash,
        );
        assert_eq!(::hex::encode(preimage), case["preimage"].as_str().unwrap().trim_start_matches("0x"));
        let digest = sha256_bytes(&preimage);
        assert_eq!(digest, hex32(&case["digest"]));

        // The signature in the vector verifies under the vector's key.
        let secret = hex32(&case["secretKey"]);
        let key = ed25519_dalek::SigningKey::from_bytes(&secret);
        assert_eq!(key.verifying_key().to_bytes(), hex32(&case["pubkey"]));
        let sig = ::hex::decode(case["signature"].as_str().unwrap().trim_start_matches("0x")).unwrap();
        use ed25519_dalek::Signer;
        assert_eq!(key.sign(&digest).to_bytes().to_vec(), sig);
    }
}

// ---------------------------------------------------------------------------
// Token.

#[test]
fn only_the_score_contract_can_mint() {
    let world = setup();
    let token = world.token;
    let receiver = ContractAddress::named("anyone");
    let err = world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || ERC20Client::new(&token).mint(&receiver, 5))
        })
        .assert_abort_as::<ERC20Error>();
    assert_eq!(err, ERC20Error::MustBeContractOwner);

    assert_eq!(
        world.view(move |_, _| KalienTokenAdminClient::new(&token).administrator()),
        world.score
    );

    // The old admin can no longer move administration either.
    let err = world.transact(|tx| {
            tx.call(&world.admin).run(move || {
                KalienTokenAdminClient::new(&token).set_administrator(&receiver)
            })
        })
        .assert_abort_as::<KalienTokenError>();
    assert_eq!(err, KalienTokenError::NotAdministrator);

    let err = world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || ERC20Client::new(&token).initialize(&receiver))
        })
        .assert_abort_as::<ERC20Error>();
    assert_eq!(err, ERC20Error::AlreadyInitialized);
}

#[test]
fn token_metadata_and_transfer() {
    let world = setup();
    world.set_seed(T0_SEED_ID, SHORT.seed);
    let player = Player::new(18);
    world.submit_ok(&player, T0_SEED_ID, &SHORT.bytes());

    let token = world.token;
    let (name, symbol, decimals) = world.view(move |_, _| {
        let meta = kalien_token::ERC20MetadataClient::new(&token);
        (meta.name().unwrap().to_string(), meta.symbol().unwrap().to_string(), meta.decimals())
    });
    assert_eq!(name, "Kalien");
    assert_eq!(symbol, "KALIEN");
    assert_eq!(decimals, Some(7));

    // The player's pubkey account can transfer what it earned.
    let friend = ContractAddress::named("friend");
    world.transact(|tx| {
            tx.call(&player.address())
                .run(move || ERC20Client::new(&token).transfer(&friend, 480 * UNITS_PER_POINT))
        })
        .assert_success();
    assert_eq!(world.balance(&friend), 480 * UNITS_PER_POINT);
    assert_eq!(world.balance(&player.address()), 1_000 * UNITS_PER_POINT);
}

#[test]
fn score_admin_can_be_moved() {
    let world = setup();
    let score = world.score;
    let new_admin = ContractAddress::named("new_admin");
    world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || KalienScoreClient::new(&score).set_admin(&new_admin))
        })
        .assert_success();
    assert_eq!(world.view(|score, _| score.config()).admin, new_admin);
    assert_eq!(world.try_set_seed(&world.admin, T0_SEED_ID, 5), Some(ScoreError::NotAdmin));
    assert_eq!(world.try_set_seed(&new_admin, T0_SEED_ID, 5), None);

    let token = world.token;
    let err = world.transact(|tx| {
            tx.call(&world.admin)
                .run(move || KalienScoreClient::new(&score).initialize(&new_admin, &token))
        })
        .assert_abort_as::<ScoreError>();
    assert_eq!(err, ScoreError::AlreadyInitialized);
}
