//! Shared setup for the native score-contract tests.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

use kalien_score::{KalienScoreClient, ScoreError, ScoreReceipt, claim};
use kalien_token::{ERC20Client, KalienTokenAdminClient};
use sdk::*;

pub static TOKEN_NONCE: SHA256Hash = sdk::sha256_static!("KALIEN_TOKEN_TEST_NONCE");
pub static SCORE_NONCE: SHA256Hash = sdk::sha256_static!("KALIEN_SCORE_TEST_NONCE");

/// 2027-01-15T08:00:00Z, at the start of an epoch.
pub const T0_SECONDS: u64 = 1_800_000_000 - (1_800_000_000 % 600);
pub const T0_SEED_ID: u32 = (T0_SECONDS / 600) as u32;

pub const SHORT: Fixture = Fixture {
    file: "test-short.tape",
    seed: 0xDEAD_BEEF,
    frames: 700,
    score: 1_480,
};
pub const MEDIUM: Fixture = Fixture {
    file: "test-medium.tape",
    seed: 0xDEAD_BEEF,
    frames: 5_000,
    score: 11_190,
};
pub const REAL_GAME: Fixture = Fixture {
    file: "test-real-game.tape",
    seed: 0x43C9_C6CD,
    frames: 6_643,
    score: 14_870,
};
pub const LONG: Fixture = Fixture {
    file: "test-long.tape",
    seed: 0x7F80_916E,
    frames: 36_000,
    score: 92_820,
};
pub const MAX_GAME: Fixture = Fixture {
    file: "kalien-911140-seed1598125870.tape",
    seed: 1_598_125_870,
    frames: 36_000,
    score: 911_140,
};

#[derive(Clone, Copy, Debug)]
pub struct Fixture {
    pub file: &'static str,
    pub seed: u32,
    pub frames: u32,
    pub score: u32,
}

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

impl Fixture {
    pub fn bytes(&self) -> Vec<u8> {
        std::fs::read(fixtures_dir().join(self.file)).unwrap()
    }
}

pub fn seconds_to_timepoint(seconds: u64) -> TimePoint {
    TimePoint::from(seconds * 1_000_000_000)
}

pub fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// A test player: an Ed25519 key and its pubkey account address.
pub struct Player {
    pub key: SigningKey,
}

impl Player {
    pub fn new(fill: u8) -> Self {
        Self {
            key: SigningKey::from_bytes(&[fill; 32]),
        }
    }

    pub fn pubkey(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes()
    }

    pub fn address(&self) -> ContractAddress {
        ContractAddress::from(sha256_bytes(&claim::pubkey_account_preimage(&self.pubkey())))
    }

    /// Sign the claim exactly as the browser does: sha256 over the claim
    /// preimage, then Ed25519 over the 32-byte digest.
    pub fn sign(
        &self,
        network_hash: &[u8; 32],
        score: &ContractAddress,
        seed_id: u32,
        tape: &[u8],
    ) -> [u8; 64] {
        let tape_hash = sha256_bytes(tape);
        let preimage = claim::claim_preimage(network_hash, &**score, seed_id, &tape_hash);
        let digest = sha256_bytes(&preimage);
        self.key.sign(&digest).to_bytes()
    }
}

pub struct World {
    pub env: TestEnvironmentHandle,
    /// Pinned chain time in seconds; every transaction closes its block here.
    pub now: std::cell::Cell<u64>,
    pub admin: ContractAddress,
    pub relay: ContractAddress,
    pub token: ContractAddress,
    pub score: ContractAddress,
    pub score_hash: SHA256Hash,
    pub network_hash: [u8; 32],
}

/// Deploy the token and the score contract at `T0_SECONDS`, and hand the
/// token's mint authority to the score contract.
pub fn setup() -> World {
    let env = TestEnvironment::no_cost();
    let token_hash = *kalien_token::register_mock_contract(&env).as_hash();
    let score_hash = *kalien_score::register_mock_contract(&env).as_hash();
    setup_with(env, token_hash, score_hash)
}

