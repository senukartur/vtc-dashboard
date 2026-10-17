import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), [
    "WEB_",
    "API_PROXY_TARGET",
  ]);
  const port = Number(env.WEB_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid WEB_PORT");
  const target = env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";
  const proxyUrl = new URL(target);
  if (!["http:", "https:"].includes(proxyUrl.protocol) || proxyUrl.username || proxyUrl.password) {
    throw new Error("Invalid API_PROXY_TARGET");
  }
  return {
    plugins: [react(), tailwind()],
    server: {
      host: env.WEB_HOST ?? "127.0.0.1",
      port,
      strictPort: true,
      proxy: { "/api": { target }, "/health": { target } },
    },
  };
});
