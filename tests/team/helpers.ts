import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
// Uitsluitend fictieve gebruikers en synthetische gegevens.
export const tag = process.env.RELINE_TEAM_PG === "1" ? "pg" : "sqlite";
export const serverState = (port: number) => JSON.parse(readFileSync(`test-results/team/state-${port}-${tag}.json`, "utf8"));
export async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
}
export async function activate(page: Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Account activeren" })).toBeVisible();
  await page.getByLabel("Nieuw wachtwoord").fill(password);
  await page.getByLabel("Herhaal wachtwoord").fill(password);
  await page.getByRole("button", { name: "Activeren en aanmelden" }).click();
}
export async function historyWorkbook() {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const d = book.addWorksheet("Details");
  d.addRow(["OrgStruktur St.2", "Projektnummer", "Großprojekt E-Line", "Projektbezeichnung", "Geschäftsjahr", "Kd.stamm.Kunde+Name",
    "Material.Material", "Material.Baureihe Bez.", "Material.Material Bez.", "Ort des  Warenempfängers", "Projekt Ort", "Projekt Straße",
    "Warenempfänger Bez.", "Absatz ", "Umsatz ", "Net-/Net-Umsatz", "Bonus+Skonto", "KdUmsatzes", "SOF Leistung", "varHK DBW", "HK DBW", "DBW II", "DBW II %"]);
  const row = (nr: number, name: string, year: number, series: string, city: string, net: number) =>
    d.addRow(["TX NL", nr, "X", name, String(year), "100001 Synthetische installateur BV", "SYN-" + year, series, "Synthetisch profiel",
      "Testplaats WE", city, "-", "200001 Synthetische groothandel", 10, net, net, 1, 2, 3, 4, 5, 6, 0.1]);
  row(7000001, "Synthetisch kantoor Alfa", 2011, "765... E-Line Old", "Teststad", 90000);
  row(7000001, "Synthetisch kantoor Alfa", 2013, "765... E-Line", "Teststad", 10000);
  row(7000002, "Synthetische hal Beta", 2024, "765... E-Line", "Testdorp", 5000);
  return { name: "synthetisch-projectrapport.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}
