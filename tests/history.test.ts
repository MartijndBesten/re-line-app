import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { using } from "./support/store";
import { headers, line, parsed, sample, workbook, type Line } from "./support/history";
import { Store, migrations, schemaV1, schemaVersion } from "../lib/db";
import { excludedColumns, parseHistoryWorkbook, rankCandidates, renovationScore, splitNumberName } from "../lib/history";
import { missingData, priorityReasons } from "../lib/dossier";
import { worklist } from "../lib/opportunities";
// Uitsluitend synthetische gegevens. Bedragen en kost-/margekolommen zijn verzonnen testwaarden.

test("Projecthistorie: rapport herkend, totaalregel overgeslagen, kostprijs en marge niet ingelezen", async () => {
  const p = await parsed();
  assert.equal(p.sheet, "Details");
  assert.equal(p.rows.length, 4);
  assert.equal(p.totalDataRows, 4);
  assert.equal(p.summaryRows, 1);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.ignoredColumns, excludedColumns);
  for (const r of p.rows) for (const c of excludedColumns) assert.equal(c in r.raw, false, c);
  const [a, , beta, gamma] = p.rows;
  assert.deepEqual([a.customerNumber, a.customerName, a.recipientNumber, a.recipientName], ["100001", "Testinstallateur BV", "200001", "Testgroothandel"]);
  assert.equal(a.projectNumber, "5000001");
  assert.equal(a.fiscalYear, 2011);
  assert.equal(beta.projectStreet, "", "streepje is geen straat");
  assert.deepEqual([gamma.quantity, gamma.revenue, gamma.netRevenue], [-5, -1000, -1000]);
  assert.equal(new Set(p.rows.map((r) => r.key)).size, 4);
  assert.deepEqual((await parsed()).rows.map((r) => r.key), p.rows.map((r) => r.key), "sleutels stabiel");
  assert.deepEqual(splitNumberName("Zonder nummer"), { number: "", name: "Zonder nummer" });
  // Gewone orderexport is geen projecthistorie.
  const book = new ExcelJS.Workbook();
  const s = book.addWorksheet("Blad1");
  s.addRow(["Order", "Artikel", "Aantal"]);
  s.addRow(["900001", "TEST-A", 10]);
  assert.equal(await parseHistoryWorkbook(Buffer.from(await book.xlsx.writeBuffer())), null);
  // Ongeldig boekjaar wordt gemeld, niet stil overgeslagen.
  const bad = await parseHistoryWorkbook(await workbook(sample, [line([5000009, "Fout", 0, "1 X", "M", "S", "P", "-", "2 Y", 1, 1, 1]).map((v, i) => (i === 4 ? "FY" : v))]));
  assert.equal(bad!.errors.length, 1);
});

