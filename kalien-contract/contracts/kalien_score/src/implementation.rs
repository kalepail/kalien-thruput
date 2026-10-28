//! Kalien score contract: replays Asteroids tapes on-chain, keeps the best
//! score per player per seed epoch, and mints the KALIEN improvement.

use thruput_sdk::storage::{Map, Value};
use thruput_sdk::*;
use thruput_sdk::crypto::{sha256, verify_signature_ed25519};
use kalien_token::KalienTokenAdminClient;
use thruput_erc20_if::ERC20Client;

use crate::claim::{claim_digest, pubkey_account_address};
use crate::replay::{Replayed, replay_tape, tape_summary};

/// Seconds per seed epoch.
pub const EPOCH_SECONDS: u64 = 600;
/// Epochs a seed stays active: the current one and the previous 143 (24 h).
pub const ACTIVE_EPOCHS: u32 = 144;
/// Longest tape the contract accepts, in frames.
pub const MAX_FRAMES: u32 = 36_000;
/// KALIEN base units minted per point of score improvement (7 decimals).
pub const UNITS_PER_POINT: i128 = 10_000_000;
/// Most relays the allowlist holds.
pub const MAX_RELAYS: usize = 8;
/// Seed used when the derived word is zero (the sim cannot use seed 0).
pub const ZERO_SEED_FALLBACK: u32 = 0xDEAD_BEEF;

const NANOS_PER_SECOND: u64 = 1_000_000_000;

#[thruput_sdk::storage]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct KalienScore {
    config: Value<Config>,
    seeds: Map<u32, Value<u32>>,
    best: Map<ContractAddress, Map<u32, Value<u32>>>,
    /// `sha256(tape)` -> the `seed_id` it was accepted for.
    claimed: Map<[u8; 32], Value<u32>>,
    relays: Value<RelaySet>,
}

/// The relay allowlist: the first `count` entries of `relays` are allowed.
#[contract_type]
#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct RelaySet {
    pub count: u32,
    pub relays: [ContractAddress; MAX_RELAYS],
}

impl RelaySet {
    fn empty() -> Self {
        Self {
            count: 0,
            relays: [ContractAddress::new([0; 32]); MAX_RELAYS],
        }
    }

    fn active(&self) -> &[ContractAddress] {
        &self.relays[..self.count as usize]
    }

    fn contains(&self, relay: &ContractAddress) -> bool {
        self.active().contains(relay)
    }
}

/// What `prune_run` / `prune_seed` deleted.
#[contract_type]
#[derive(Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct Pruned {
    pub best: bool,
    pub claimed: bool,
    pub seed: bool,
}

#[contract_type]
#[derive(Clone)]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct Config {
    pub admin: ContractAddress,
    pub token: ContractAddress,
    pub paused: bool,
    /// Only allowed relays may call `submit_score` (stops direct-call spam that
    /// would drain the contract's storage deposits).
    pub relay_only: bool,
    /// `set_seed` is disabled for good (`lock_seeding`).
    pub seeding_locked: bool,
}

#[contract_type]
#[derive(Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct SeedInfo {
    pub seed_id: u32,
    pub seed: u32,
}

#[contract_type]
#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct ScoreReceipt {
    pub player: ContractAddress,
    pub seed_id: u32,
    pub seed: u32,
    pub frame_count: u32,
    pub final_score: u32,
    pub previous_best: u32,
    pub minted_delta: i128,
    pub tape_hash: [u8; 32],
}

#[contract_exception]
#[derive(Clone, Copy)]
pub enum ScoreError {
    AlreadyInitialized = 1,
    NotAdmin = 2,
    Paused = 3,
    UnknownSeed = 4,
    SeedInactive = 5,
    SeedMismatch = 6,
    BadSignature = 7,
    AlreadyClaimed = 8,
    ZeroScore = 9,
    NotImproved = 10,
    SeedAlreadySet = 11,
    ZeroSeed = 12,
    SeedingLocked = 13,
    NotRelay = 14,
    RelaySetFull = 15,
    SeedNotExpired = 16,
    TapeTooShort = 20,
    TapeBadMagic = 21,
    TapeBadVersion = 22,
    TapeBadRulesTag = 23,
    TapeReservedNonZero = 24,
    TapeFrameCountOutOfRange = 25,
    TapeLengthMismatch = 26,
    TapeCrcMismatch = 27,
    TapeBadPadding = 28,
    RuleViolation = 30,
    FrameCountMismatch = 31,
    ScoreMismatch = 32,
}

