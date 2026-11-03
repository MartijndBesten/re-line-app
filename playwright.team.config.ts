import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
// Samenwerkingsscenario's met echte browsers en meerdere fictieve gebruikers op de productiebuild.
// Na `npm run build`: `npm run test:team` (SQLite) en `RELINE_TEAM_PG=1 npm run test:team` (tijdelijke PostgreSQL).
const pg = process.env.RELINE_TEAM_PG === "1" ? " --pg" : "";
const tag = pg ? "pg" : "sqlite";
export default defineConfig({
  testDir: "./tests/team",
  workers: 1,
  timeout: 90_000,
  use: {
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "wachtwoord", testMatch: /samenwerken\.spec\.ts/, use: { baseURL: "http://127.0.0.1:3109" } },
    { name: "entra", testMatch: /entra\.spec\.ts/, use: { baseURL: "http://127.0.0.1:3110" } },
    { name: "pilot", testMatch: /pilot\.spec\.ts/, use: { baseURL: "http://127.0.0.1:3112" } },
    { name: "emaillink", testMatch: /emaillink\.spec\.ts/, use: { baseURL: "http://127.0.0.1:3113" } },
  ],
  webServer: [
    { command: "node scripts/mock-oidc.mjs 3111", url: "http://127.0.0.1:3111/.well-known/openid-configuration", reuseExistingServer: false, timeout: 30_000 },
    { command: "node scripts/mock-smtp.mjs 2526 3114", url: "http://127.0.0.1:3114/berichten", reuseExistingServer: false, timeout: 30_000 },
    {
      command: `node scripts/test-team-server.mjs --port 3109 --auth lokaal --state test-results/team/state-3109-${tag}.json${pg}`,
      url: "http://127.0.0.1:3109/api/auth/me",
      reuseExistingServer: false,
      timeout: 120_000,
      // Netjes stoppen, zodat de testserver de tijdelijke database (SQLite-bestand of PostgreSQL-cluster) opruimt.
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      command: `node scripts/test-team-server.mjs --port 3110 --auth entra --state test-results/team/state-3110-${tag}.json${pg}`,
      url: "http://127.0.0.1:3110/api/auth/me",
      reuseExistingServer: false,
      timeout: 120_000,
      // Netjes stoppen, zodat de testserver de tijdelijke database (SQLite-bestand of PostgreSQL-cluster) opruimt.
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      // Generale repetitie acceptatiepilot: drie fictieve accounts + synthetische export (npm run pilot:voorbereiden).
      command: `node scripts/test-team-server.mjs --port 3112 --auth lokaal --pilot --state test-results/team/state-3112-${tag}.json${pg}`,
      url: "http://127.0.0.1:3112/api/auth/me",
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      // Inloglink per e-mail + afgeschermde demo (zoals de online demo): echte SMTP naar de test-mailserver.
      command: `node scripts/test-team-server.mjs --port 3113 --auth email --smtp 2526 --demo --state test-results/team/state-3113-${tag}.json${pg}`,
      url: "http://127.0.0.1:3113/api/auth/me",
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
  ],
});
