export const TAPE_MAGIC = 0x5a4b5450;
export const TAPE_VERSION = 4;
export const TAPE_HEADER_SIZE = 16;
export const TAPE_FOOTER_SIZE = 8;
export const EXPECTED_RULES_TAG = 4; // "AST4"

// Strict rules cap a run at 36,000 frames (10 minutes at 60 fps).
export const MAX_TAPE_FRAMES = 36_000;
export const MAX_TAPE_BYTES = TAPE_HEADER_SIZE + Math.ceil(MAX_TAPE_FRAMES / 2) + TAPE_FOOTER_SIZE; // 18,024

// Seed epochs: seed_id = block_timestamp / 600. The current epoch and the
// previous 143 epochs (24 h) accept runs.
export const SEED_EPOCH_SECONDS = 600;
export const SEED_ACTIVE_EPOCHS = 144;

// Profile signatures use this domain tag (claims: shared/thruput/claim.ts).
export const PROFILE_DOMAIN = "kalien-profile-v1";

// KALIEN has 7 decimals; the contract mints (new - prev) * 1e7 base units.
export const KALIEN_DECIMALS = 7;

export const RELAY_OBJECT_NAME = "relay-0";
