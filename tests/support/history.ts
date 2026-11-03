import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { excludedColumns, parseHistoryWorkbook } from "../../lib/history";
// Synthetisch SAP-rapport "E-Line Projects" (blad Details) voor tests. Uitsluitend verzonnen waarden.

export const headers = [
  "OrgStruktur St.2", "Projektnummer", "Großprojekt E-Line", "Projektbezeichnung", "Geschäftsjahr",
  "Kd.stamm.Kunde+Name", "Material.Material", "Material.Baureihe Bez.", "Material.Material Bez.",
  "Ort des  Warenempfängers", "Projekt Ort", "Projekt Straße", "Warenempfänger Bez.", "Absatz ", "Umsatz ",
  "Net-/Net-Umsatz", ...excludedColumns,
];
export type Line = [number, string, number, string, string, string, string, string, string, number, number, number];
export const line = ([nr, name, year, customer, material, series, city, street, recipient, qty, rev, net]: Line) => [
  "TX NL", nr, "X", name, String(year), customer, material, series, "Testprofiel " + material, "Testplaats WE",
  city, street, recipient, qty, rev, net, 11, 22, 33, 44, 55, 66, 0.5,
];
export const sample: Line[] = [
  [5000001, "Testkantoor Alfa", 2011, "100001 Testinstallateur BV", "TST-1", "765... E-Line Old", "Teststad", "Teststraat 1", "200001 Testgroothandel", 120, 50000, 48000],
  [5000001, "Testkantoor Alfa", 2012, "100001 Testinstallateur BV", "TST-2", "765... E-Line", "Teststad", "Teststraat 1", "200001 Testgroothandel", 80, 30000, 29000],
  [5000002, "Testhal Beta", 2023, "100001 Testinstallateur BV", "TST-2", "765... E-Line", "Testdorp", "-", "200002 Testontvanger", 10, 4000, 3900],
  [5000003, "Testschool Gamma", 2016, "100002 Andere Klant BV", "TST-3", "765... E-Line", "Testveen", "-", "200001 Testgroothandel", -5, -1000, -1000],
];
export async function workbook(lines: Line[], extra: unknown[][] = []) {
  const book = new ExcelJS.Workbook();
  const overview = book.addWorksheet("Overview");
  overview.addRow([]);
  overview.addRow([]);
  overview.addRow(["Zeilenbeschriftungen", "Summe von Umsatz "]);
  const d = book.addWorksheet("Details");
  d.addRow(headers);
  d.addRow(["Total", null, null, null, null, null, null, null, null, null, null, null, null, 195, 83000, 79900, 1, 1, 1, 1, 1, 1, 1]);
  for (const l of lines) d.addRow(line(l));
  for (const r of extra) d.addRow(r);
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function parsed(lines = sample) {
  const p = await parseHistoryWorkbook(await workbook(lines));
  assert.ok(p, "rapport herkend");
  return p!;
}
