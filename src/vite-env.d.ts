/// <reference types="vite/client" />

// The browser reads network config (RPC, network hash, contracts, explorer)
// from the Worker's `/api/config` at runtime, so no `VITE_*` variables are needed.
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
