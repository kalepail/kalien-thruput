import { fromBase58, parseAddress, toBase58 } from "@thruputchain/client";
import { hexToBytes } from "./hex";

const HEX32 = /^(?:0x)?[0-9a-f]{64}$/iu;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/**
 * Parses a 32-byte identifier (address, hash, network hash): base58, as the
 * wire and tools show it, or 64 hex chars with an optional 0x. Null if invalid.
 */
export function parseId32(raw: string | null | undefined): Uint8Array | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (HEX32.test(value)) {
    return hexToBytes(value);
  }
  if (!BASE58.test(value)) {
    return null;
  }
  try {
    const bytes = fromBase58(value, 32);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/** Canonical form of a 32-byte identifier in the API and D1: base58. */
export function id58(bytes: Uint8Array): string {
  return toBase58(bytes);
}

/** Normalizes a 32-byte identifier to base58, or null when invalid. */
export function normalizeId(raw: string | null | undefined): string | null {
  const bytes = parseId32(raw);
  return bytes ? id58(bytes) : null;
}

const STRKEY_CONTRACT = /^C[A-Z2-7]{55}$/u;

/**
 * Normalizes address input to base58: base58, 64 hex chars, or a legacy
 * C StrKey. Null when invalid. Base58 is case-sensitive; it is kept as is.
 */
export function normalizeAddressInput(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (value && STRKEY_CONTRACT.test(value)) {
    try {
      return toBase58(parseAddress(value));
    } catch {
      return null;
    }
  }
  return normalizeId(value);
}