/// One accepted score submission.
#[derive(Event, Clone, Debug)]
pub struct ScoreSubmitted {
    #[topic]
    pub player: ContractAddress,
    #[topic]
    pub seed_id: u32,
    pub player_pubkey: [u8; 32],
    /// The account that submitted the transaction (a relay in relay-only mode).
    pub relay: ContractAddress,
    /// Block time, unix seconds (the RPC has no block-time lookup).
    pub submitted_at: u64,
    pub seed: u32,
    pub frame_count: u32,
    pub final_score: u32,
    pub previous_best: u32,
    pub new_best: u32,
    pub minted_delta: i128,
    pub tape_hash: [u8; 32],
}

/// The seed for an epoch was created.
#[derive(Event, Clone, Debug)]
pub struct SeedCreated {
    #[topic]
    pub seed_id: u32,
    pub seed: u32,
}

/// `paused`, `relay_only` or `seeding_locked` changed; the payload is the new state.
#[derive(Event, Clone, Debug)]
pub struct SettingsChanged {
    pub paused: bool,
    pub relay_only: bool,
    pub seeding_locked: bool,
}

/// A relay was allowed or removed.
#[derive(Event, Clone, Debug)]
pub struct RelayChanged {
    #[topic]
    pub relay: ContractAddress,
    pub allowed: bool,
}

/// The token's mint authority moved to another contract (`handover_token`).
#[derive(Event, Clone, Debug)]
pub struct TokenHandedOver {
    #[topic]
    pub token: ContractAddress,
    #[topic]
    pub new_administrator: ContractAddress,
}

/// The admin changed.
#[derive(Event, Clone, Debug)]
pub struct AdminChanged {
    #[topic]
    pub previous: ContractAddress,
    #[topic]
    pub admin: ContractAddress,
}

/// The epoch that contains the current block.
pub fn current_seed_id() -> u32 {
    let nanos: u64 = *get_block_timepoint();
    (nanos / NANOS_PER_SECOND / EPOCH_SECONDS) as u32
}

/// `seed_id` is the current epoch or one of the previous `ACTIVE_EPOCHS - 1`.
pub fn is_active(seed_id: u32, current: u32) -> bool {
    seed_id <= current && current - seed_id < ACTIVE_EPOCHS
}

/// `seed_id` is in the past and out of the active window for good.
pub fn is_expired(seed_id: u32, current: u32) -> bool {
    seed_id <= current && current - seed_id >= ACTIVE_EPOCHS
}

/// Block time in unix seconds.
fn block_seconds() -> u64 {
    *get_block_timepoint() / NANOS_PER_SECOND
}

/// `sha256(source_tx_hash || seed_id u32 LE || block_height i64 LE ||
/// block_timepoint_ns u64 LE)`, first 4 bytes LE; 0 maps to `ZERO_SEED_FALLBACK`.
///
/// The caller picks the transaction hash, so it alone could be ground offline
/// to choose a seed. The block height and nanosecond timepoint are fixed by
/// the block producer when the transaction lands, so a caller cannot know the
/// seed in advance.
pub fn derive_seed(
    source_tx_hash: &[u8; 32],
    seed_id: u32,
    block_height: i64,
    block_timepoint_ns: u64,
) -> u32 {
    let mut preimage = [0u8; 52];
    preimage[..32].copy_from_slice(source_tx_hash);
    preimage[32..36].copy_from_slice(&seed_id.to_le_bytes());
    preimage[36..44].copy_from_slice(&block_height.to_le_bytes());
    preimage[44..].copy_from_slice(&block_timepoint_ns.to_le_bytes());
    let hash = sha256(&preimage);
    let word = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);
    if word == 0 { ZERO_SEED_FALLBACK } else { word }
}

impl KalienScore {
    fn _config(&self) -> Config {
        self.config.get()
    }

    fn _require_admin(&self) -> Config {
        let config = self._config();
        ensure(get_caller() == config.admin, ScoreError::NotAdmin);
        config
    }

