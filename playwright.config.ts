import { defineConfig } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3107",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      process.env.RELINE_BROWSER_PRODUCTION === "1"
        ? "npm start -- --port 3107"
        : "npm run dev -- --port 3107",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      RELINE_DB: path.join(
        process.cwd(),
        "data",
        "browser-test-" + Date.now() + ".sqlite",
      ),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
