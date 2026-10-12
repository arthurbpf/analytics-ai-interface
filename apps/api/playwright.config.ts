import { defineConfig } from "@playwright/test";
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    extraHTTPHeaders: { Origin: "http://127.0.0.1:5174" },
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --env-file-if-exists=../../.env tests/fixtures/server.ts",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
    },
    {
      command: "node ../web/node_modules/vite/bin/vite.js --config ../web/vite.e2e.config.ts",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
