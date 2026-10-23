const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/iu;

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Parses hex with or without a `0x` prefix. Throws on bad input. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/iu, "");
  if (!HEX_PATTERN.test(clean)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** Parses hex of an exact byte length, or returns null. */
export function parseFixedHex(value: string | undefined | null, length: number): Uint8Array | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const bytes = hexToBytes(value);
    return bytes.length === length ? bytes : null;
  } catch {
    return null;
  }
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concatBytes(...parts)));
}
