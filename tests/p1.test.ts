import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { using } from "./support/store";
import { Store, schemaV1, schemaVersion } from "../lib/db";
import { normalize, preview, detect, aliases } from "../lib/import";
import { canonical } from "../lib/domain";
import { calculate } from "../lib/calculator";
import { cleanMapping, matchProfile, sapGermanExpected } from "../lib/profiles";
import { missingData, relatedProjects, priorityReasons } from "../lib/dossier";
import { dueBucket, workItems } from "../lib/worklist";
import { latestAnswers, makeInternalBrief } from "../lib/commercial";
// Uitsluitend synthetische gegevens.
const mapping = {
  order: "Order",
  position: "Positie",
  article: "Artikel",
  quantity: "Aantal",
  project: "Project",
  city: "Plaats",
  date: "Datum",
  debtor: "Debiteur",
};
const row = (changes: Record<string, string> = {}) =>
  normalize(
    {
      Order: "900001",
      Positie: "10",
      Artikel: "TEST-A",
      Aantal: "152",
      Project: "Testhal",
      Plaats: "Teststad",
      Datum: "12.03.2012",
      Debiteur: "Testgroothandel",
      ...changes,
    },
    mapping,
  );
const firstId = async (db: Store) => String((await db.projects())[0].id);

test("Migratie v1 → nieuwste schema maakt eerst een back-up en behoudt alle gegevens", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reline-migratie-"));
  try {
    const file = path.join(dir, "re-line.sqlite");
    const old = new DatabaseSync(file);
    old.exec(schemaV1 + "PRAGMA user_version=1;");
    old.exec(`INSERT INTO projects(id,name,confidence,notes,present) VALUES('p1','Testhal','Middel','Oude notitie','Ja');
      INSERT INTO imports VALUES('i1','oud.csv','2026-01-01',2,0,'[]');
      INSERT INTO order_lines VALUES('l1','k1','p1','i1',2,'SAP','900001','10','TEST-A','',152,'2012-03-12','Order',NULL,'','','','','{"Order":"900001","TOC":"T-1","productfamilie":"E-Line","Status":"storniert"}','[]');
      INSERT INTO order_lines VALUES('l2','k2','p1','i1',3,'SAP','900002','10','TEST-A','',-2,'2012-04-01','Order',NULL,'','','','','{}','[]');
      INSERT INTO activities VALUES('a1','p1','2026-01-02','Bellen','Oude belactie','','',NULL,0,'');`);
    old.close();
    const db = await Store.open(file);
    assert.equal((await db.one("PRAGMA user_version"))?.user_version, schemaVersion);
    const backups = readdirSync(path.join(dir, "backups"));
    assert.equal(backups.length, 1);
    assert.match(backups[0], new RegExp(`^re-line-voor-schema-v${schemaVersion}-.*\\.sqlite$`));
    const copy = new DatabaseSync(path.join(dir, "backups", backups[0]));
    assert.equal(copy.prepare("PRAGMA user_version").get()?.user_version, 1);
    assert.equal(copy.prepare("SELECT notes FROM projects").get()?.notes, "Oude notitie");
    copy.close();
    const p = (await db.projects())[0];
    assert.equal(p.notes, "Oude notitie");
    assert.equal(p.present, "Ja");
    assert.equal(p.quantity, 150);
    assert.equal((await db.one("SELECT line_state FROM order_lines WHERE id='l2'"))?.line_state, "Retour/correctie");
    // Beschrijvende bronvelden aangevuld uit raw; status/telling bewust niet herberekend.
    const l1 = await db.one("SELECT toc,family_source,order_status,counted FROM order_lines WHERE id='l1'")!;
    assert.deepEqual({ ...l1 }, { toc: "T-1", family_source: "E-Line", order_status: "", counted: 1 });
    assert.equal((await db.dossier("p1")).activities[0].note, "Oude belactie");
    // Bestaande onbewezen "Ja" blokkeert gewone opslag niet; alleen een nieuwe claim vraagt bewijs.
    await db.updateProject("p1", { notes: "Nieuwe notitie", present: "Ja" });
    assert.equal((await db.projects())[0].notes, "Nieuwe notitie");
    assert.equal((await db.all("SELECT * FROM audit WHERE action='Schemamigratie'")).length, schemaVersion - 1);
    await db.close();
    // Tweede keer openen: geen nieuwe migratie en geen nieuwe back-up.
    await (await Store.open(file)).close();
    assert.equal(readdirSync(path.join(dir, "backups")).length, 1);
    const future = new DatabaseSync(file);
    future.exec(`PRAGMA user_version=${schemaVersion + 1}`);
    future.close();
    await assert.rejects(async () => Store.open(file), /nieuwste versie/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Bevestigingen vereisen bron; locatie vereist adres en bron", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    const id = await firstId(db);
    await assert.rejects(async () => await db.updateProject(id, { present: "Ja" }), /aanwezigheid van de installatie/);
    await assert.rejects(async () => await db.updateProject(id, { need: "Ja" }), /renovatiebehoefte/);
    await db.updateProject(id, { present: "Ja", present_evidence: "Telefoon 2026-10-08, beheerder" });
    assert.equal((await db.projects())[0].present, "Ja");
    await assert.rejects(async () => await db.updateProject(id, { location_confirmed: 1 }), /vereist een adres/);
    await assert.rejects(
      async () => await db.updateProject(id, { location_confirmed: 1, address: "Teststraat 1" }),
      /installatielocatie is gecontroleerd/,
    );
    await db.updateProject(id, { location_confirmed: 1, address: "Teststraat 1", location_evidence: "Bezoek 2026-10-08" });
    assert.equal((await db.projects())[0].location_confirmed, 1);
    // Terug naar "Onbekend" mag altijd.
    await db.updateProject(id, { present: "Onbekend", present_evidence: "" });
    assert.equal((await db.projects())[0].present, "Onbekend");
  }));

