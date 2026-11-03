// Testserver voor de samenwerkingsscenario's (Playwright webServer). Start de productiebuild met inloggen aan,
// op een nieuwe SQLite-database of (met --pg) een tijdelijke lokale PostgreSQL-cluster, en maakt bij
// RELINE_AUTH=lokaal het eerste beheerdersaccount aan (activatielink in een statusbestand voor de test).
//   node scripts/test-team-server.mjs --port 3109 --auth lokaal [--pg] --state test-results/team/state-3109.json
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startTempPostgres } from "./test-pg.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const port = Number(arg("port", 3109));
const auth = String(arg("auth", "lokaal"));
const state = String(arg("state", `test-results/team/state-${port}.json`));
const pg = arg("pg", false) ? startTempPostgres() : null;
const sqlite = pg ? null : path.join("data", `team-test-${port}-${Date.now()}.sqlite`);
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  RELINE_AUTH: auth,
  RELINE_PUBLIC_URL: `http://127.0.0.1:${port}`,
  ...(pg ? { RELINE_DATABASE_URL: pg.url } : { RELINE_DB: sqlite }),
  ...(auth === "entra"
    ? {
        RELINE_ENTRA_ISSUER: process.env.RELINE_ENTRA_ISSUER ?? "http://127.0.0.1:3111",
        RELINE_ENTRA_CLIENT_ID: "reline-test",
        RELINE_ENTRA_CLIENT_SECRET: "test-geheim-niet-echt",
        RELINE_ENTRA_INSECURE_TEST: "1",
      }
    : {}),
  ...(auth === "email"
    ? {
        // Echte SMTP-verzending naar de test-mailserver (scripts/mock-smtp.mjs), zonder TLS alleen op 127.0.0.1.
        RELINE_MAIL_SMTP_URL: `smtp://127.0.0.1:${Number(arg("smtp", 2526))}`,
        RELINE_MAIL_FROM: "Re-Line test <noreply@example.test>",
        RELINE_MAIL_INSECURE_TEST: "1",
        RELINE_BOOTSTRAP_ADMIN_EMAIL: "petra.pilot@example.test",
        RELINE_BOOTSTRAP_ADMIN_NAME: "Petra Pilot (fictief)",
      }
    : {}),
  ...(arg("demo", false) ? { RELINE_DEMO: "1" } : {}),
};
delete env.RELINE_DB_SSL;
if (pg) delete env.RELINE_DB;
else delete env.RELINE_DATABASE_URL;
mkdirSync(path.dirname(state), { recursive: true });
const info = { port, auth, database: pg ? "postgres" : "sqlite" };
const pilot = !!arg("pilot", false);
if (arg("demo", false)) {
  // Zoals op de demo-omgeving: synthetische pilotset in de lege database vóór de start.
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/demo-vullen.ts"], { env, encoding: "utf8" });
  if (r.status !== 0) {
    console.error("Demo vullen mislukt:", r.stderr || r.stdout);
    pg?.stop();
    process.exit(1);
  }
}
if (pilot) {
  // Acceptatiepilot: precies zoals in de centrale omgeving klaargezet met npm run pilot:voorbereiden.
  const tmp = state + ".pilot";
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/pilot-voorbereiden.ts", "--state", tmp, "--uitvoer", path.join(path.dirname(state), `pilot-${port}.xlsx`)], { env, encoding: "utf8" });
  if (r.status !== 0) {
    console.error("Pilot klaarzetten mislukt:", r.stderr || r.stdout);
    pg?.stop();
    process.exit(1);
  }
  Object.assign(info, JSON.parse(readFileSync(tmp, "utf8")));
  rmSync(tmp, { force: true });
} else if (auth === "lokaal") {
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/gebruiker.ts", "--maak", "--beheerder", "--email", "beheerder@example.test", "--naam", "Test Beheerder"], { env, encoding: "utf8" });
  const link = (r.stdout.match(/https?:\/\/\S+#activeren=\S+/) ?? [])[0];
  if (!link) {
    console.error("Eerste beheerder aanmaken mislukt:", r.stderr || r.stdout);
    pg?.stop();
    process.exit(1);
  }
  info.adminLink = link;
}
writeFileSync(state, JSON.stringify(info));
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "inherit" });
const cleanup = () => {
  pg?.stop();
  if (!sqlite) return;
  for (const s of ["", "-wal", "-shm"]) rmSync(sqlite + s, { force: true });
  // Back-ups die de app vóór een import van deze testdatabase maakte (fictieve gegevens).
  const dir = path.join(path.dirname(sqlite), "backups");
  const prefix = path.basename(sqlite, ".sqlite") + "-";
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.startsWith(prefix)) rmSync(path.join(dir, f), { force: true });
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { child.kill("SIGTERM"); });
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