/// Deploy the RV32 artifacts from `target/thruput/` instead of the mocks.
pub fn setup_rv32() -> World {
    let dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target"))
        .join("thruput");
    let env = TestEnvironment::no_cost();
    let token_hash = env.setup_create_contract(&load_rv32_contract(dir.join("kalien_token.rv32a")));
    let score_hash = env.setup_create_contract(&load_rv32_contract(dir.join("kalien_score.rv32a")));
    setup_with(env, token_hash, score_hash)
}

pub fn setup_with(env: TestEnvironmentHandle, token_hash: SHA256Hash, score_hash: SHA256Hash) -> World {
    env.advance_block_at(seconds_to_timepoint(T0_SECONDS));
    let admin = ContractAddress::named("admin");
    let relay = ContractAddress::named("relay");

    let out: Arc<Mutex<Option<(ContractAddress, ContractAddress)>>> = Arc::new(Mutex::new(None));
    let out_inner = out.clone();
    env.transact(|tx| {
        tx.call(&admin).run(move || {
            let token = deploy_contract(&TOKEN_NONCE, &token_hash);
            ERC20Client::new(&token).initialize(&admin);
            let score = deploy_contract(&SCORE_NONCE, &score_hash);
            KalienScoreClient::new(&score).initialize(&admin, &token);
            KalienTokenAdminClient::new(&token).set_administrator(&score);
            *out_inner.lock().unwrap() = Some((token, score));
        })
    })
    .assert_success();
    let (token, score) = out.lock().unwrap().unwrap();

    let network_hash: [u8; 32] = **test_network_hash();
    env.advance_block_at(seconds_to_timepoint(T0_SECONDS));
    World {
        env,
        now: std::cell::Cell::new(T0_SECONDS),
        admin,
        relay,
        token,
        score,
        score_hash,
        network_hash,
    }
}

impl World {
    /// Move the chain to `seconds` (must not go back in time).
    pub fn advance_to(&self, seconds: u64) {
        self.now.set(seconds);
        self.env.advance_block_at(seconds_to_timepoint(seconds));
    }

    /// One transaction in its own block: later transactions see its writes.
    pub fn transact(
        &self,
        f: impl FnOnce(&mut MockTransactionHandler) -> FrameResult,
    ) -> TransactResult {
        let result = self.env.transact(f);
        self.env.advance_block_at(seconds_to_timepoint(self.now.get()));
        result
    }

    pub fn set_seed(&self, seed_id: u32, seed: u32) {
        let score = self.score;
        self.transact(|tx| {
                tx.call(&self.admin)
                    .run(move || KalienScoreClient::new(&score).set_seed(seed_id, seed))
            })
            .assert_success();
    }

    /// Run `f` against the score contract client as `caller`, in its own block.
    pub fn score_call<T: WriteXDR>(
        &self,
        caller: &ContractAddress,
        f: impl FnOnce(KalienScoreClient) -> T + std::panic::UnwindSafe,
    ) -> TransactResult {
        let score = self.score;
        self.transact(|tx| tx.call(caller).run(move || f(KalienScoreClient::new(&score))))
    }

    pub fn try_set_seed(
        &self,
        caller: &ContractAddress,
        seed_id: u32,
        seed: u32,
    ) -> Option<ScoreError> {
        let score = self.score;
        let result = self.transact(|tx| {
            tx.call(caller)
                .run(move || KalienScoreClient::new(&score).set_seed(seed_id, seed))
        });
        if result.is_success() {
            None
        } else {
            Some(result.assert_abort_as::<ScoreError>())
        }
    }

    /// Submit through the relay with explicit fields, returning the result.
    pub fn submit_raw(
        &self,
        pubkey: [u8; 32],
        seed_id: u32,
        tape: Vec<u8>,
        signature: [u8; 64],
    ) -> TransactResult {
        let score = self.score;
        self.transact(|tx| {
            tx.call(&self.relay).run(move || {
                KalienScoreClient::new(&score).submit_score(&pubkey, seed_id, &tape, &signature)
            })
        })
    }

