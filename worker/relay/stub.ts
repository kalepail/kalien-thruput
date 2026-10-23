import { RELAY_OBJECT_NAME } from "../constants";
import type { WorkerEnv } from "../env";

export function relayStub(env: WorkerEnv) {
  return env.RELAY.get(env.RELAY.idFromName(RELAY_OBJECT_NAME));
}