test("Gespreksregistratie: verslag, antwoorden, afronden, vervolgactie en alleen expliciete bevestigingen", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    const id = await firstId(db);
    const planned = await db.addActivity(id, { kind: "Bellen", note: "Eerste belpoging", due: "2026-10-09" });
    const base = {
      contact: "Synthetische beheerder",
      contactRole: "Gebouwbeheerder",
      channel: "Telefoon",
      outcome: "Contact gelegd – informatie verzameld",
      note: "Installatie volgens beheerder nog aanwezig.",
      answers: { aanwezig: { answer: "Ja", note: "hal 1 en 2" }, branduren: { answer: "Onbekend", note: "" } },
    };
    await assert.rejects(async () => await db.logCall(id, { ...base, contactRole: "Onzin" }), /rol van de contactpersoon/);
    await assert.rejects(async () => await db.logCall(id, { ...base, outcome: "" }), /uitkomst/);
    await assert.rejects(async () => await db.logCall(id, { ...base, answers: { onbekend: { answer: "Ja" } } }), /Onbekende gespreksvraag/);
    // Antwoord "Ja" zonder expliciete bevestiging wijzigt het dossier niet.
    await db.logCall(id, { ...base, completeActivityId: planned });
    let d = await db.dossier(id);
    assert.equal(d.present, "Onbekend");
    assert.equal(d.contact, "Synthetische beheerder");
    const verslag = d.activities.find((a) => a.kind === "Gespreksverslag")!;
    assert.deepEqual(JSON.parse(String(verslag.answers)), { aanwezig: { answer: "Ja", note: "hal 1 en 2" } });
    assert.equal(d.activities.find((a) => a.id === planned)!.done, 1);
    assert.match(String(d.activities.find((a) => a.id === planned)!.result), /Contact gelegd/);
    await assert.rejects(
      async () => await db.logCall(id, { ...base, completeActivityId: planned }),
      /al afgerond/,
    );
    await assert.rejects(async () => await db.logCall(id, { ...base, confirm: { location: true } }), /gecontroleerde adres/);
    await db.logCall(id, {
      ...base,
      confirm: { present: "Ja", need: "Ja", location: true, address: "Teststraat 9", installer: "Testinstallateur" },
      followUp: { kind: "Afspraak", due: "2026-10-20", note: "Technische opname" },
      status: "Installatie bevestigd",
    });
    d = await db.dossier(id);
    assert.equal(d.present, "Ja");
    assert.equal(d.need, "Ja");
    assert.equal(d.location_confirmed, 1);
    assert.equal(d.address, "Teststraat 9");
    assert.match(String(d.present_evidence), /^Gesprek \d{4}-\d{2}-\d{2} met Synthetische beheerder \(Gebouwbeheerder, Telefoon\)$/);
    assert.equal(d.status, "Installatie bevestigd");
    assert.ok(d.relations.some((r) => r.name === "Testinstallateur" && r.role === "Installateur"));
    assert.equal(d.installerNames, "Testinstallateur");
    assert.ok(d.activities.some((a) => a.kind === "Afspraak" && a.due === "2026-10-20" && !a.done));
    const answers = latestAnswers(d.activities as never);
    assert.equal(answers.aanwezig?.answer, "Ja");
    assert.equal(answers.branduren, undefined);
    const brief = makeInternalBrief(d as unknown as Parameters<typeof makeInternalBrief>[0]);
    assert.match(brief, /→ Ja: hal 1 en 2/);
    assert.match(brief, /Open actie: Afspraak · 2026-10-20/);
  }));