test("Projecthistorie: één dossier per projectnummer, apart van orderregels, herimport zonder dubbelen", async () => {
  const p = await parsed();
  await using(async (db) => {
    const first = await db.ingestHistory("test.xlsx", p.rows);
    assert.equal(first.added, 4);
    assert.equal(first.newProjects, 3);
    const projects = await db.projects();
    assert.equal(projects.length, 3);
    const alfa = projects.find((x) => x.project_number === "5000001")!;
    assert.equal(alfa.name, "Testkantoor Alfa");
    assert.equal(alfa.city, "Teststad");
    assert.equal(alfa.address, "Teststraat 1");
    assert.equal(alfa.historyLines, 2);
    assert.equal(alfa.historyFirstYear, 2011);
    assert.equal(alfa.historyLastYear, 2012);
    assert.equal(alfa.historyNetRevenue, 77000);
    assert.equal(alfa.oldestYear, 2011);
    assert.equal(alfa.lineCount, 0, "geen orderregels verzonnen");
    assert.equal(alfa.firstYear, null, "geen orderjaar verzonnen");
    assert.equal(alfa.debtors, "Testinstallateur BV");
    assert.equal(alfa.scoreModel, "projecthistorie");
    const dossier = await db.dossier(String(alfa.id));
    assert.equal(dossier.history.length, 2);
    assert.equal(dossier.lines.length, 0);
    assert.ok(dossier.relations.some((r) => r.role === "Debiteur" && r.name === "Testinstallateur BV" && r.number === "100001"));
    assert.ok(dossier.relations.some((r) => r.role === "Goederenontvanger" && r.name === "Testgroothandel"));
    assert.equal(Number((await db.one("SELECT COUNT(*) n FROM order_lines"))?.n), 0);
    // Klant met twee projecten telt voor "meerdere projecten via dezelfde klant".
    assert.equal(alfa.maxCustomerProjects, 2);
    const second = await db.ingestHistory("test.xlsx", p.rows);
    assert.deepEqual([second.added, second.duplicates, second.newProjects], [0, 4, 0]);
    assert.equal(Number((await db.one("SELECT COUNT(*) n FROM history_lines"))?.n), 4);
    assert.equal((await db.projects()).length, 3);
    // Nieuwe export met gewijzigd bedrag (bijv. lopend boekjaar): bijgewerkt, oude waarde bewaard, niets dubbel.
    const changed = p.rows.map((r, i) => (i === 0 ? { ...r, netRevenue: 50000, raw: { ...r.raw, "Net-/Net-Umsatz": 50000 } } : r));
    const prev = await db.historyPreview(changed);
    assert.deepEqual([prev.newRows, prev.updatedRows, prev.duplicates], [0, 1, 3]);
    const upd = await db.ingestHistory("test-v2.xlsx", changed);
    assert.deepEqual([upd.added, upd.updated, upd.duplicates], [0, 1, 3]);
    assert.equal(Number((await db.one("SELECT net_revenue FROM history_lines WHERE source_key=?", p.rows[0].key))?.net_revenue), 50000);
    const log = await db.all("SELECT changed FROM history_line_changes");
    assert.equal(log.length, 1);
    assert.deepEqual(JSON.parse(String(log[0].changed)).net_revenue, { voor: 48000, na: 50000 });
    assert.equal(Number((await db.one("SELECT COUNT(*) n FROM history_lines"))?.n), 4);
  });
});

test("Nieuwe SAP-export: hernoemd project, lokale aanpassing, ontbrekende regels en mogelijk dubbel", async () => {
  const first = await parsed();
  await using(async (db) => {
    await db.ingestHistory("v1.xlsx", first.rows);
    const alfa = (await db.projects()).find((x) => x.project_number === "5000001")!;
    const beta = (await db.projects()).find((x) => x.project_number === "5000002")!;
    // Collega past de naam van Beta zelf aan; Alfa blijft zoals uit SAP.
    await db.updateProject(String(beta.id), { name: "Beta (eigen naam)" });
    const v2: Line[] = [
      // Alfa: projectnaam en straat gewijzigd in SAP, zelfde nummers -> geen nieuwe regels
      [5000001, "Testkantoor Alfa Noord", 2011, "100001 Testinstallateur BV", "TST-1", "765... E-Line Old", "Teststad", "Teststraat 3", "200001 Testgroothandel", 120, 50000, 48000],
      [5000001, "Testkantoor Alfa Noord", 2012, "100001 Testinstallateur BV", "TST-2", "765... E-Line", "Teststad", "Teststraat 3", "200001 Testgroothandel", 80, 30000, 29000],
      // Beta: naam ook in SAP gewijzigd -> conflict, eigen naam blijft
      [5000002, "Testhal Beta 2", 2023, "100001 Testinstallateur BV", "TST-2", "765... E-Line", "Testdorp", "-", "200002 Testontvanger", 10, 4000, 3900],
      // Gamma ontbreekt in deze export (niets verwijderen); nieuwe ontvangernaam bij dezelfde nummers = mogelijk dubbel
      [5000003, "Testschool Gamma", 2016, "100002 Andere Klant BV", "TST-3", "765... E-Line", "Testveen", "-", "200001 Testgroothandel Oost", -5, -1000, -1000],
    ];
    const second = await parsed(v2);
    const prev = await db.historyPreview(second.rows);
    assert.deepEqual([prev.newRows, prev.updatedRows, prev.duplicates], [1, 3, 0], "Alfa ×2 en Beta: zelfde bronidentiteit, andere omschrijving");
    assert.equal(prev.possibleDuplicates, 1);
    assert.equal(prev.missingLines, 1);
    assert.equal(prev.projectUpdates, 2, "naam en straat van Alfa");
    assert.equal(prev.projectConflicts, 1, "naam van Beta");
    assert.ok(prev.conflicts.some((c) => /5000002: name gewijzigd in SAP, maar in Re-Line aangepast/.test(c)));
    assert.ok(prev.conflicts.some((c) => /5000003, boekjaar 2016: mogelijk dubbele regel/.test(c)));
    const r = await db.ingestHistory("v2.xlsx", second.rows);
    assert.deepEqual([r.added, r.updated, r.newProjects], [1, 3, 0]);
    const after = await db.projects();
    const a2 = after.find((x) => x.id === alfa.id)!;
    const b2 = after.find((x) => x.id === beta.id)!;
    assert.deepEqual([a2.name, a2.address], ["Testkantoor Alfa Noord", "Teststraat 3"]);
    assert.equal(b2.name, "Beta (eigen naam)", "lokale aanpassing blijft");
    assert.equal(Number((await db.one("SELECT COUNT(*) n FROM history_lines"))?.n), 5, "ontbrekende regel niet verwijderd");
    assert.equal(after.length, 3);
    // Derde keer hetzelfde bestand: niets nieuw, niets gewijzigd, geen herhaalde naammelding.
    const again = await db.historyPreview(second.rows);
    assert.deepEqual([again.newRows, again.updatedRows, again.projectUpdates, again.projectConflicts], [0, 0, 0, 0]);
  });
});

