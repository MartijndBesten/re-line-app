import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asActor, Store, type Actor } from "../lib/db";
import { activate, createSession, createUser, login } from "../lib/auth";
import { compare, migrateSqliteToPostgres } from "../lib/migrate-pg";
import { PostgresDriver, SqliteDriver } from "../lib/sql";
import { parsed } from "./support/history";
import { newPgDatabase } from "./support/store";
// Overstap SQLite → PostgreSQL met uitsluitend fictieve gegevens. Draait alleen met een tijdelijke
// PostgreSQL-cluster (npm run test:pg); bij npm test (alleen SQLite) overgeslagen.
const skip = process.env.RELINE_TEST_PG ? false : "alleen met npm run test:pg";
const admin: Actor = { id: null, name: "Testbeheerder", role: "beheerder" };

async function filledSqlite(dir: string) {
  const file = path.join(dir, "bron.sqlite");
  const db = await Store.open(file);
  await asActor(admin, async () => {
    await db.ingestHistory("synthetisch.xlsx", (await parsed()).rows);
    await db.selectCandidates(2);
    const alfa = (await db.projects()).find((x) => x.project_number === "5000001")!;
    const { version } = await db.updateProject(String(alfa.id), { notes: "Fictieve notitie met ë en €", version: alfa.version });
    await db.updateProject(String(alfa.id), { status: "Contact gelegd", version });
    await db.addActivity(String(alfa.id), { kind: "Bellen", note: "Terugbellen (fictief)", due: "2030-01-01" });
    const u = await createUser(db, { email: "anna@example.test", name: "Anna Test", role: "gebruiker" }, "Testbeheerder");
    await activate(db, u.activationToken!, "Anna-wachtwoord-2026!");
    await createSession(db, u.id);
  });
  return { file, db };
}

test("Overstap SQLite → PostgreSQL: proefrun laat doel leeg, overzetten neemt alles over en controleert per tabel", { skip }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reline-migratie-"));
  const { file, db: src } = await filledSqlite(dir);
  const url = await newPgDatabase();
  try {
    const before = await src.projects();
    await src.close();
    const proef = await migrateSqliteToPostgres(file, url, { dryRun: true });
    assert.equal(proef.ok, true);
    assert.equal(proef.dryRun, true);
    assert.equal(proef.projects, 3);
    assert.equal(proef.candidates, 2);
    const probe = await PostgresDriver.connect(url, { max: 1 });
    assert.equal(Number((await probe.one("SELECT COUNT(*) AS n FROM projects"))?.n), 0, "proefrun is teruggedraaid");
    await probe.close();

    const r = await migrateSqliteToPostgres(file, url);
    assert.equal(r.ok, true);
    assert.equal(r.historyLines, 4);
    assert.ok(r.tables.every((t) => t.ok && t.source === t.target));
    assert.equal(r.skipped.find((s) => s.table === "sessions")!.rows, 1, "sessie bestond in de bron");

    const pg = await Store.open(url);
    try {
      const after = await pg.projects();
      assert.equal(after.length, before.length);
      for (const b of before) {
        const a = after.find((x) => x.id === b.id)!;
        for (const k of ["name", "status", "notes", "owner", "candidate_rank", "version", "updated_by", "historyLines", "historyNetRevenue", "priority"])
          assert.deepEqual(a[k], b[k], `${k} van ${b.project_number}`);
      }
      const alfa = after.find((x) => x.project_number === "5000001")!;
      assert.equal(alfa.notes, "Fictieve notitie met ë en €");
      assert.equal((await pg.dossier(String(alfa.id))).activities.length, 1);
      assert.equal(Number((await pg.one("SELECT COUNT(*) AS n FROM sessions"))?.n), 0, "sessies niet overgenomen");
      assert.ok(await login(pg, "anna@example.test", "Anna-wachtwoord-2026!"), "wachtwoord werkt na de overstap");
      assert.equal((await pg.all("SELECT * FROM audit WHERE action='Migratie naar PostgreSQL'")).length, 1);
      assert.equal((await pg.all("SELECT * FROM audit WHERE action='Schemamigratie'")).length, 3, "auditgeschiedenis uit de bron, niet dubbel");

      // Nacontrole: gelijk; na een wijziging centraal wijkt alleen die tabel af.
      const s = new SqliteDriver(file);
      try {
        assert.ok((await compare(s, pg.driver)).every((c) => c.ok));
        await pg.run("UPDATE projects SET notes='Centraal aangepast' WHERE id=?", String(alfa.id));
        const bad = (await compare(s, pg.driver)).filter((c) => !c.ok).map((c) => c.table);
        assert.deepEqual(bad, ["projects"]);
      } finally {
        await s.close();
      }
    } finally {
      await pg.close();
    }
    // Nogmaals overzetten naar dezelfde (nu gevulde) database: geweigerd, niets overschreven.
    await assert.rejects(migrateSqliteToPostgres(file, url), /niet leeg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Overstap: fout tijdens kopiëren draait alles terug; doel blijft leeg", { skip }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reline-migratie-"));
  const { file, db } = await filledSqlite(dir);
  const url = await newPgDatabase();
  try {
    // Kapotte bronwaarde die PostgreSQL weigert (tekst in een getalkolom), op de laatste historieregel.
    await db.run("UPDATE history_lines SET fiscal_year='onbekend' WHERE id=(SELECT MAX(id) FROM history_lines)");
    await db.close();
    await assert.rejects(migrateSqliteToPostgres(file, url), /integer|onbekend/i);
    const probe = await PostgresDriver.connect(url, { max: 1 });
    try {
      for (const t of ["users", "projects", "history_lines", "activities"])
        assert.equal(Number((await probe.one(`SELECT COUNT(*) AS n FROM ${t}`))?.n), 0, t);
    } finally {
      await probe.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Overstap weigert een PostgreSQL-bron en een niet-postgres-doel", async () => {
  await assert.rejects(migrateSqliteToPostgres("postgres://x/y", "postgres://x/z"), /SQLite-bestand/);
  await assert.rejects(migrateSqliteToPostgres("data/x.sqlite", "data/y.sqlite"), /postgres:\/\//);
});