test("Bulkactie wijzigt alleen gekozen velden en weigert onbekende dossiers zonder deelwijziging", async () =>
  using(async (db) => {
    await db.ingest("a", [row(), row({ Order: "900002", Project: "Andere hal" })]);
    const ids = (await db.projects()).map((p) => String(p.id));
    await assert.rejects(async () => await db.bulk([...ids, "bestaat-niet"], { owner: "Tester" }), /niet gevonden/);
    assert.ok((await db.projects()).every((p) => p.owner === ""));
    await assert.rejects(async () => await db.bulk(ids, {}), /Kies wat/);
    await db.bulk(ids, { owner: "Tester", status: "Geselecteerd voor contact", plan: { kind: "Bellen", due: "2026-10-12", note: "Eerste contact" } });
    const ps = await db.projects();
    assert.ok(ps.every((p) => p.owner === "Tester" && p.status === "Geselecteerd voor contact" && p.openActions === 1));
    assert.equal(ps[0].nextDue, "2026-10-12");
    // statusFrom laat een lopend traject niet terugvallen.
    await db.updateProject(ids[0], { status: "Afspraak gepland" });
    await db.bulk(ids, { status: "Nader onderzoeken", statusFrom: ["Nieuw gevonden", "Geselecteerd voor contact"] });
    assert.deepEqual((await db.projects()).map((p) => p.status).sort(), ["Afspraak gepland", "Nader onderzoeken"]);
  }));

test("Gezamenlijke afspraak bij een relatie is één werkvoorraadregel en rondt samen af", async () =>
  using(async (db) => {
    await db.ingest("a", [row(), row({ Order: "900002", Project: "Andere hal" })]);
    const rel = (await db.one("SELECT id FROM relations WHERE role='Debiteur'"))!;
    const ids = (await db.projects()).map((p) => String(p.id));
    const { groupId } = await db.groupActivity(String(rel.id), ids, { kind: "Afspraak", due: "2026-10-15" });
    const acts = (await db.snapshot()).activities as never[];
    const items = workItems(acts, { today: new Date(2026, 9, 8) });
    assert.equal(items.length, 1);
    assert.equal(items[0].projects.length, 2);
    assert.equal(items[0].bucket, "Later");
    assert.match(items[0].note, /Gezamenlijk gesprek met Testgroothandel over 2/);
    await db.completeActivity(items[0].id, true, true);
    assert.equal((await db.all("SELECT * FROM activities WHERE group_id=? AND done=0", groupId)).length, 0);
  }));

