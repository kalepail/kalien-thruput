export function nowIso(): string {
  return new Date().toISOString();
}

export function parseInteger(raw: string | undefined, fallback: number, minimum = 1): number {
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

export function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

export function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error && error.message && error.message.trim().length > 0
      ? error.message
      : String(error);
  // Collapse control chars (including embedded binary bytes) so responses
  // remain valid JSON and readable in UI surfaces.
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
