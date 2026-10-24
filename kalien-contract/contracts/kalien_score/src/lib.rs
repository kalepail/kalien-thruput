//! Kalien score contract for Thruput.

#![cfg_attr(not(feature = "dev"), no_std)]

sdk::declare_mock_contract!();

pub mod claim;
mod implementation;
pub mod replay;

pub use implementation::{
    ACTIVE_EPOCHS, AdminChanged, Config, EPOCH_SECONDS, KalienScore, KalienScoreClient,
    MAX_FRAMES, MAX_RELAYS, Pruned, RelayChanged, RelaySet, TokenHandedOver, ScoreError, SettingsChanged, ScoreReceipt, ScoreSubmitted, SeedCreated, SeedInfo,
    UNITS_PER_POINT, ZERO_SEED_FALLBACK, current_seed_id, derive_seed, is_active, is_expired,
};