test("Migratie v3 → v4: bronsleutels op stabiele identiteit, bronrecords aangemaakt, niets dubbel", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reline-v4-"));
  try {
    const file = path.join(dir, "re-line.sqlite");
    const old = new DatabaseSync(file);
    old.exec(schemaV1 + migrations.find((m) => m.version === 2)!.sql + migrations.find((m) => m.version === 3)!.sql + "PRAGMA user_version=3;");
    old.exec(`INSERT INTO projects(id,name,city,address,project_number,match_key,confidence,notes) VALUES('p1','Testkantoor Alfa','Teststad','Teststraat 1','5000001','sapproject:5000001','Hoog','Notitie v3');
      INSERT INTO imports(id,filename,created,added,duplicates,warnings,kind) VALUES('i1','oud.xlsx','2026-11-03',2,0,'[]','Projecthistorie');
      INSERT INTO history_lines VALUES('h1','hist:oud1','p1','i1',3,'5000001','Testkantoor Alfa',2011,'100001','Testinstallateur BV','TST-1','765... E-Line Old','x','200001','Testgroothandel','Testplaats WE','Teststad','Teststraat 1','TX NL',120,50000,48000,'{}');
      INSERT INTO history_lines VALUES('h2','hist:oud2','p1','i1',4,'5000001','Testkantoor Alfa',2012,'100001','Testinstallateur BV','TST-2','765... E-Line','y','200001','Testgroothandel','Testplaats WE','Teststad','Teststraat 1','TX NL',80,30000,29000,'{}');`);
    old.close();
    const db = await Store.open(file);
    const keys = (await db.all("SELECT source_key FROM history_lines ORDER BY id")).map((r) => String(r.source_key));
    assert.ok(keys.every((k) => k.startsWith("hist2:")));
    const p = await parsed();
    assert.deepEqual(keys, p.rows.slice(0, 2).map((r) => r.key), "zelfde sleutel als een nieuwe import");
    const rec = await db.one("SELECT entity_id,values_json FROM source_records WHERE external_id='5000001'");
    assert.equal(rec?.entity_id, "p1");
    assert.equal(JSON.parse(String(rec?.values_json)).name, "Testkantoor Alfa");
    // Herimport van hetzelfde bestand na de migratie: Alfa-regels herkend, alleen de andere projecten nieuw.
    const r = await db.ingestHistory("opnieuw.xlsx", p.rows);
    assert.equal(r.added, 2);
    assert.equal((await db.projects()).find((x) => x.id === "p1")!.notes, "Notitie v3");
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projecthistorie bij bestaand dossier: alleen lege velden aangevuld, notities, status en acties blijven", async () => {
  const p = await parsed();
  await using(async (db) => {
    await db.run(
      `INSERT INTO projects(id,name,city,address,project_number,confidence,status,owner,notes,location_confirmed,location_evidence,need,need_evidence)
       VALUES('bestaand','Eigen dossiernaam','','Bevestigd adres 5','5000001','Hoog','Contact gelegd','Martijn','Belangrijke notitie',1,'Telefonisch bevestigd','Ja','Gesprek')`,
    );
    await db.addActivity("bestaand", { kind: "Bellen", note: "Terugbellen over opname", due: "2030-01-01", owner: "Martijn" });
    const r = await db.ingestHistory("test.xlsx", p.rows);
    assert.equal(r.newProjects, 2);
    const e = (await db.projects()).find((x) => x.id === "bestaand")!;
    assert.deepEqual(
      [e.name, e.status, e.owner, e.notes, e.address, e.location_confirmed, e.need, e.need_evidence],
      ["Eigen dossiernaam", "Contact gelegd", "Martijn", "Belangrijke notitie", "Bevestigd adres 5", 1, "Ja", "Gesprek"],
    );
    assert.equal(e.city, "Teststad", "lege plaats aangevuld");
    assert.equal(e.historyLines, 2);
    assert.equal((await db.dossier("bestaand")).activities[0].note, "Terugbellen over opname");
    assert.equal((await db.projects()).length, 3);
    // Bevestigingen tellen mee in de renovatiescore.
    const conf = e.scoreParts.find((s) => s.key === "historyConfirmed")!;
    assert.equal(conf.points, 8);
  });
});

