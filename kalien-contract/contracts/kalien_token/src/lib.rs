//! KALIEN reward token for Kalien on Thruput.

#![cfg_attr(not(feature = "dev"), no_std)]

sdk::declare_mock_contract!();

mod implementation;

pub use implementation::{
    AdministratorChanged, Config, DECIMALS, KalienToken, KalienTokenAdmin,
    KalienTokenAdminClient, KalienTokenError, NAME, SYMBOL,
};
pub use thruput_erc20_if::{ERC20, ERC20Client, ERC20Error, MintEvent, TransferEvent};
pub use thruput_erc20_metadata_if::ERC20MetadataClient;
