import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Set KALIEN_API_PROXY (for example http://127.0.0.1:5175 for a mock API, or a
// deployed Worker URL) to run the browser app without the local Worker and send
// `/api/*` there instead.
const apiProxy = process.env.KALIEN_API_PROXY?.trim();
// Set KALIEN_RPC_PROXY (for example http://127.0.0.1:9745) to reach a local
// Thruput node through `/rpc`; local nodes send no CORS headers.
const rpcProxy = process.env.KALIEN_RPC_PROXY?.trim();

const proxy = {
  ...(apiProxy ? { "/api": { target: apiProxy, changeOrigin: true } } : {}),
  ...(rpcProxy ? { "/rpc": { target: rpcProxy, changeOrigin: true, rewrite: () => "/" } } : {}),
};

export default defineConfig({
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
      ],
    },
  },
});
