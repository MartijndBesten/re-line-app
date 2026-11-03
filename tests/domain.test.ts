import { test } from "node:test";
import assert from "node:assert/strict";
import { using } from "./support/store";
import { Store } from "../lib/db";
import { normalize, numberNL, dateNL, preview, readFile } from "../lib/import";
import { calculate } from "../lib/calculator";
import { score, defaultWeights } from "../lib/domain";
import ExcelJS from "exceljs";
// Synthetische gegevens: geen oorspronkelijke SAP-export of klantdossier.
const mapping = {
  order: "Order",
  position: "Positie",
  article: "Artikel",
  quantity: "Aantal",
  project: "Project",
  city: "Plaats",
  date: "Datum",
  debtor: "Debiteur",
  description: "Omschrijving",
  projectNumber: "Projectnummer",
  address: "Adres",
};
const row = (changes: Record<string, string> = {}) =>
  normalize(
    {
      Order: "900001",
      Positie: "10",
      Artikel: "TEST-A",
      Aantal: "152",
      Project: "Testgebouw 2",
      Plaats: "Teststad",
      Datum: "12.03.2010",
      Debiteur: "Testgroothandel",
      Omschrijving: "Lichtmodule -2,5",
      ...changes,
    },
    mapping,
  );
test("Europese getallen en echte kalenderdatums", async () => {
  assert.equal(numberNL("1.234,50"), 1234.5);
  assert.equal(numberNL("152"), 152);
  assert.equal(numberNL("0"), 0);
  assert.equal(numberNL("abc"), null);
  assert.equal(dateNL("29-02-2024"), "2024-02-29");
  assert.throws(() => dateNL("29-02-2023"), /Ongeldige datum/);
  assert.throws(() => dateNL("31.04.2020"), /Ongeldige datum/);
});
test("Samengestelde order/positie, multiline project en debiteur", async () => {
  const r = row({
    Order: "900001 / 0010",
    Positie: "",
    Project: "Testgebouw 2\nTeststad",
    Plaats: "",
    Debiteur: "Testdebiteur\n1234",
  });
  assert.equal(r.position, "10");
  assert.equal(r.project, "Testgebouw 2");
  assert.equal(r.city, "Teststad");
  assert.equal(r.debtorNumber, "1234");
});
test("Markdown br-regels en CSV quoted multiline correct ingelezen", async () => {
  const md =
    "| Order | Artikel | Aantal | Project |\n|---|---|---|---|\n|900001 / 10|TEST-A|152|Testgebouw<br>Teststad|";
  const p = preview(await readFile("bron.md", Buffer.from(md)));
  assert.equal(p.errors.length, 0);
  assert.equal(p.normalized[0].city, "Teststad");
  const csv =
    'Order;Artikel;Aantal;Project\n900001;TEST-A;152;"Testgebouw\nTeststad"';
  const c = preview(await readFile("bron.csv", Buffer.from(csv)));
  assert.equal(c.normalized[0].project, "Testgebouw");
});
test("XLSX waarden en Excel datumcellen", async () => {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("SAP");
  s.addRow(["Order", "Artikel", "Aantal", "Datum"]);
  s.addRow(["900001", "TEST-A", 152, new Date("2010-03-12T00:00:00Z")]);
  const b = await w.xlsx.writeBuffer();
  const p = preview(await readFile("bron.xlsx", Buffer.from(b)));
  assert.equal(p.normalized[0].date, "2010-03-12");
  assert.equal(p.normalized[0].quantity, 152);
});
test("Verplichte gegevens en handmatige koppeling worden gecontroleerd", async () => {
  const p = preview([{ X: "a", Y: "b", Z: "geen aantal" }], {
    order: "X",
    article: "Y",
    quantity: "Z",
  });
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0].message, /geldig aantal/);
  assert.throws(
    () => preview([{ X: "a" }], { order: "ontbreekt" }),
    /onbekende kolom/,
  );
});
test("Naam en plaats clusteren meerdere regels en orders; andere stad blijft apart", async () =>
  using(async (db) => {
    await db.ingest("a", [
      row(),
      row({ Positie: "20", Artikel: "TEST-B" }),
      row({ Order: "900002" }),
      row({ Order: "900003", Plaats: "Andere stad" }),
    ]);
    assert.equal((await db.projects()).length, 2);
    const p = (await db.projects()).find((p) => p.city === "Teststad")!;
    assert.equal(p.lineCount, 3);
    assert.equal(p.orderCount, 2);
    assert.equal(p.meters, null);
    assert.equal(p.relevantQuantity, 0);
    assert.equal(p.quantity, 456);
  }));
test("Exact SAP-projectnummer groepeert orders; debiteur alleen groepeert nooit gebouwen", async () =>
  using(async (db) => {
    await db.ingest("a", [
      row({ Projectnummer: "P-1" }),
      row({ Order: "900002", Projectnummer: "P-1", Project: "Fase II" }),
      row({ Order: "900003", Project: "", Plaats: "" }),
      row({ Order: "900004", Project: "", Plaats: "" }),
    ]);
    assert.equal((await db.projects()).length, 3);
    assert.equal(
      (await db.projects()).filter((p) => p.confidence === "Laag").length,
      2,
    );
  }));
test("Dubbele import creëert geen extra projecten en bewaart commerciële notities", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    const p = (await db.projects())[0];
    await db.updateProject(String(p.id), {
      notes: "Gecontroleerde notitie",
      status: "Contact gelegd",
    });
    const r = await db.ingest("nogmaals", [row(), row()]);
    assert.equal(r.added, 0);
    assert.equal(r.duplicates, 2);
    assert.equal((await db.projects()).length, 1);
    assert.equal((await db.projects())[0].notes, "Gecontroleerde notitie");
    assert.equal((await db.projects())[0].status, "Contact gelegd");
  }));
