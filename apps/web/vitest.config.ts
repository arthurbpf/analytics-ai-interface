import { defineConfig } from "vitest/config";
import config from "./vite.config.ts";
export default defineConfig({
  ...config,
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
