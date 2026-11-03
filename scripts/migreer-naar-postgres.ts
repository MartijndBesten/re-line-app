// Eenmalige overstap van de lokale SQLite-database naar de centrale PostgreSQL-database.
//
//   RELINE_DATABASE_URL="postgres://…" npm run migreer:postgres -- --van data/re-line.sqlite --proef
//   RELINE_DATABASE_URL="postgres://…" npm run migreer:postgres -- --van data/re-line.sqlite
//   RELINE_DATABASE_URL="postgres://…" npm run migreer:postgres -- --van data/re-line.sqlite --controleer
//
// Het doeladres komt uit RELINE_DATABASE_URL (niet als argument: dan belandt het wachtwoord niet in de
// shellgeschiedenis). TLS naar de database: RELINE_DB_SSL=1.
// --proef        alles kopiëren en controleren in één transactie en die terugdraaien: het doel blijft leeg.
// zonder --proef idem, maar vastleggen als alle controles kloppen. Een niet-lege doeldatabase wordt geweigerd.
// --controleer   na de overstap: bron en doel opnieuw per tabel vergelijken (aantal + controlegetal).
//
// Uitvoer: alleen tabelnamen, aantallen en controles; geen klant-, project- of bedraggegevens.
import { existsSync } from "node:fs";
import { compare, migrateSqliteToPostgres } from "../lib/migrate-pg";
import { PostgresDriver, SqliteDriver } from "../lib/sql";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes("--" + n);
const value = (n: string) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error("FOUT: " + msg);
  process.exit(1);
};
const from = value("van") ?? "data/re-line.sqlite";
const to = process.env.RELINE_DATABASE_URL ?? "";
if (!existsSync(from)) fail(`SQLite-bestand niet gevonden: ${from}`);
if (!/^postgres(ql)?:\/\//i.test(to)) fail("Zet RELINE_DATABASE_URL op het postgres://-adres van de (lege) centrale database.");
const n = (x: number) => x.toLocaleString("nl-NL");

async function main() {
  if (flag("controleer")) {
    const s = new SqliteDriver(from);
    const t = await PostgresDriver.connect(to, { max: 1, ssl: process.env.RELINE_DB_SSL === "1" });
    try {
      const checks = await compare(s, t);
      for (const c of checks) console.log(`${c.ok ? "OK " : "AFW"}  ${c.table.padEnd(22)} bron ${n(c.source).padStart(7)}  doel ${n(c.target).padStart(7)}`);
      const bad = checks.filter((c) => !c.ok);
      console.log(bad.length ? `\n${bad.length} tabel(len) wijken af (verwacht zodra er centraal is doorgewerkt).` : "\nBron en doel zijn gelijk.");
      process.exitCode = bad.length ? 2 : 0;
    } finally {
      await t.close();
      await s.close();
    }
    return;
  }
  const r = await migrateSqliteToPostgres(from, to, { dryRun: flag("proef") });
  console.log(`${r.dryRun ? "PROEF (teruggedraaid)" : "OVERGEZET"}  schema v${r.schema}  van ${r.source} naar ${r.target}\n`);
  for (const c of r.tables) console.log(`${c.ok ? "OK " : "AFW"}  ${c.table.padEnd(22)} ${n(c.target).padStart(7)} rijen`);
  for (const s of r.skipped) console.log(`--   ${s.table.padEnd(22)} ${n(s.rows).padStart(7)} niet overgenomen (tijdelijk)`);
  console.log(`\nDossiers: ${n(r.projects)} · historieregels: ${n(r.historyLines)} · renovatiekandidaten met rang: ${n(r.candidates)}`);
  console.log(r.dryRun ? "De doeldatabase is ongewijzigd. Draai zonder --proef om over te zetten." : "Alle controles kloppen; vastgelegd in het auditlog.");
}
main().catch((e) => fail((e as Error).message));
