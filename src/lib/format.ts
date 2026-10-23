export function formatHex32(value: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function abbreviateHex(value: string, keep = 8): string {
  if (value.length <= keep * 2) {
    return value;
  }
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function abbreviateAddress(value: string): string {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

export function formatWholeNumber(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function formatMetric(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "n/a";
}

export function formatFramesAsTime(frameCount: number, fps = 60): string {
  const totalSeconds = Math.round(frameCount / fps);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export const KALIEN_DECIMALS = 7;
export const KALIEN_SCALE = 10_000_000n;
/** Format KALIEN base units (7 decimals) with grouping and trimmed fraction digits. */
export function formatKalien(rawAmount: bigint): string {
  const negative = rawAmount < 0n;
  const abs = negative ? -rawAmount : rawAmount;
  const whole = formatWholeNumber(abs / KALIEN_SCALE);
  const frac = (abs % KALIEN_SCALE).toString().padStart(KALIEN_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Parse an API amount (decimal string, number, or bigint) as KALIEN base units. */
export function parseBaseUnits(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}