test("Werkvoorraad deelt in op achterstallig/vandaag/deze week/later", async () => {
  const today = new Date(2026, 9, 8); // donderdag
  assert.equal(dueBucket("2026-10-07", today), "Achterstallig");
  assert.equal(dueBucket("2026-10-08", today), "Vandaag");
  assert.equal(dueBucket("2026-10-11", today), "Deze week");
  assert.equal(dueBucket("2026-10-12", today), "Later");
  assert.equal(dueBucket(null, today), "Zonder datum");
  const acts = [
    { id: "1", project_id: "p", kind: "Bellen", due: "2026-10-12", owner: "A" },
    { id: "2", project_id: "p", kind: "Bellen", due: "2026-10-01", owner: "B" },
    { id: "3", project_id: "p", kind: "Notitie", due: "2026-10-01", owner: "A" },
    { id: "4", project_id: "p", kind: "Afspraak", due: null, owner: "", done: 0 },
    { id: "5", project_id: "p", kind: "Bellen", due: "2026-10-01", owner: "A", done: 1 },
  ];
  assert.deepEqual(workItems(acts, { today }).map((i) => i.id), ["2", "1", "4"]);
  assert.deepEqual(workItems(acts, { owner: "A", today }).map((i) => i.id), ["1"]);
  assert.deepEqual(workItems(acts, { owner: "__none__", today }).map((i) => i.id), ["4"]);
});

test("Duitse SAP-kolommen, stabiele regel-ID, annuleringen en eenheden", async () => {
  for (const e of sapGermanExpected)
    for (const c of e.columns)
      assert.ok(aliases[e.field].includes(canonical(c)), `${c} hoort bij ${e.field}`);
  const headers = ["Verkaufsbeleg", "Position", "Material", "Materialkurztext", "ME", "Auftragsmenge", "Liefermenge",
    "Erstelldatum", "Lieferdatum", "Gesamtstatus", "Warenempfänger", "PLZ", "Ort", "Land", "Währung", "Zeilen-ID"];
  const m = detect(headers);
  assert.equal(m.order, "Verkaufsbeleg");
  assert.equal(m.unit, "ME");
  assert.equal(m.deliveredQuantity, "Liefermenge");
  assert.equal(m.recipient, "Warenempfänger");
  assert.equal(m.currency, "Währung");
  assert.equal(m.lineId, "Zeilen-ID");
  assert.equal(new Set(Object.values(m)).size, Object.values(m).length);
  const base = { Verkaufsbeleg: "800001", Position: "10", Material: "TEST-DE", Materialkurztext: "Testprofil", ME: "ST",
    Auftragsmenge: "10", Liefermenge: "8", Erstelldatum: "01.02.2011", Lieferdatum: "15.03.2011", Gesamtstatus: "erledigt",
    "Warenempfänger": "Testempfänger", PLZ: "1234 AB", Ort: "Teststadt", Land: "NL", "Währung": "EUR", "Zeilen-ID": "Z-1" };
  const p = preview([
    base,
    { ...base, "Zeilen-ID": "Z-2", Position: "20", Gesamtstatus: "storniert" },
    { ...base, "Zeilen-ID": "Z-3", Position: "30", ME: "M", Auftragsmenge: "25" },
  ]);
  assert.equal(p.errors.length, 0);
  const [a, b, c] = p.normalized;
  assert.equal(a.deliveredQuantity, 8);
  assert.equal(a.deliveryDate, "2011-03-15");
  assert.equal(a.lineState, "Normaal");
  assert.equal(b.lineState, "Geannuleerd");
  assert.equal(b.counted, 0);
  assert.equal(c.counted, 0);
  assert.match(c.warnings.join(), /Eenheid M/);
  // Regel-ID bepaalt de identiteit: zelfde ID met ander positienummer is dezelfde bronregel.
  assert.equal(
    preview([{ ...base, Position: "99" }]).normalized[0].key,
    a.key,
  );
  await using(async (db) => {
    await db.ingest("de.csv", p.normalized, { profile: "Test", sha256: "abc", totalRows: 3 });
    const proj = (await db.projects())[0];
    assert.equal(proj.quantity, 10);
    assert.equal(proj.deliveredQuantity, 24);
    assert.equal(proj.excludedLines, 2);
    assert.equal((await db.previousImports("abc")).length, 1);
    assert.equal((await db.one("SELECT recipient_number,postcode,line_state FROM order_lines WHERE line_id='Z-2'"))?.line_state, "Geannuleerd");
  });
});

