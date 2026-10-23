/// <reference types="vite/client" />

// The browser reads network config (RPC, network hash, contracts, explorer)
// from the Worker's `/api/config` at runtime, so no `VITE_*` variables are needed.
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** True in `vite dev` when KALIEN_RPC_PROXY routes `/rpc` to a local Thruput node. */
declare const __KALIEN_RPC_PROXY__: boolean;
