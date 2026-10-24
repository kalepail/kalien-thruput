// Thruput identifiers (addresses, hashes, network hash) are 32 bytes. Since the
// wire-14 devnet they are base58 on the wire, in tools, and in this UI. Older
// data (pre-upgrade API rows, backups, local storage) used 0x hex, so parsing
// accepts both and display always uses base58.

import { fixedFromBase58, fromHex0x, parseAddress, toBase58 } from "@thruputchain/client";

const HEX_32 = /^(0x)?[0-9a-fA-F]{64}$/u;

/** True when the text is 32 bytes of hex, with or without `0x`. */
export function isHex32(text: string): boolean {
  return HEX_32.test(text.trim());
}

/** Decode a 32-byte identifier from base58 or (legacy) hex. Throws on anything else. */
export function idBytes(text: string): Uint8Array {
  const trimmed = text.trim();
  if (isHex32(trimmed)) {
    return fromHex0x(trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`);
  }
  return fixedFromBase58(trimmed, 32);
}

/** Canonical base58 form of a 32-byte identifier, or null when it does not parse. */
export function toCanonicalId(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  try {
    return toBase58(idBytes(text));
  } catch {
    return null;
  }
}

/** Canonical base58 form when the text parses, else the text unchanged. */
export function canonicalIdOr(text: string): string {
  return toCanonicalId(text) ?? text;
}

/**
 * Canonical base58 address from user input: base58, a `C...` StrKey, or legacy
 * hex. Returns null when the text is not an address.
 */
export function parseAddressInput(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return isHex32(trimmed) ? toBase58(idBytes(trimmed)) : toBase58(parseAddress(trimmed));
  } catch {
    return null;
  }
}