test("Importprofielen: opslaan, herkennen op kolommen en ongeldige koppeling weigeren", async () =>
  using(async (db) => {
    assert.throws(() => cleanMapping({ order: "A", article: "A", quantity: "B" }), /meer dan één veld/);
    assert.throws(() => cleanMapping({ order: "A" }), /ordernummer, artikelcode en aantal/);
    assert.throws(() => cleanMapping({ order: "A", article: "B", quantity: "C", geheim: "D" }), /Onbekend veld/);
    await db.saveProfile("Duits test", { order: "Beleg", article: "Mat", quantity: "Menge X", position: "" });
    await db.saveProfile("Duits test", { order: "Beleg", article: "Mat", quantity: "Menge X", position: "Pos" });
    const profiles = await db.profiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].mapping.position, "Pos");
    assert.equal(matchProfile(["Beleg", "Pos", "Mat", "Menge X", "Extra"], profiles)?.name, "Duits test");
    assert.equal(matchProfile(["Beleg", "Mat"], profiles), null);
  }));

test("Clusterpreview toont nieuwe en bestaande dossiers zonder op te slaan", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    const r = await db.clusterPreview([
      row(),
      row({ Order: "900002" }),
      row({ Order: "900003", Project: "Nieuwe hal" }),
      row({ Order: "900004", Project: "", Plaats: "" }),
    ]);
    assert.deepEqual(r, { newProjects: 2, existingProjects: 1, byConfidence: { Hoog: 0, Middel: 1, Laag: 1 } });
    assert.equal((await db.projects()).length, 1);
  }));

test("Ontbrekende gegevens, verwante dossiers en uitleg prioriteit", async () =>
  using(async (db) => {
    await db.ingest("a", [
      row(),
      row({ Order: "900002", Project: "Testhal 2" }),
      row({ Order: "900003", Project: "Testhal 2", Plaats: "Andere stad" }),
      row({ Order: "900004", Project: "Kantoor Testhal Noord" }),
      row({ Order: "900005", Project: "", Plaats: "" }),
    ]);
    const all = await db.projects() as never[] as Parameters<typeof relatedProjects>[1];
    const hal = all.find((p) => p.name === "Testhal" && p.city === "Teststad")!;
    const related = relatedProjects(hal, all);
    assert.deepEqual(related.map((r) => r.project.name).sort(), ["Kantoor Testhal Noord", "Testhal 2"]);
    assert.match(related.find((r) => r.project.name === "Testhal 2")!.reason, /mogelijk andere fase/);
    const unknown = all.find((p) => /^Onbekend project/.test(p.name))!;
    assert.equal(relatedProjects(unknown, all).length, 0);
    const d = await db.dossier(String(hal.id));
    const missing = missingData(d as never).map((m) => m.label);
    for (const label of ["Levering niet bevestigd", "Installatielocatie niet bevestigd", "Huidige installateur onbekend",
      "Aanwezigheid oude installatie onbekend", "Artikel niet bevestigd geclassificeerd", "Geen verantwoordelijke", "Geen geplande vervolgactie"])
      assert.ok(missing.includes(label), label);
    assert.ok(!missing.includes("Projectnaam onbekend"));
    assert.ok(missingData(await db.dossier(String(unknown.id)) as never).some((m) => m.label === "Projectnaam onbekend" && /900005/.test(m.action)));
    const reasons = priorityReasons(d, 2026);
    assert.match(reasons.find((r) => r.key === "age")!.detail, /oudste order 2012 \(14 jaar geleden\)/);
    assert.match(reasons.find((r) => r.key === "size")!.detail, /niet bevestigd als E-\/C-Line: telt niet mee/);
  }));

test("Scenario vereist prijsbron met peildatum en technische controle met naam", async () => {
  const full = { meters: 50, modules: 10, material: 1000, installation: 200, commissioning: 50, other: 0,
    technicalConfirmed: true, technicalBy: "Testcontroleur", priceSource: "Testbron", priceDate: "2026-10-01", notes: "" };
  assert.equal(calculate(full).total, 1250);
  assert.equal(calculate(full).perMeter, 25);
  assert.deepEqual(calculate({ ...full, priceDate: "" }).missing, ["peildatum prijzen"]);
  assert.equal(calculate({ ...full, technicalBy: "" }).total, null);
  assert.equal(calculate({ ...full, meters: 0 }).perMeter, null);
});
