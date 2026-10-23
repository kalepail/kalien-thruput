import type { WorkerEnv } from "./env";

export function tapeKey(runId: string): string {
  return `tapes/${runId}.tape`;
}

export async function putTape(env: WorkerEnv, runId: string, tape: Uint8Array): Promise<void> {
  await env.TAPES.put(tapeKey(runId), tape, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
}

export async function getTape(
  env: WorkerEnv,
  runId: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const object = await env.TAPES.get(tapeKey(runId));
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}