    fn _stored_seed(&self, seed_id: u32) -> Option<u32> {
        self.seeds.at(&seed_id).try_get().none_if_missing()
    }

    fn _best(&self, player: &ContractAddress, seed_id: u32) -> u32 {
        self.best
            .at(player)
            .at(&seed_id)
            .try_get()
            .none_if_missing()
            .unwrap_or(0)
    }

    fn _relay_set(&self) -> RelaySet {
        self.relays
            .try_get()
            .none_if_missing()
            .unwrap_or_else(RelaySet::empty)
    }

    fn _settings_changed(config: &Config) {
        log_event(&SettingsChanged {
            paused: config.paused,
            relay_only: config.relay_only,
            seeding_locked: config.seeding_locked,
        });
    }

    fn _is_claimed(&self, tape_hash: &[u8; 32]) -> bool {
        self._claimed_seed_id(tape_hash).is_some()
    }

    fn _claimed_seed_id(&self, tape_hash: &[u8; 32]) -> Option<u32> {
        self.claimed.at(tape_hash).try_get().none_if_missing()
    }
}

#[contract(
    client = KalienScoreClient,
    throws = ScoreError,
    emits(ScoreSubmitted, SeedCreated, SettingsChanged, RelayChanged, AdminChanged, TokenHandedOver)
)]
impl KalienScore {
    /// One-time setup. Call it atomically with deployment.
    pub fn initialize(&mut self, admin: &ContractAddress, token: &ContractAddress) {
        if self.config.try_get().none_if_missing().is_some() {
            throw(ScoreError::AlreadyInitialized);
        }
        self.config.set(&Config {
            admin: *admin,
            token: *token,
            paused: false,
            relay_only: false,
            seeding_locked: false,
        });
    }

    /// Create the current epoch's seed if it does not exist, and return it.
    /// Anyone may call this; the Worker cron calls it every epoch.
    pub fn ensure_current_seed(&mut self) -> SeedInfo {
        let seed_id = current_seed_id();
        if let Some(seed) = self._stored_seed(seed_id) {
            return SeedInfo { seed_id, seed };
        }
        let source: [u8; 32] = *get_source_transaction_hash();
        let height: i64 = *get_block_height();
        let timepoint: u64 = *get_block_timepoint();
        let seed = derive_seed(&source, seed_id, height, timepoint);
        self.seeds.at_mut(&seed_id).set(&seed);
        log_event(&SeedCreated { seed_id, seed });
        SeedInfo { seed_id, seed }
    }

    /// Admin only: fix the seed of an active epoch that has no seed yet.
    /// Futurenet uses this to replay fixture tapes, whose seeds are fixed.
    pub fn set_seed(&mut self, seed_id: u32, seed: u32) {
        let config = self._require_admin();
        ensure(!config.seeding_locked, ScoreError::SeedingLocked);
        ensure(is_active(seed_id, current_seed_id()), ScoreError::SeedInactive);
        ensure(self._stored_seed(seed_id).is_none(), ScoreError::SeedAlreadySet);
        ensure(seed != 0, ScoreError::ZeroSeed);
        self.seeds.at_mut(&seed_id).set(&seed);
        log_event(&SeedCreated { seed_id, seed });
    }

    /// The current epoch's seed, if it was created.
    pub fn current_seed(&self) -> Option<SeedInfo> {
        let seed_id = current_seed_id();
        self._stored_seed(seed_id).map(|seed| SeedInfo { seed_id, seed })
    }

    /// The epoch that contains the current block.
    pub fn current_seed_id(&self) -> u32 {
        current_seed_id()
    }

    /// The stored seed for `seed_id`, if it was created.
    pub fn seed(&self, seed_id: u32) -> Option<u32> {
        self._stored_seed(seed_id)
    }

    /// Whether `seed_id` is inside the active window now.
    pub fn is_seed_active(&self, seed_id: u32) -> bool {
        is_active(seed_id, current_seed_id())
    }

