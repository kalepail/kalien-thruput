import { PROFILE_DOMAIN } from "./constants";

const MAX_USERNAME_LENGTH = 32;
const MAX_LINK_URL_LENGTH = 240;
const USERNAME_PATTERN = /^[a-zA-Z0-9 _.@#-]+$/u;
/** A signed profile update is valid this long either side of the server clock. */
export const PROFILE_SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

/**
 * The bytes a player signs (Ed25519, raw message) to set a profile. Fields
 * are joined with "\n"; null fields are empty strings.
 */
export function profileMessage(input: {
  networkHash: string;
  playerAddress: string;
  timestamp: number;
  username: string | null;
  linkUrl: string | null;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      PROFILE_DOMAIN,
      input.networkHash.toLowerCase(),
      input.playerAddress.toLowerCase(),
      String(input.timestamp),
      input.username ?? "",
      input.linkUrl ?? "",
    ].join("\n"),
  );
}

/** Returns the cleaned username, null for empty, or undefined when invalid. */
export function sanitizeUsername(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_USERNAME_LENGTH || !USERNAME_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Returns the cleaned http(s) URL, null for empty, or undefined when invalid. */
export function sanitizeLinkUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_LINK_URL_LENGTH) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
