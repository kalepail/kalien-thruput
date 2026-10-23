#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "alloc")]
extern crate alloc;

pub mod constants;
pub mod error;
pub mod fixed_point;
mod fixed_vec;
pub mod rng;
pub mod sim;
pub mod tape;
pub mod verify;

pub use error::{RuleCode, VerifyError};
pub use verify::{verify_tape, VerifiedTape};
