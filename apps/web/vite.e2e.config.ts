import { defineConfig } from "vite";
import config from "./vite.config.ts";
export default defineConfig({ ...config, root: new URL(".", import.meta.url).pathname,
  optimizeDeps: { include: ["@analytics/contracts"] },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: { "/api": "http://127.0.0.1:3101" } } });