    /// Verify, replay, and record one run. Mints the improvement over the
    /// player's previous best for `seed_id` to the player's pubkey account.
    ///
    /// `signature` is the player's Ed25519 signature over
    /// `claim_digest(network_hash, this_contract, seed_id, sha256(tape))`,
    /// so the relay that submits cannot redirect the reward.
    pub fn submit_score(
        &mut self,
        player_pubkey: &[u8; 32],
        seed_id: u32,
        tape: &[u8],
        signature: &[u8; 64],
    ) -> ScoreReceipt {
        let config = self._config();
        ensure(!config.paused, ScoreError::Paused);
        let caller = get_caller();
        if config.relay_only {
            ensure(self._relay_set().contains(&caller), ScoreError::NotRelay);
        }

        let stored_seed = self._stored_seed(seed_id).unwrap_or_else(|| throw(ScoreError::UnknownSeed));
        ensure(is_active(seed_id, current_seed_id()), ScoreError::SeedInactive);

        // Cheap container checks before any expensive work.
        let summary = tape_summary(tape, MAX_FRAMES).unwrap_or_else(|err| throw(err));
        ensure(summary.seed == stored_seed, ScoreError::SeedMismatch);
        ensure(summary.final_score > 0, ScoreError::ZeroScore);

        let player = pubkey_account_address(player_pubkey);
        let previous_best = self._best(&player, seed_id);
        ensure(summary.final_score > previous_best, ScoreError::NotImproved);

        let tape_hash: [u8; 32] = *sha256(tape);
        ensure(!self._is_claimed(&tape_hash), ScoreError::AlreadyClaimed);

        let network: [u8; 32] = **get_network_hash();
        let contract: [u8; 32] = *get_current_address();
        let digest = claim_digest(&network, &contract, seed_id, &tape_hash);
        ensure(
            verify_signature_ed25519(
                &Ed25519PublicKey::from(*player_pubkey),
                &Ed25519Signature::from(*signature),
                &digest,
            ),
            ScoreError::BadSignature,
        );

        let Replayed {
            seed,
            frame_count,
            final_score,
        } = replay_tape(tape, MAX_FRAMES).unwrap_or_else(|err| throw(err));

        self.best.at_mut(&player).at_mut(&seed_id).set(&final_score);
        self.claimed.at_mut(&tape_hash).set(&seed_id);

        let minted_delta = (final_score - previous_best) as i128 * UNITS_PER_POINT;
        ERC20Client::new(&config.token).mint(&player, minted_delta);

        log_event(&ScoreSubmitted {
            player,
            seed_id,
            player_pubkey: *player_pubkey,
            relay: caller,
            submitted_at: block_seconds(),
            seed,
            frame_count,
            final_score,
            previous_best,
            new_best: final_score,
            minted_delta,
            tape_hash,
        });

        ScoreReceipt {
            player,
            seed_id,
            seed,
            frame_count,
            final_score,
            previous_best,
            minted_delta,
            tape_hash,
        }
    }

    /// The best recorded score of `player` for `seed_id` (0 if none).
    pub fn best_score(&self, player: &ContractAddress, seed_id: u32) -> u32 {
        self._best(player, seed_id)
    }

    /// The `seed_id` a tape (by `sha256(tape)`) was accepted for, if any.
    pub fn claimed_seed_id(&self, tape_hash: &[u8; 32]) -> Option<u32> {
        self._claimed_seed_id(tape_hash)
    }

    /// Anyone: delete the stored best and tape hash of one run whose epoch has
    /// left the active window for good. The storage deposits return to this
    /// contract. Afterwards `best_score` for that epoch reads 0; the indexer
    /// keeps the history.
    pub fn prune_run(
        &mut self,
        player: &ContractAddress,
        seed_id: u32,
        tape_hash: &[u8; 32],
    ) -> Pruned {
        ensure(is_expired(seed_id, current_seed_id()), ScoreError::SeedNotExpired);
        let mut pruned = Pruned {
            best: false,
            claimed: false,
            seed: false,
        };
        let mut player_bests = self.best.at_mut(player);
        if player_bests.at(&seed_id).try_get().none_if_missing().is_some() {
            player_bests.delete_at(&seed_id);
            pruned.best = true;
        }
        if self._claimed_seed_id(tape_hash) == Some(seed_id) {
            self.claimed.delete_at(tape_hash);
            pruned.claimed = true;
        }
        pruned
    }