test("Renovatiescore: punten en uitleg per criterium; recente projecten laag op ouderdom", async () => {
  const base = { lastYear: 2012, netRevenue: 77000, lines: 2, oldLines: 1, oldNetRevenue: 48000, name: "Testkantoor Alfa", city: "Teststad", hasStreet: true, customers: 1, recipients: 1, maxCustomerProjects: 5 };
  const old = renovationScore({ ...base, firstYear: 2011 }, 2026);
  const recent = renovationScore({ ...base, firstYear: 2023, lastYear: 2024, oldLines: 0, oldNetRevenue: 0 }, 2026);
  assert.equal(old.parts.length, 7);
  assert.equal(old.parts.reduce((s, p) => s + p.weight, 0), 100);
  const by = (r: typeof old, k: string) => r.parts.find((p) => p.key === k)!;
  assert.equal(by(old, "historyAge").points, 30);
  assert.equal(by(recent, "historyAge").points, 0);
  assert.match(by(recent, "historyAge").detail, /te recent voor renovatie/);
  assert.equal(by(old, "historySeries").points, 8 + Math.round(12 * (48000 / 77000)));
  assert.match(by(old, "historySize").detail, /geen installatieomvang/);
  assert.equal(by(old, "historyNetwork").points, 5);
  assert.ok(old.total > recent.total);
  const reasons = priorityReasons({ scoreParts: old.parts });
  assert.equal(reasons[0].label, "Ouderdom (eerste boekjaar)");
  assert.match(reasons[0].detail, /eerste boekjaar 2011/);
  assert.equal(reasons[0].max, 30);
});

