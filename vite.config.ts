import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Dev-only proxies (`vite dev`). A build ignores them, so an exported variable
// cannot change the production bundle (review item 17).
// - KALIEN_API_PROXY (for example http://127.0.0.1:5175 for a mock API, or a
//   deployed Worker URL): run without the local Worker and send `/api/*` there.
// - KALIEN_RPC_PROXY (for example http://127.0.0.1:9745): reach a local Thruput
//   node through `/rpc`; local nodes send no CORS headers.
export function resolveDevProxies(command: "serve" | "build", env: NodeJS.ProcessEnv) {
  if (command !== "serve") {
    return { apiProxy: undefined, rpcProxy: undefined };
  }
  return {
    apiProxy: env.KALIEN_API_PROXY?.trim() || undefined,
    rpcProxy: env.KALIEN_RPC_PROXY?.trim() || undefined,
  };
}

export default defineConfig(({ command }) => {
  const { apiProxy, rpcProxy } = resolveDevProxies(command, process.env);
  const proxy = {
    ...(apiProxy ? { "/api": { target: apiProxy, changeOrigin: true } } : {}),
    ...(rpcProxy ? { "/rpc": { target: rpcProxy, changeOrigin: true, rewrite: () => "/" } } : {}),
  };
  return {
    plugins: [tailwindcss(), react(), ...(apiProxy ? [] : [cloudflare() as PluginOption])],
    define: {
      __KALIEN_RPC_PROXY__: JSON.stringify(Boolean(rpcProxy)),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy,
      watch: {
        ignored: [
          "**/autopilot/**",
          "**/cli/**",
          "**/kalien-contract/**",
          "**/asteroids-core/**",
          "**/scripts/**",
          "**/batch-results/**",
          "**/generated-tapes/**",
          "**/test-fixtures/**",
          "**/tests/**",
          "**/docs/**",
          "**/dist/**",
          "**/target/**",
          // With the API proxied, worker/ edits (even its tsconfig) must not reload the page.
          ...(apiProxy ? ["**/worker/**"] : []),
        ],
      },
    },
  };
});
