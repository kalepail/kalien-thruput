mod common;

use sdk::*;
use std::path::PathBuf;
use std::time::Instant;

use gas_probe::{ContractClient, ReplayFailed};

static NONCE: SHA256Hash = sdk::sha256_static!("GAS_PROBE_RV32_NONCE");

fn thruput_artifact(file_name: &str) -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("target"))
        .join("thruput")
        .join(file_name)
}

/// Runs `f` against a freshly deployed RV32 probe inside one transaction.
fn with_probe(label: &str, f: impl FnOnce(&ContractClient) + std::panic::UnwindSafe + 'static) {
    let contract = load_rv32_contract(thruput_artifact("gas_probe.rv32a"));
    let env = TestEnvironment::no_cost();
    let contract_hash = env.setup_create_contract(&contract);
    let call_addr = ContractAddress::named(label);

    env.transact(|tx| {
        tx.call(&call_addr).run(move || {
            let address = deploy_contract(&NONCE, &contract_hash);
            f(&ContractClient::new(&address));
        })
    })
    .assert_success();
}

/// Gas used by `call`, measured from the transaction's remaining gas.
fn gas_of<T>(call: impl FnOnce() -> T) -> (T, u64, f64) {
    let before = sdk::stats::gas_remaining();
    let started = Instant::now();
    let value = call();
    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
    let after = sdk::stats::gas_remaining();
    (value, before - after, elapsed)
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replay_gas_table() {
    with_probe("gas_probe_rv32_table", |client| {
        println!(
            "| tape | frames | bytes | noop gas | parse gas | replay gas | replay-parse gas/frame | wall ms |"
        );
        println!("|---|---:|---:|---:|---:|---:|---:|---:|");
        for fixture in &common::FIXTURES {
            let tape = common::load(fixture);
            let (len, noop_gas, _) = gas_of(|| client.noop(&tape));
            assert_eq!(len as usize, tape.len());
            let (frames, parse_gas, _) = gas_of(|| client.parse_only(&tape));
            assert_eq!(frames, fixture.frames, "{}", fixture.name);
            let (score, replay_gas, wall_ms) = gas_of(|| client.replay(&tape));
            assert_eq!(score, fixture.score, "{}", fixture.name);
            println!(
                "| {} | {} | {} | {} | {} | {} | {:.0} | {:.1} |",
                fixture.name,
                fixture.frames,
                tape.len(),
                noop_gas,
                parse_gas,
                replay_gas,
                (replay_gas - parse_gas) as f64 / fixture.frames as f64,
                wall_ms
            );
        }
    });
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_replay_rejects_tampered_tapes() {
    with_probe("gas_probe_rv32_bad", |client| {
        let mut tape = common::load(&common::FIXTURES[0]);
        let len = tape.len();
        tape[len - 8] ^= 1;
        assert_eq!(
            client.try_replay(&tape).unwrap_err().try_as(),
            Some(ReplayFailed { code: 11, detail: 0 }),
        );
        tape[len - 8] ^= 1;
        tape[20] ^= 1;
        assert_eq!(
            client.try_replay(&tape).unwrap_err().try_as(),
            Some(ReplayFailed { code: 8, detail: 0 }),
        );
    });
}

#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_memory_table() {
    with_probe("gas_probe_rv32_memory", |client| {
        println!("| tape | bytes | heap used | stack used | heap base | stack top |");
        println!("|---|---:|---:|---:|---:|---:|");
        for fixture in &common::FIXTURES {
            let tape = common::load(fixture);
            let [score, heap, stack, heap_base, stack_top] = client.memory_probe(&tape);
            assert_eq!(score, fixture.score, "{}", fixture.name);
            println!(
                "| {} | {} | {heap} | {stack} | {heap_base} | {stack_top} |",
                fixture.name,
                tape.len()
            );
        }
    });
}
