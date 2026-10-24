/**
 * Small read-only probes shared by the live API scripts: transaction gas from
 * the Thruput RPC, and per-lane run counts from the Worker's /api/health.
 */

export interface LaneCounts {
  lane: number;
  address: string;
  confirmed: number;
  rejected: number;
  failed: number;
}

/** `gasUsed` of a committed transaction (base58 hash), or null if not found. */
export async function fetchGasUsed(rpcUrl: string, txHash: string): Promise<number | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransactionReceipt",
        params: { transactionHash: txHash },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as { result?: { gasUsed?: string | number } | null };
    const gas = body.result?.gasUsed;
    return gas === undefined || gas === null ? null : Number(gas);
  } catch {
    return null;
  }
}

export async function fetchLaneCounts(apiUrl: string): Promise<LaneCounts[]> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/health`, {
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    lanes?: {
      lane: number;
      address: string;
      counts?: { confirmed?: number; rejected?: number; failed?: number };
    }[];
  };
  return (body.lanes ?? []).map((l) => ({
    lane: l.lane,
    address: l.address,
    confirmed: l.counts?.confirmed ?? 0,
    rejected: l.counts?.rejected ?? 0,
    failed: l.counts?.failed ?? 0,
  }));
}

/** Per-lane change between two health snapshots, e.g. "lane0 +3, lane1 +2". */
export function laneSpread(before: LaneCounts[], after: LaneCounts[]): string {
  return after
    .map((a) => {
      const b = before.find((x) => x.lane === a.lane);
      const done =
        a.confirmed +
        a.rejected +
        a.failed -
        ((b?.confirmed ?? 0) + (b?.rejected ?? 0) + (b?.failed ?? 0));
      return `lane${a.lane} +${done}`;
    })
    .join(", ");
}