    /// Sign and submit a tape for `player`.
    pub fn submit(&self, player: &Player, seed_id: u32, tape: &[u8]) -> TransactResult {
        let signature = player.sign(&self.network_hash, &self.score, seed_id, tape);
        self.submit_raw(player.pubkey(), seed_id, tape.to_vec(), signature)
    }

    pub fn submit_ok(&self, player: &Player, seed_id: u32, tape: &[u8]) -> (TransactResult, ScoreReceipt) {
        let result = self.submit(player, seed_id, tape);
        result.assert_success();
        let receipt = result.assert_return_as::<ScoreReceipt>();
        (result, receipt)
    }

    pub fn submit_err(&self, player: &Player, seed_id: u32, tape: &[u8]) -> ScoreError {
        self.submit(player, seed_id, tape).assert_abort_as::<ScoreError>()
    }

    pub fn view<R: Send + 'static>(
        &self,
        f: impl FnOnce(KalienScoreClient, ERC20Client) -> R + std::panic::UnwindSafe + Send + 'static,
    ) -> R {
        let score = self.score;
        let token = self.token;
        let out: Arc<Mutex<Option<R>>> = Arc::new(Mutex::new(None));
        let out_inner = out.clone();
        let f = std::panic::AssertUnwindSafe(f);
        let caller = ContractAddress::named("viewer");
        self.transact(|tx| {
                tx.call(&caller).run(move || {
                    let f = f;
                    let value = (f.0)(KalienScoreClient::new(&score), ERC20Client::new(&token));
                    *out_inner.lock().unwrap() = Some(value);
                })
            })
            .assert_success();
        let value = out.lock().unwrap().take().unwrap();
        value
    }

    pub fn balance(&self, owner: &ContractAddress) -> i128 {
        let owner = *owner;
        self.view(move |_, token| token.get_balance_of(&owner))
    }

    pub fn best(&self, player: &ContractAddress, seed_id: u32) -> u32 {
        let player = *player;
        self.view(move |score, _| score.best_score(&player, seed_id))
    }
}

/// Build a v4 tape with a valid CRC: `inputs` holds one low nibble per frame.
pub fn build_tape(seed: u32, inputs: &[u8], final_score: u32) -> Vec<u8> {
    let frames = inputs.len();
    let body_len = frames.div_ceil(2);
    let mut tape = vec![0u8; 16 + body_len + 8];
    tape[0..4].copy_from_slice(&0x5A4B_5450u32.to_le_bytes());
    tape[4] = 4;
    tape[5] = 4;
    tape[8..12].copy_from_slice(&seed.to_le_bytes());
    tape[12..16].copy_from_slice(&(frames as u32).to_le_bytes());
    for (i, input) in inputs.iter().enumerate() {
        tape[16 + i / 2] |= (input & 0x0F) << ((i & 1) * 4);
    }
    let body_end = 16 + body_len;
    tape[body_end..body_end + 4].copy_from_slice(&final_score.to_le_bytes());
    let crc = asteroids_verifier_core::tape::crc32(&tape[..body_end]);
    tape[body_end + 4..].copy_from_slice(&crc.to_le_bytes());
    tape
}

/// Recompute the CRC of a (possibly edited) tape so only the edit matters.
pub fn fix_crc(tape: &mut [u8]) {
    let body_end = tape.len() - 8;
    let crc = asteroids_verifier_core::tape::crc32(&tape[..body_end]);
    let len = tape.len();
    tape[len - 4..].copy_from_slice(&crc.to_le_bytes());
}

/// Gas the root frame spent in its child invocations (the contract calls),
/// read from the execution trace.
pub fn child_gas(result: &TransactResult) -> u64 {
    let trace = result.frame().trace().expect("tracing is on in the test executor");
    trace
        .system_calls
        .iter()
        .filter(|call| matches!(call.body, thruput_trace::transaction_trace::SyscallTraceBody::kInvoke { .. }))
        .map(|call| call.gas_remaining_at_start - call.gas_remaining_at_end)
        .sum()
}
