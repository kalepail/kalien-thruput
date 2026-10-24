//! Byte layouts that the browser, the Worker and the CLI must reproduce
//! exactly. `shared/thruput/claim.ts` mirrors this file; the test vectors in
//! `shared/thruput/claim-vectors.json` pin the two together.

use thruput_sdk::ContractAddress;
use thruput_sdk::crypto::sha256;

/// Domain tag at the start of every claim preimage.
pub const CLAIM_DOMAIN: &[u8; 15] = b"kalien-claim-v1";
/// Claim preimage length: domain + network hash + contract + seed id + tape hash.
pub const CLAIM_PREIMAGE_LEN: usize = 15 + 32 + 32 + 4 + 32;

/// `"kalien-claim-v1" || network_hash || score_contract || seed_id LE || tape_hash`.
pub fn claim_preimage(
    network_hash: &[u8; 32],
    score_contract: &[u8; 32],
    seed_id: u32,
    tape_hash: &[u8; 32],
) -> [u8; CLAIM_PREIMAGE_LEN] {
    let mut out = [0u8; CLAIM_PREIMAGE_LEN];
    out[..15].copy_from_slice(CLAIM_DOMAIN);
    out[15..47].copy_from_slice(network_hash);
    out[47..79].copy_from_slice(score_contract);
    out[79..83].copy_from_slice(&seed_id.to_le_bytes());
    out[83..].copy_from_slice(tape_hash);
    out
}

/// The 32-byte message the player signs: `sha256(claim_preimage(..))`.
pub fn claim_digest(
    network_hash: &[u8; 32],
    score_contract: &[u8; 32],
    seed_id: u32,
    tape_hash: &[u8; 32],
) -> [u8; 32] {
    *sha256(&claim_preimage(network_hash, score_contract, seed_id, tape_hash))
}

/// CXS bytes of `DomainSeparator { ext: 0, domain_separator: "PublicKey" }`.
const PUBLIC_KEY_SEPARATOR: &[u8; 11] = b"\x00\x09PublicKey";
/// CXS bytes of `DomainSeparator { ext: 0, domain_separator: "PubkeyAccount" }`.
const PUBKEY_ACCOUNT_SEPARATOR: &[u8; 15] = b"\x00\x0dPubkeyAccount";

/// Separator + CXS `PublicKey::Ed25519(pk)` (`0x00` scheme tag, 32 key bytes).
pub const PUBLIC_KEY_PREIMAGE_LEN: usize = 11 + 1 + 32;
/// Separator + CXS `PubkeyAccountPreimage { pubkey_hash, nonce: 0 }`
/// (32-byte hash, `0x00` compact nonce).
pub const PUBKEY_ACCOUNT_PREIMAGE_LEN: usize = 15 + 32 + 1;

/// Preimage of the public key hash of an Ed25519 key (wire 14).
pub fn public_key_preimage(pubkey: &[u8; 32]) -> [u8; PUBLIC_KEY_PREIMAGE_LEN] {
    let mut out = [0u8; PUBLIC_KEY_PREIMAGE_LEN];
    out[..11].copy_from_slice(PUBLIC_KEY_SEPARATOR);
    out[11] = 0x00; // PublicKey::Ed25519
    out[12..].copy_from_slice(pubkey);
    out
}

/// Preimage of the nonce-0 pubkey account address, from the key's hash.
pub fn pubkey_account_preimage(pubkey_hash: &[u8; 32]) -> [u8; PUBKEY_ACCOUNT_PREIMAGE_LEN] {
    let mut out = [0u8; PUBKEY_ACCOUNT_PREIMAGE_LEN];
    out[..15].copy_from_slice(PUBKEY_ACCOUNT_SEPARATOR);
    out[15..47].copy_from_slice(pubkey_hash);
    out[47] = 0x00; // nonce 0
    out
}

/// The address of the nonce-0 pubkey account for an Ed25519 key:
/// `sha256(sep("PubkeyAccount") || sha256(sep("PublicKey") || cxs(PublicKey::Ed25519(pk))) || 0x00)`.
/// The same as `derivePubkeyAccountAddress(pubkeyAccountPreimage(key, 0n))` and
/// `createPubkeyAccount({ signer })` in the TS client 0.23.
pub fn pubkey_account_address(pubkey: &[u8; 32]) -> ContractAddress {
    let key_hash: [u8; 32] = *sha256(&public_key_preimage(pubkey));
    ContractAddress::from(*sha256(&pubkey_account_preimage(&key_hash)))
}