test("Werkvoorraad renovatiekandidaten: vaste rangnummers en selectie, status blijft, afgesloten dossiers niet", async () => {
  const p = await parsed();
  await using(async (db) => {
    await db.ingestHistory("test.xlsx", p.rows);
    const gamma = (await db.projects()).find((x) => x.project_number === "5000003")!;
    await db.run("UPDATE projects SET status='Verloren',owner='Collega' WHERE id=?", String(gamma.id));
    const info = await db.selectCandidates(2);
    assert.deepEqual([info.selected, info.considered], [2, 2]);
    const ranked = (await db.projects()).filter((x) => x.candidate_rank != null).sort((a, b) => Number(a.candidate_rank) - Number(b.candidate_rank));
    assert.deepEqual(ranked.map((x) => x.project_number), ["5000001", "5000002"]);
    assert.equal((await db.projects()).find((x) => x.id === gamma.id)!.status, "Verloren");
    assert.equal((await db.projects()).find((x) => x.id === gamma.id)!.owner, "Collega");
    const sel = await db.all("SELECT * FROM selections WHERE name='Renovatiekandidaten top 2 (projecthistorie)'");
    assert.equal(sel.length, 1);
    assert.equal(JSON.parse(String(sel[0].project_ids)).length, 2);
    await db.selectCandidates(2);
    assert.equal((await db.all("SELECT * FROM selections WHERE name LIKE 'Renovatiekandidaten%'")).length, 1, "opnieuw bepalen vervangt de selectie");
    // Werkvoorraad-weergave: kandidaten op rang, projecthistorie op score, filters op reeks/plaats/omzet.
    const all = await db.projects() as never[];
    assert.deepEqual(worklist(all, { mode: "Renovatiekandidaten", minQuantity: 0, newestYear: null }).map((x: { project_number: string }) => x.project_number), ["5000001", "5000002"]);
    assert.equal(worklist(all, { mode: "Projecthistorie", minQuantity: 0, newestYear: 2020 }).length, 2);
    assert.equal(worklist(all, { mode: "Projecthistorie", minQuantity: 0, newestYear: null, series: "765... E-Line Old" }).length, 1);
    assert.equal(worklist(all, { mode: "Projecthistorie", minQuantity: 0, newestYear: null, city: "Testdorp" }).length, 1);
    assert.equal(worklist(all, { mode: "Projecthistorie", minQuantity: 0, newestYear: null, minRevenue: 50000 }).length, 1);
    assert.equal(worklist(all, { mode: "Orderregels", minQuantity: 0, newestYear: 2030 }).length, 0, "historie is geen orderregel");
    await assert.rejects(async () => await db.selectCandidates(0), /tussen 1 en 1000/);
    // Ontbrekende gegevens benoemen dat de bron geen orders/leveringen bevat.
    const dossier = await db.dossier(String(ranked[0].id));
    const missing = missingData(dossier as never);
    assert.match(missing.find((m) => m.label === "Levering niet bevestigd")!.action, /geen ordernummers, leverstatus/);
    assert.ok(missing.some((m) => m.label === "Generatie en uitvoering niet bevestigd"));
    // Samenvoegen neemt historie en de beste rang mee.
    await db.merge(String(ranked[1].id), [String(ranked[1].id), String(ranked[0].id)]);
    const merged = (await db.projects()).find((x) => x.id === ranked[1].id)!;
    assert.equal(merged.historyLines, 3);
    assert.equal(merged.candidate_rank, 1);
  });
});

test("Migratie v2 → nieuwste schema: back-up vooraf, gegevens behouden, historietabel leeg", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reline-v3-"));
  try {
    const file = path.join(dir, "re-line.sqlite");
    const old = new DatabaseSync(file);
    old.exec(schemaV1 + migrations.find((m) => m.version === 2)!.sql + "PRAGMA user_version=2;");
    old.exec(`INSERT INTO projects(id,name,confidence,notes,status,owner) VALUES('p1','Testhal','Middel','Notitie v2','Contact gelegd','Martijn');
      INSERT INTO activities(id,project_id,created,kind,note,contact,owner) VALUES('a1','p1','2026-01-02','Bellen','Belactie v2','','Martijn');`);
    old.close();
    const db = await Store.open(file);
    assert.equal((await db.one("PRAGMA user_version"))?.user_version, schemaVersion);
    const backups = readdirSync(path.join(dir, "backups"));
    assert.equal(backups.length, 1);
    assert.match(backups[0], new RegExp(`^re-line-voor-schema-v${schemaVersion}-`));
    const p = (await db.projects())[0];
    assert.deepEqual([p.notes, p.status, p.owner, p.candidate_rank, p.historyLines], ["Notitie v2", "Contact gelegd", "Martijn", null, 0]);
    assert.equal((await db.dossier("p1")).activities[0].note, "Belactie v2");
    assert.equal(Number((await db.one("SELECT COUNT(*) n FROM history_lines"))?.n), 0);
    assert.equal(await db.one("SELECT kind FROM imports LIMIT 1"), undefined);
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kandidatenselectie gebruikt alleen dossiers met projecthistorie", async () => {
  const r = rankCandidates(
    [
      { id: "a", name: "A", priority: 90, historyLines: 0 },
      { id: "b", name: "B", priority: 40, historyLines: 3, historyFirstYear: 2015 },
      { id: "c", name: "C", priority: 40, historyLines: 3, historyFirstYear: 2012 },
      { id: "d", name: "D", priority: 70, historyLines: 1, replaced: "Ja" },
    ],
    5,
  );
  assert.equal(r.considered, 2);
  assert.deepEqual(r.selected.map((x) => x.id), ["c", "b"], "gelijke score: oudste eerst");
});
