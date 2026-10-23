// Hex helpers for keys, signatures, and hashes. Output is lowercase without `0x`.

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = strip0x(hex.trim()).toLowerCase();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

export function with0x(hex: string): string {
  return `0x${strip0x(hex).toLowerCase()}`;
}

export function isHexOfLength(value: string, byteLength: number): boolean {
  const normalized = strip0x(value.trim());
  return normalized.length === byteLength * 2 && /^[0-9a-fA-F]+$/.test(normalized);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(digest);
}
