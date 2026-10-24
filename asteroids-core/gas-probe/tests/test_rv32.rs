mod common;

use thruput_sdk::*;
use std::path::PathBuf;
use std::time::Instant;

use gas_probe::{ContractClient, ReplayFailed};

static NONCE: SHA256Hash = thruput_sdk::sha256_static!("GAS_PROBE_RV32_NONCE");

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
    let before = thruput_sdk::stats::gas_remaining();
    let started = Instant::now();
    let value = call();
    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
    let after = thruput_sdk::stats::gas_remaining();
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

/// Measures replay gas for every `.tape` in `$GAS_SWEEP_DIR` and writes
/// `file,frames,score,gas,gas_per_frame` lines to `$GAS_SWEEP_OUT` (default stdout).
/// Rejected tapes get `rejected:<code>` in the score column and are not counted.
/// Run: `GAS_SWEEP_DIR=<dir> GAS_SWEEP_OUT=<csv> thruput test --match-test rv32_gas_sweep`.
#[test]
#[ignore = "requires RV32 build — run via `thruput test`"]
fn rv32_gas_sweep() {
    let Some(dir) = std::env::var_os("GAS_SWEEP_DIR") else {
        eprintln!("GAS_SWEEP_DIR not set; nothing to measure");
        return;
    };
    let out = std::env::var_os("GAS_SWEEP_OUT");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("read GAS_SWEEP_DIR")
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "tape"))
        .collect();
    paths.sort();
    with_probe("gas_probe_rv32_sweep", move |client| {
        let mut lines = vec!["file,frames,score,gas,gas_per_frame".to_string()];
        for path in &paths {
            let tape = std::fs::read(path).unwrap();
            let frames = if tape.len() >= 16 {
                u32::from_le_bytes([tape[12], tape[13], tape[14], tape[15]])
            } else {
                0
            };
            let (result, gas, _) = gas_of(|| client.try_replay(&tape));
            let name = path.file_name().unwrap().to_string_lossy();
            let line = match result {
                Ok(score) => format!(
                    "{name},{frames},{score},{gas},{:.1}",
                    gas as f64 / frames.max(1) as f64
                ),
                Err(err) => {
                    let code = err.try_as::<ReplayFailed>().map(|f| f.code).unwrap_or(0);
                    format!("{name},{frames},rejected:{code},{gas},")
                }
            };
            lines.push(line);
        }
        let text = lines.join("\n") + "\n";
        match &out {
            Some(path) => std::fs::write(path, text).expect("write GAS_SWEEP_OUT"),
            None => print!("{text}"),
        }
    });
}
