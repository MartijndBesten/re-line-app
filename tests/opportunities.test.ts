import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLead, leadsForReview, exportLeadCsv, csvCell } from "../lib/opportunities";
import type { LeadInput } from "../lib/opportunities";

function example(overrides: Partial<LeadInput> = {}): LeadInput {
  return { id: "p1", name: "Testgebouw", city: "Teststad", firstYear: 2016, lastYear: 2018,
    quantity: 152, orderCount: 1, quality: 40, priority: 31, location_confirmed: 0,
    status: "Nieuw gevonden", replaced: "Onbekend", debtors: "Testdebiteur", installerNames: "",
    ...overrides };
}
test("Geen contactadvies als gebouw onbekend of vervangen", () => {
  assert.equal(evaluateLead(example({ name: "Onbekend project · 900001" })).stage, "Brononderzoek");
  assert.equal(evaluateLead(example({ city: "" })).stage, "Brononderzoek");
  assert.equal(evaluateLead(example({ replaced: "Ja", location_confirmed: 1 })).stage, "Afgesloten");
  assert.equal(evaluateLead(example({ status: "Afspraak gepland", location_confirmed: 1 })).stage, "Al in opvolging");
  assert.equal(evaluateLead(example({ location_confirmed: 1 })).stage, "Contact voorbereiden");
});
test("Minimale aantallen, leeftijd, statusfilter en sortering", () => {
  const a = example({ id:"a", quantity:300 });
  const b = example({ id:"b", quantity:152, name:"Onbekend project · 4" });
  const c = example({ id:"c", firstYear:2024, quantity:900 });
  const d = example({ id:"d", quantity:10 });
  assert.deepEqual(leadsForReview([b,d,a,c],{minQuantity:100,newestYear:2021}).map(x=>x.id),["a","b"]);
  assert.deepEqual(leadsForReview([b,d,a,c],{minQuantity:100,newestYear:2021,mode:"Brononderzoek"}).map(x=>x.id),["b"]);
});
test("CSV export is veilig tegen spreadsheetformules en behoudt onbekenden", () => {
  assert.equal(csvCell(" =HYPERLINK(\"https://example.org\")"), '"\' =HYPERLINK(""https://example.org"")"');
  const csv=exportLeadCsv([example({name:"=1+1",city:null,debtors:"+123",firstYear:null})]);
  assert.match(csv,/"'=1\+1"/);
  assert.match(csv,/"'\+123"/);
  assert.match(csv,/"Laatste orderjaar";"Aantal historische stuks"/);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n").length,3);
});

test("Kansklasse los van de rang: kansrijk (≥ 10 jaar of E-Line Old), later bekijken (niet afgeschreven), afgesloten", async () => {
  const { renovationClass } = await import("../lib/opportunities");
  const base = { historyLines: 2, status: "Nieuw gevonden", replaced: "Onbekend", oldSeriesLines: 0 };
  assert.equal(renovationClass({ ...base, historyLines: 0 }), null, "zonder projecthistorie geen klasse");
  assert.equal(renovationClass({ ...base, historyFirstYear: 2014 }, 2026)?.klasse, "Kansrijk");
  assert.match(renovationClass({ ...base, historyFirstYear: 2014 }, 2026)!.reden, /2014 \(12 jaar\)/);
  assert.equal(renovationClass({ ...base, historyFirstYear: 2022, oldSeriesLines: 1 }, 2026)?.klasse, "Kansrijk");
  const later = renovationClass({ ...base, historyFirstYear: 2022, candidate_rank: 80 }, 2026)!;
  assert.equal(later.klasse, "Later bekijken", "een plek in de top 100 maakt een recent project niet kansrijk");
  assert.match(later.reden, /te recent; rang 80 in de werkvoorraad/);
  assert.equal(renovationClass({ ...base, candidate_rank: 3, status: "Verloren" })?.klasse, "Afgesloten");
  assert.equal(renovationClass({ ...base, replaced: "Ja" })?.klasse, "Afgesloten");
});