    /// Anyone: delete the seed of an expired epoch (refunds its deposit).
    pub fn prune_seed(&mut self, seed_id: u32) -> Pruned {
        ensure(is_expired(seed_id, current_seed_id()), ScoreError::SeedNotExpired);
        let present = self._stored_seed(seed_id).is_some();
        if present {
            self.seeds.delete_at(&seed_id);
        }
        Pruned {
            best: false,
            claimed: false,
            seed: present,
        }
    }

    /// Admin: give the token's mint authority to `new_administrator` (for
    /// example a later score contract), so a redeploy keeps the same token and
    /// balances. This contract can no longer mint afterwards.
    pub fn handover_token(&mut self, new_administrator: &ContractAddress) {
        let config = self._require_admin();
        KalienTokenAdminClient::new(&config.token).set_administrator(new_administrator);
        log_event(&TokenHandedOver {
            token: config.token,
            new_administrator: *new_administrator,
        });
    }

    /// Whether a tape with this `sha256(tape)` was already accepted.
    pub fn is_claimed(&self, tape_hash: &[u8; 32]) -> bool {
        self._is_claimed(tape_hash)
    }

    /// The pubkey account address (nonce 0) that receives rewards for
    /// `player_pubkey`.
    pub fn player_address(&self, player_pubkey: &[u8; 32]) -> ContractAddress {
        pubkey_account_address(player_pubkey)
    }

    /// The 32-byte digest the player signs for a submission.
    pub fn claim_message(&self, seed_id: u32, tape_hash: &[u8; 32]) -> [u8; 32] {
        let network: [u8; 32] = **get_network_hash();
        let contract: [u8; 32] = *get_current_address();
        claim_digest(&network, &contract, seed_id, tape_hash)
    }

    pub fn config(&self) -> Config {
        self._config()
    }

    pub fn set_paused(&mut self, paused: bool) {
        let mut config = self._require_admin();
        config.paused = paused;
        self.config.set(&config);
        Self::_settings_changed(&config);
    }

    /// Admin: when on, only allowed relays may call `submit_score`.
    pub fn set_relay_only(&mut self, relay_only: bool) {
        let mut config = self._require_admin();
        config.relay_only = relay_only;
        self.config.set(&config);
        Self::_settings_changed(&config);
    }

    /// Admin: allow a relay (at most `MAX_RELAYS`). Adding one twice changes nothing.
    pub fn add_relay(&mut self, relay: &ContractAddress) {
        self._require_admin();
        let mut set = self._relay_set();
        if set.contains(relay) {
            return;
        }
        ensure((set.count as usize) < MAX_RELAYS, ScoreError::RelaySetFull);
        set.relays[set.count as usize] = *relay;
        set.count += 1;
        self.relays.set(&set);
        log_event(&RelayChanged {
            relay: *relay,
            allowed: true,
        });
    }

    /// Admin: remove a relay. Removing an unknown address changes nothing.
    pub fn remove_relay(&mut self, relay: &ContractAddress) {
        self._require_admin();
        let mut set = self._relay_set();
        let Some(index) = set.active().iter().position(|r| r == relay) else {
            return;
        };
        let last = set.count as usize - 1;
        set.relays[index] = set.relays[last];
        set.relays[last] = ContractAddress::new([0; 32]);
        set.count -= 1;
        self.relays.set(&set);
        log_event(&RelayChanged {
            relay: *relay,
            allowed: false,
        });
    }

    /// Whether `relay` may submit while `relay_only` is on.
    pub fn is_relay(&self, relay: &ContractAddress) -> bool {
        self._relay_set().contains(relay)
    }

    /// The relay allowlist (the first `count` entries).
    pub fn relays(&self) -> RelaySet {
        self._relay_set()
    }

    /// Admin: disable `set_seed` for good. After this, only `ensure_current_seed`
    /// creates seeds, and the admin can no longer choose one.
    pub fn lock_seeding(&mut self) {
        let mut config = self._require_admin();
        config.seeding_locked = true;
        self.config.set(&config);
        Self::_settings_changed(&config);
    }

    pub fn set_admin(&mut self, admin: &ContractAddress) {
        let mut config = self._require_admin();
        let previous = config.admin;
        config.admin = *admin;
        self.config.set(&config);
        log_event(&AdminChanged {
            previous,
            admin: *admin,
        });
    }
}
