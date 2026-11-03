// Tijdelijke, lokale PostgreSQL voor tests (patroon bouwsteen B29). Start een wegwerpcluster in een tijdelijke map,
// luistert ALLEEN op een unix-socket in die map (geen TCP), voert het opgegeven commando uit met
// RELINE_TEST_PG (beheerdersadres van de cluster) en ruimt alles op. Geen verbinding met een externe database.
//
//   node scripts/test-pg.mjs -- npx tsx --test tests/*.test.ts
//   node scripts/test-pg.mjs --serve      (cluster openhouden; adres op stdout, stoppen met Ctrl+C)
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findPgBin() {
  if (process.env.PG_BIN && existsSync(join(process.env.PG_BIN, "initdb"))) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
  for (const v of versions) if (existsSync(join(base, v, "bin", "initdb"))) return join(base, v, "bin");
  return null;
}
function runner() {
  if (process.getuid?.() !== 0) return { wrap: (cmd, args) => [cmd, args], owner: null };
  const r = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const g = spawnSync("id", ["-g", "postgres"], { encoding: "utf8" });
  return { wrap: (cmd, args) => ["runuser", ["-u", "postgres", "--", cmd, ...args]], owner: `${r.stdout.trim()}:${g.stdout.trim()}` };
}
export function startTempPostgres() {
  const bin = findPgBin();
  const run = runner();
  if (!bin || !run) throw new Error("PostgreSQL niet beschikbaar (zet PG_BIN of installeer postgresql)");
  const dir = mkdtempSync(join(tmpdir(), "reline-pg-"));
  const data = join(dir, "data");
  const exec = (cmd, args) => {
    const [c, a] = run.wrap(join(bin, cmd), args);
    return spawnSync(c, a, { encoding: "utf8" });
  };
  let started = false;
  const stop = () => {
    if (started) exec("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
    started = false;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    chmodSync(dir, 0o700);
    if (run.owner) spawnSync("chown", ["-R", run.owner, dir]);
    const init = exec("initdb", ["-D", data, "-A", "trust", "-U", "reline", "-E", "UTF8", "--locale=C", "--no-instructions"]);
    if (init.status !== 0) throw new Error("initdb mislukt: " + init.stderr);
    const start = exec("pg_ctl", ["-D", data, "-l", join(dir, "server.log"), "-w", "-o", `-c listen_addresses='' -k ${dir} -c fsync=off -c full_page_writes=off -c max_connections=200`, "start"]);
    if (start.status !== 0) throw new Error("pg_ctl start mislukt: " + start.stderr);
    started = true;
  } catch (e) {
    stop();
    throw e;
  }
  return { url: `postgresql://reline@localhost/postgres?host=${encodeURIComponent(dir)}`, dir, stop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pg = startTempPostgres();
  const cleanup = () => {
    pg.stop();
    process.exit(130);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  if (process.argv.includes("--serve")) {
    console.log(pg.url);
  } else {
    const i = process.argv.indexOf("--");
    const [cmd, ...args] = process.argv.slice(i + 1);
    const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, RELINE_TEST_PG: pg.url } });
    child.on("exit", (code) => {
      pg.stop();
      process.exit(code ?? 1);
    });
  }
}
