import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const backendPort = process.env.VITE_BACKEND_PORT ?? "8000";
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
// Windows editors do not reliably trigger filesystem events on WSL mounts.
const usePolling = process.platform === "linux"
  && !!process.env.WSL_DISTRO_NAME
  && /^\/mnt\/[a-z]\//i.test(repoRoot);
const apiProxy = {
  target: `http://127.0.0.1:${backendPort}`,
  // Preserve the browser host for server-side Origin/CSRF validation.
  changeOrigin: false,
  ws: true,
  rewrite: (p: string) => p.replace(/^\/api/, ""),
  // SSE (EventSource) through proxy: avoid buffering / stale Content-Length
  configure(proxy) {
    proxy.on("proxyRes", (proxyRes, req) => {
      const url = req.url ?? "";
      if (url.includes("/events")) {
        delete proxyRes.headers["content-length"];
        proxyRes.headers["cache-control"] = "no-cache, no-transform";
        proxyRes.headers["x-accel-buffering"] = "no";
      }
    });
  },
};
const streamingProxy = {
  ...apiProxy,
  rewrite: (p: string) => p,
};

export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    port: 5173,
    watch: usePolling ? { usePolling: true, interval: 500 } : undefined,
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": apiProxy,
      "/streaming": streamingProxy,
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": apiProxy,
      "/streaming": streamingProxy,
    },
  },
});