test("Zelfde bronidentiteit met gewijzigde waarden is conflict en geen overschrijving", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    const r = await db.ingest("b", [row({ Aantal: "999" })]);
    assert.equal(r.added, 0);
    assert.equal(r.conflicts.length, 1);
    assert.equal((await db.projects())[0].quantity, 152);
  }));
test("Ontbrekend afleveradres en artikel zonder bevestigde lengte blijven onbekend", async () =>
  using(async (db) => {
    await db.ingest("a", [row()]);
    let p = (await db.projects())[0];
    assert.equal(p.location_confirmed, 0);
    assert.equal(p.meters, null);
    const dossier = await db.dossier(String(p.id));
    assert.match(String(dossier.lines[0].warnings), /Afleveradres ontbreekt/);
    await db.run(
      "UPDATE catalog SET family='E-Line',length=2.5,confirmed=0 WHERE article='TEST-A'",
    );
    assert.equal((await db.projects())[0].meters, null);
    await db.run(
      "UPDATE catalog SET confirmed=1,evidence='Synthetische testdatasheet' WHERE article='TEST-A'",
    );
    p = (await db.projects())[0];
    assert.equal(p.meters, 380);
    assert.equal(p.relevantQuantity, 152);
    assert.equal(p.location_confirmed, 0);
  }));
test("Samenvoegen en splitsen behouden bronregels, dossiergegevens en importherkenning", async () =>
  using(async (db) => {
    await db.ingest("a", [row(), row({ Order: "900002", Project: "Ander gebouw" })]);
    const [a, b] = await db.projects();
    await db.updateProject(String(b.id), { notes: "Notitie tweede project" });
    await db.merge(String(a.id), [String(b.id)]);
    assert.equal((await db.projects()).length, 1);
    assert.equal((await db.dossier(String(a.id))).lines.length, 2);
    assert.match(
      String((await db.dossier(String(a.id))).activities[0].note),
      /Notitie tweede project/,
    );
    await db.ingest("b", [row({ Order: "900003", Project: "Ander gebouw" })]);
    assert.equal((await db.projects()).length, 1);
    const line = String((await db.dossier(String(a.id))).lines[0].id);
    const newId = await db.split(String(a.id), [line], "Afgesplitst");
    assert.equal((await db.projects()).length, 2);
    assert.equal((await db.dossier(newId.id)).lines.length, 1);
    assert.equal((await db.all("SELECT * FROM order_lines")).length, 3);
    await assert.rejects(
      async () => await db.split(String(a.id), [line], "Fout"),
      /deel van de regels/,
    );
  }));
test("Geen fictieve standaardprijzen; onvolledig scenario heeft geen totaal", async () => {
  const empty = {
    meters: null,
    modules: null,
    material: null,
    installation: null,
    commissioning: null,
    other: null,
    technicalConfirmed: false,
    priceSource: "",
    notes: "",
  };
  assert.equal(calculate(empty).total, null);
  assert.equal(
    calculate({
      ...empty,
      meters: 100,
      modules: 20,
      material: 1000,
      installation: 200,
      commissioning: 100,
      other: 0,
      technicalConfirmed: true,
      technicalBy: "Synthetische controleur",
      priceSource: "Eigen testtarief",
      priceDate: "2026-10-01",
    }).total,
    1300,
  );
  assert.throws(
    () => calculate({ ...empty, material: -1 }),
    /Ongeldige calculatiewaarde/,
  );
});
test("Prioriteit scheidt omvang en kwaliteit en leidt geen leeftijd af uit ontbrekende datum", async () => {
  const p = {
    firstYear: null,
    quantity: 1000,
    orderCount: 1,
    quality: 0,
    locationConfirmed: 0,
    relationshipConfirmed: 0,
    need: "Onbekend",
  };
  const s = score(p, defaultWeights, 2026);
  assert.equal(s.parts.find((p) => p.key === "age")!.points, 0);
  assert.equal(s.parts.find((p) => p.key === "quality")!.points, 0);
  assert.equal(s.parts.find((p) => p.key === "size")!.points, 20);
  assert.ok(s.total < 60);
});

test("Positie-opmaak en conflicten binnen hetzelfde bestand creëren geen extra regels", async () =>
  using(async (db) => {
    const a = row({ Positie: "0010" }),
      b = row({ Positie: "10", Aantal: "153" });
    assert.equal(a.key, b.key);
    const result = await db.ingest("synthetisch", [a, b]);
    assert.equal(result.added, 1);
    assert.equal(result.duplicates, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal((await db.projects())[0].quantity, 152);
  }));

test("Historische bronprijs herkent EUR en blijft gescheiden van aantallen en renovatieprijzen", async () => {
  const raw = {
    ordernummer: "900101",
    positie: "10",
    artikelnummer: "TEST-PRICE",
    aantal: "3",
    nettoprijs_bron: "1.234,56 EUR",
  };
  const p = preview([raw]);
  assert.equal(p.mapping.price, "nettoprijs_bron");
  assert.equal(p.errors.length, 0);
  assert.equal(p.normalized[0].price, 1234.56);
  assert.equal(p.normalized[0].quantity, 3);
  assert.equal(p.normalized[0].raw.nettoprijs_bron, "1.234,56 EUR");
  assert.equal(
    preview([{ ...raw, nettoprijs_bron: "0,00 EUR" }]).normalized[0].price,
    0,
  );
  assert.equal(
    preview([{ ...raw, nettoprijs_bron: "9,95 USD" }]).errors[0].message,
    "Ongeldige historische prijs",
  );
});
