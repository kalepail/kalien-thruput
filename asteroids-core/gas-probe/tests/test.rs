mod common;

use thruput_sdk::*;

use gas_probe::{ContractClient, ReplayFailed, register_mock_contract};

static NONCE: SHA256Hash = thruput_sdk::sha256_static!("GAS_PROBE_NONCE");

#[test]
fn native_replay_matches_fixture_scores() {
    let env = TestEnvironment::no_cost();
    let test_contract = register_mock_contract(&env);
    let contract_hash = *test_contract.as_hash();

    env.transact(|tx| {
        let caller = ContractAddress::named("gas_probe_native");
        tx.call(&caller).run(move || {
            let address = deploy_contract(&NONCE, &contract_hash);
            let client = ContractClient::new(&address);
            for fixture in &common::FIXTURES {
                let tape = common::load(fixture);
                assert_eq!(client.parse_only(&tape), fixture.frames, "{}", fixture.name);
                assert_eq!(client.replay(&tape), fixture.score, "{}", fixture.name);
            }
        })
    })
    .assert_success();
}

#[test]
fn native_replay_rejects_tampered_score() {
    let env = TestEnvironment::no_cost();
    let test_contract = register_mock_contract(&env);
    let contract_hash = *test_contract.as_hash();

    env.transact(|tx| {
        let caller = ContractAddress::named("gas_probe_native_bad");
        tx.call(&caller).run(move || {
            let address = deploy_contract(&NONCE, &contract_hash);
            let client = ContractClient::new(&address);
            let mut tape = common::load(&common::FIXTURES[0]);
            // The CRC covers header + body only, so a changed footer score reaches the replay.
            let len = tape.len();
            tape[len - 8] ^= 1;
            assert_eq!(
                client.try_replay(&tape).unwrap_err().try_as(),
                Some(ReplayFailed { code: 11, detail: 0 }),
            );
            // A changed input nibble breaks the CRC.
            tape[len - 8] ^= 1;
            tape[20] ^= 1;
            assert_eq!(
                client.try_replay(&tape).unwrap_err().try_as(),
                Some(ReplayFailed { code: 8, detail: 0 }),
            );
        })
    })
    .assert_success();
}
