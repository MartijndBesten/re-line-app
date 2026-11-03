import { test, expect, type Page } from "@playwright/test";
// Uitsluitend synthetische gegevens; iedere run gebruikt een nieuwe SQLite-database (playwright.config.ts).
test.describe.configure({ mode: "serial" });
const csv =
  "Order;Positie;Artikel;Aantal;Project;Plaats;Datum;Debiteur\n900001;10;TEST-A;152;Testgebouw Browser;Teststad;12.03.2010;Testdebiteur\n900001;20;TEST-B;20;Testgebouw Browser;Teststad;12.03.2010;Testdebiteur";
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function importFile(page: Page, text = csv, name = "synthetische-bron.csv") {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(page.getByRole("heading", { name: "Veldkoppeling" })).toBeVisible();
  await page.getByRole("button", { name: "Import bevestigen" }).click();
  await expect(page.getByRole("status")).toContainText("nieuwe regels opgeslagen");
}
async function openDossier(page: Page, name = "Testgebouw Browser") {
  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();

test("Volledige lokale workflow: import, dossier, belactie, relatie, classificatie, scenario en concept", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Aan de slag" })).toBeVisible();
  await importFile(page);
  await openDossier(page);
  await page.getByLabel("Commerciële notities").fill("Gebeld; gegevens gecontroleerd.");
  await page.getByLabel("Salesstatus", { exact: true }).selectOption("Contact gelegd");
  await page.getByLabel("Installatie nog aanwezig?").selectOption("Ja");
  await page.getByLabel("Bron: installatie nog aanwezig").fill("Telefoon met synthetische beheerder");
  await page.getByLabel("Adres (historisch of gecontroleerd)").fill("Teststraat 1");
  await page.getByLabel("Installatielocatie gecontroleerd").check();
  await page.getByLabel("Bron: installatielocatie").fill("Bevestigd door synthetische beheerder");
  await page.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Opgeslagen");
  await expect(page.getByRole("region", { name: "Dossierkaart" })).toContainText("Installatie nog aanwezig: Ja");
  await page.reload();
  await openDossier(page);
  await expect(page.getByLabel("Commerciële notities")).toHaveValue("Gebeld; gegevens gecontroleerd.");
  await tab(page, "Gesprek");
  await page.getByLabel("Notitie / afspraakinhoud").fill("Bellen voor inventarisatie");
  await page.getByRole("button", { name: "Activiteit bewaren" }).click();
  await expect(page.getByText("Bellen voor inventarisatie", { exact: true })).toBeVisible();
  await tab(page, "Scenario's");
  await page.getByLabel("Materiaalkosten (€ totaal)").fill("1000");
  await page.getByRole("button", { name: "Conceptscenario bewaren" }).click();
  await expect(page.getByRole("status")).toContainText("Conceptscenario opgeslagen");
  await expect(page.getByText(/Berekening onvolledig/)).toBeVisible();
  await tab(page, "Gesprek");
  await page.getByRole("button", { name: "Concept voorbereiden" }).click();
  await expect(page.getByLabel("Bewerkbaar concept")).toHaveValue(/Teststraat 1/);
  await expect(page.getByLabel("Bewerkbaar concept")).not.toHaveValue(/900001|1000/);
  await page.getByRole("button", { name: "In tijdlijn bewaren" }).click();
  await expect(page.getByRole("status")).toContainText("Concept in tijdlijn bewaard");
  await page.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await expect(page.getByText("Bellen voor inventarisatie", { exact: true })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Bellen voor inventarisatie" })
    .getByRole("button", { name: "Afronden", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Actie afgerond");
  await page.getByRole("button", { name: "Relaties", exact: true }).click();
  await page.getByLabel("Relatienaam").fill("Testinstallateur");
  await page.getByLabel("Project koppelen").selectOption({ label: "Testgebouw Browser" });
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await expect(page.getByRole("cell", { name: "Testinstallateur", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  await page.getByRole("button", { name: "Classificeren" }).first().click();
  await page.getByLabel("Productfamilie", { exact: true }).selectOption("E-Line");
  await page.getByLabel("Controleerbare bron").fill("Synthetische testbron");
  await page.getByLabel("Classificatie bevestigd").check();
  await page.getByRole("button", { name: "Classificatie opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Opgeslagen");
  await importFile(page);
  await expect(page.getByRole("status")).toContainText("0 nieuwe regels");
  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await page.getByLabel("Installateur (bevestigde koppeling)").fill("Testinstallateur");
  await expect(page.getByRole("button", { name: "Testgebouw Browser", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Testgebouw Browser", exact: true }).click();
  await expect(page.getByLabel("Commerciële notities")).toHaveValue("Gebeld; gegevens gecontroleerd.");
  await tab(page, "Gesprek");
  await expect(page.getByText("CONCEPT — voor handmatige controle", { exact: false })).toBeVisible();
  await tab(page, "Scenario's");
  await expect(page.getByLabel("Materiaalkosten (€ totaal)")).toHaveValue("1000");
  await page.getByLabel("Meters (gecontroleerde invoer)").fill("100");
  await page.getByLabel("Aantal lichtmodules").fill("20");
  await page.getByLabel("Montagekosten (€ totaal)").fill("200");
  await page.getByLabel("Inbedrijfstelling (€ totaal)").fill("100");
  await page.getByLabel("Overige kosten (€ totaal)").fill("0");
  await page.getByLabel("Prijsbron", { exact: true }).fill("Eigen synthetische testtarieven");
  await expect(page.getByText(/Ontbreekt: .*peildatum prijzen/)).toBeVisible();
  await page.getByLabel("Peildatum prijzen").fill("2026-10-01");
  await page.getByLabel("Technisch gecontroleerd door").fill("Synthetische controleur");
  await page.getByLabel("Technische invoer en compatibiliteit gecontroleerd").check();
  await page.getByRole("button", { name: "Conceptscenario bewaren" }).click();
  await expect(page.getByText(/Concept totaalindicatie: € 1.300/)).toBeVisible();
  await expect(page.getByText(/afgeleid € 13,00 per ingevoerde meter/).first()).toBeVisible();
  await page.getByRole("button", { name: "Slimme verlichting", exact: true }).click();
  await expect(page.getByLabel("Materiaalkosten (€ totaal)")).toHaveValue("");
  await page.getByRole("button", { name: "Retrofit", exact: true }).click();
  await expect(page.getByLabel("Materiaalkosten (€ totaal)")).toHaveValue("1000");
  await page.screenshot({ path: "test-results/dossier-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("Handmatig splitsen, selectie opslaan en samenvoegen", async ({ page }) => {
  await page.goto("/");
  await openDossier(page);
  await tab(page, "Bron & orders");
  await page.getByLabel("Selecteer regel 900001/20").check();
  await page.getByLabel("Naam afgesplitst project").fill("Afgesplitst testgebouw");
  await page.getByRole("button", { name: "Geselecteerde regels splitsen" }).click();
  await expect(page.getByRole("status")).toContainText("Project gesplitst");
  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await page.getByLabel("Selecteer Testgebouw Browser", { exact: true }).check();
  await page.getByLabel("Selecteer Afgesplitst testgebouw", { exact: true }).check();
  await page.getByLabel("Selectienaam").fill("Testselectie");
  await page.getByRole("button", { name: "Selectie bewaren" }).click();
  await expect(page.getByRole("status")).toContainText("Selectie opgeslagen");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Samenvoegen (2)" }).click();
  await expect(page.getByRole("status")).toContainText("Projecten samengevoegd");
  await expect(page.getByRole("button", { name: "Afgesplitst testgebouw", exact: true })).toHaveCount(0);
  await page.getByLabel("Opgeslagen selectie").selectOption({ label: "Testselectie" });
  await expect(page.getByRole("button", { name: "Testgebouw Browser", exact: true })).toBeVisible();
});
test("Mobiele navigatie en API weigert externe wijzigingen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard-mobile.png", fullPage: true });
  const r = await request.post("/api/workbench", {
    headers: { Origin: "https://example.com" },
    data: { action: "weights", data: {} },
  });
  expect(r.status()).toBe(403);
});

// De Kansen-tab is een interne werkvoorraad; geen bestaande installaties worden verondersteld.
test("Kansen-werkplek filtert dossierselectie en exporteert alleen na klik", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Kansen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Van SAP-regel naar eerste gesprek" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testgebouw Browser", exact: true })).toBeVisible();
  await page.getByLabel("Minimaal aantal historische stuks").fill("500");
  await expect(page.getByText("Geen projecten bij deze selectie.")).toBeVisible();
  await page.getByLabel("Minimaal aantal historische stuks").fill("100");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporteer bellijst/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("re-line-bellijst-intern.csv");
});

test("Portefeuilles en interne commerciële briefing zijn bereikbaar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Portefeuilles", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Historische relaties" })).toBeVisible();
  await openDossier(page);
  await tab(page, "Gesprek");
  await expect(page.getByRole("heading", { name: "Belvoorbereiding & technische kans" })).toBeVisible();
  await page.getByRole("button", { name: "Toon belvragen en 3 renovatierichtingen" }).click();
  await expect(page.getByText("B · Nieuwe lichtlijn")).toBeVisible();
  await tab(page, "Scenario's");
  await expect(page.getByRole("heading", { name: "Drie renovatiescenario’s" })).toBeVisible();
});

test("Kansen: selecteren, toewijzen en belactie plannen verschijnt in de werkvoorraad", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Kansen", exact: true }).click();
  await page.getByLabel("Selecteer Testgebouw Browser", { exact: true }).check();
  await page.getByLabel("Toewijzen aan").fill("Tester");
  await page.getByRole("button", { name: "Toewijzen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 dossier(s) toegewezen aan Tester");
  await page.getByLabel("Selecteer Testgebouw Browser", { exact: true }).check();
  await page.getByLabel("Belactie op").fill(iso(new Date()));
  await page.getByLabel("Omschrijving belactie").fill("Synthetische eerste belactie");
  await page.getByRole("button", { name: "Selecteren voor contact + belactie plannen" }).click();
  await expect(page.getByRole("status")).toContainText("Belactie gepland voor 1 dossier(s)");
  await page.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await page.getByLabel("Werkvoorraad van").selectOption("Tester");
  const row = page.getByRole("row").filter({ hasText: "Synthetische eerste belactie" });
  await expect(row).toContainText("Vandaag");
  await row.getByRole("button", { name: "Gesprek registreren" }).click();
  await expect(page.getByRole("tab", { name: "Gesprek", selected: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gesprek registreren" })).toBeVisible();
});

test("Gesprek registreren: antwoorden, bevestigingen met bron, afronden en vervolgactie", async ({ page }) => {
  await page.goto("/");
  await openDossier(page);
  await tab(page, "Gesprek");
  await page.getByLabel("Gesproken met").fill("Synthetische beheerder");
  await page.getByLabel("Rol contactpersoon").selectOption("Gebouwbeheerder");
  await page.getByLabel("Uitkomst").selectOption("Afspraak gemaakt");
  await page.getByLabel("Antwoord vraag 1").selectOption("Ja");
  await page.getByLabel("Toelichting vraag 1").fill("Hal A volledig, hal B deels");
  await page.getByLabel("Samenvatting gesprek").fill("Beheerder bevestigt oude lichtlijnen; opname gewenst.");
  await page.getByLabel("Geplande actie hiermee afronden").selectOption({ index: 1 });
  await page.getByLabel("Vastleggen: renovatiebehoefte").selectOption("Ja");
  await page.getByLabel("Huidige installateur (wordt gekoppeld als relatie)").fill("Synthetische installateur");
  await page.getByLabel("Salesstatus bijwerken naar").selectOption("Afspraak gepland");
  await page.getByLabel("Vervolgactie plannen").check();
  await page.getByLabel("Soort vervolgactie").selectOption("Afspraak");
  await page.getByLabel("Datum vervolgactie").fill("2030-01-15");
  await page.getByLabel("Omschrijving vervolgactie").fill("Technische opname met installateur");
  await page.getByRole("button", { name: "Gesprek opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Gesprek geregistreerd");
  await expect(page.getByText("Uitkomst: Afspraak gemaakt", { exact: false }).first()).toBeVisible();
  await tab(page, "Overzicht");
  const card = page.getByRole("region", { name: "Dossierkaart" });
  await expect(card).toContainText("Renovatiebehoefte: Ja");
  await expect(card).toContainText(/bron: Gesprek \d{4}-\d{2}-\d{2} met Synthetische beheerder \(Gebouwbeheerder, Telefoon\)/);
  await expect(card).toContainText("Installateur: Synthetische installateur");
  await expect(card).toContainText("Technische opname met installateur");
  await page.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Synthetische eerste belactie" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Technische opname met installateur" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recente gesprekken" })).toContainText("Synthetische beheerder");
});

test("Bevestiging zonder bron wordt geweigerd", async ({ page }) => {
  await page.goto("/");
  await openDossier(page);
  await page.getByLabel("Installatie al vervangen?").selectOption("Nee");
  await page.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Leg vast" })).toContainText("vervanging van de installatie");
  // Een geweigerde bevestiging mag niet als "wat we weten" op de dossierkaart staan.
  const card = page.getByRole("region", { name: "Dossierkaart" });
  await expect(card).not.toContainText("Installatie vervangen: Nee");
  await expect(page.getByText("Nog niet opgeslagen.", { exact: false })).toBeVisible();
  await page.getByLabel("Bron: installatie al vervangen").fill("Synthetische beheerder, telefonisch");
  await page.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Opgeslagen");
  await expect(card).toContainText("Installatie vervangen: Nee");
  await expect(page.getByText("Nog niet opgeslagen.", { exact: false })).toHaveCount(0);
});

test("Duitse SAP-kolommen: herkenning, annulering, profiel opslaan en herkennen", async ({ page }) => {
  const de =
    "Verkaufsbeleg;Position;Material;Materialkurztext;ME;Auftragsmenge;Erstelldatum;Gesamtstatus;Projekt;Ort;Auftraggeber\n" +
    "800001;10;TEST-DE;Synthetisch profiel;ST;40;01.02.2011;erledigt;Testhal Duits;Teststadt;Testkunde\n" +
    "800001;20;TEST-DE;Synthetisch profiel;ST;12;01.02.2011;storniert;Testhal Duits;Teststadt;Testkunde";
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({ name: "synthetisch-de.csv", mimeType: "text/csv", buffer: Buffer.from(de) });
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(page.getByLabel("Ordernummer", { exact: true })).toHaveValue("Verkaufsbeleg");
  await expect(page.getByLabel("Order-/leverstatus", { exact: true })).toHaveValue("Gesamtstatus");
  const stat = (label: string) =>
    page.locator(".stats.compact > div").filter({ has: page.getByText(label, { exact: true }) }).locator("strong");
  await expect(stat("Niet meegeteld als stuks")).toHaveText("1");
  await expect(stat("Nieuwe dossiers")).toHaveText("1");
  await page.getByLabel("Profielnaam").fill("Synthetisch Duits profiel");
  await page.getByRole("button", { name: "Koppeling bewaren als profiel" }).click();
  await expect(page.getByRole("status")).toContainText("Importprofiel");
  await page.getByRole("button", { name: "Import bevestigen" }).click();
  await expect(page.getByRole("status")).toContainText("2 nieuwe regels opgeslagen");
  await page.locator("input[type=file]").setInputFiles({ name: "synthetisch-de.csv", mimeType: "text/csv", buffer: Buffer.from(de) });
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(page.getByText("Importprofiel Synthetisch Duits profiel herkend")).toBeVisible();
  await expect(page.getByText(/eerder geïmporteerd/)).toBeVisible();
  await openDossier(page, "Testhal Duits");
  await expect(page.locator(".stats.compact").first()).toContainText("40");
});

test("Portefeuille: één gezamenlijke afspraak voor meerdere dossiers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Portefeuilles", exact: true }).click();
  await page.getByLabel("Relatie zoeken").fill("Testkunde");
  await page.getByLabel("Selecteer alle dossiers van deze relatie").check();
  await page.getByLabel("Datum").fill("2030-02-01");
  await page.getByRole("button", { name: "Eén gezamenlijke afspraak plannen" }).click();
  await expect(page.getByRole("status")).toContainText("Gezamenlijke afspraak met Testkunde gepland");
  await page.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Gezamenlijk gesprek met Testkunde" })).toBeVisible();
});

test("Back-up maken vanuit Instellingen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  await page.getByRole("button", { name: "Back-up maken" }).click();
  await expect(page.getByRole("status")).toContainText("Back-up gemaakt");
  await expect(page.getByRole("region", { name: "Back-ups" })).toContainText(/-handmatig-.*\.sqlite/);
});

test("Mobiel 390 px: hoofdschermen en dossiertabs zonder horizontale overloop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const t of ["Dashboard", "Kansen", "Salesopvolging", "Portefeuilles", "Projecten", "Relaties", "Import", "Instellingen"]) {
    await page.getByRole("button", { name: t, exact: true }).click();
    await expect(page.getByRole("heading", { name: t, level: 1 })).toBeVisible();
    expect(await overflow(), t).toBeLessThanOrEqual(0);
  }
  await openDossier(page);
  for (const v of ["Overzicht", "Gesprek", "Bron & orders", "Relaties", "Scenario's"]) {
    await tab(page, v);
    expect(await overflow(), v).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

// Projecthistorie (SAP-rapport "E-Line Projects"): synthetisch rapport met dezelfde kolomkoppen,
// inclusief kost-/margekolommen die niet ingelezen mogen worden. Bewust als laatste test: daarna
// opent Kansen standaard op de renovatiekandidaten.
async function historyWorkbook() {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const d = book.addWorksheet("Details");
  d.addRow(["OrgStruktur St.2", "Projektnummer", "Großprojekt E-Line", "Projektbezeichnung", "Geschäftsjahr", "Kd.stamm.Kunde+Name",
    "Material.Material", "Material.Baureihe Bez.", "Material.Material Bez.", "Ort des  Warenempfängers", "Projekt Ort", "Projekt Straße",
    "Warenempfänger Bez.", "Absatz ", "Umsatz ", "Net-/Net-Umsatz", "Bonus+Skonto", "KdUmsatzes", "SOF Leistung", "varHK DBW", "HK DBW", "DBW II", "DBW II %"]);
  d.addRow(["Total", null, null, null, null, null, null, null, null, null, null, null, null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const row = (nr: number, name: string, year: number, series: string, city: string, net: number) =>
    d.addRow(["TX NL", nr, "X", name, String(year), "100001 Synthetische installateur BV", "SYN-" + year, series, "Synthetisch profiel",
      "Testplaats WE", city, "-", "200001 Synthetische groothandel", 10, net, net, 1, 2, 3, 4, 5, 6, 0.1]);
  row(7000001, "Synthetisch kantoor Alfa", 2011, "765... E-Line Old", "Teststad", 90000);
  row(7000001, "Synthetisch kantoor Alfa", 2013, "765... E-Line", "Teststad", 10000);
  row(7000002, "Synthetische hal Beta", 2024, "765... E-Line", "Testdorp", 5000);
  return Buffer.from(await book.xlsx.writeBuffer());
}
test("Projecthistorie: SAP-rapport importeren, renovatiekandidaten, dossier, filters en mobiel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const buffer = await historyWorkbook();
  const file = { name: "synthetisch-projectrapport.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(file);
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  const prev = page.getByRole("region", { name: "Voorbeeld projecthistorie" });
  await expect(prev).toContainText("Projecthistorie herkend");
  await expect(prev).toContainText("Bonus+Skonto");
  await expect(prev).toContainText("Geen ordernummers, leverstatus of installatielocaties");
  await page.getByRole("button", { name: "Projecthistorie importeren" }).click();
  await expect(page.getByRole("status")).toContainText("3 historieregels opgeslagen; 0 bijgewerkt; 0 dubbelen overgeslagen; 2 nieuwe dossiers");
  await expect(page.getByRole("status")).toContainText("2 renovatiekandidaten bepaald");
  // Tweede identieke import: niets dubbel.
  await page.locator("input[type=file]").setInputFiles(file);
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(prev).toContainText("eerder geïmporteerd");
  await page.getByRole("button", { name: "Projecthistorie importeren" }).click();
  await expect(page.getByRole("status")).toContainText("0 historieregels opgeslagen; 0 bijgewerkt; 3 dubbelen overgeslagen; 0 nieuwe dossiers");

  await page.getByRole("button", { name: "Kansen", exact: true }).click();
  await expect(page.getByLabel("Werkvoorraad")).toHaveValue("Renovatiekandidaten");
  await expect(page.getByRole("button", { name: "Synthetisch kantoor Alfa", exact: true })).toBeVisible();
  await expect(page.getByText(/Ouderdom \(eerste boekjaar\) \+30/).first()).toBeVisible();
  await expect(page.getByText(/lager door: Ouderdom \(eerste boekjaar\) 0\/30/).first()).toBeVisible();
  await page.getByLabel("Productreeks").selectOption("765... E-Line Old");
  await expect(page.getByRole("button", { name: "Synthetische hal Beta", exact: true })).toHaveCount(0);
  await page.getByLabel("Productreeks").selectOption("");
  await page.getByLabel("Werkvoorraad").selectOption("Orderregels");
  await expect(page.getByLabel("Minimaal aantal historische stuks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Synthetisch kantoor Alfa", exact: true })).toHaveCount(0);

  await openDossier(page, "Synthetisch kantoor Alfa");
  await expect(page.getByRole("region", { name: "Dossierkaart" })).toContainText("Projecthistorie SAP 7000001");
  await expect(page.getByRole("region", { name: "Dossierkaart" })).toContainText("Historische verkoop ≠ levering ≠ huidige installatie");
  await page.getByLabel("Commerciële notities").fill("Notitie op historiedossier");
  await page.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Opgeslagen");
  await tab(page, "Bron & orders");
  const hist = page.getByRole("region", { name: "Projecthistorie", exact: true });
  await expect(hist).toContainText("Geen ordernummers, leverstatus of leverdata");
  await expect(hist).not.toContainText("Bonus");
  await expect(page.getByText("Geen orderregels: dit dossier komt uit de projecthistorie")).toBeVisible();

  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await page.getByLabel("Werkvoorraad").selectOption("Renovatiekandidaten");
  await page.getByLabel("Minimale omzet projecthistorie").fill("50000");
  await expect(page.getByRole("button", { name: "Synthetisch kantoor Alfa", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Synthetische hal Beta", exact: true })).toHaveCount(0);
  await page.getByLabel("Werkvoorraad").selectOption("Overige dossiers");
  await page.getByLabel("Minimale omzet projecthistorie").fill("");
  await expect(page.getByRole("button", { name: "Testgebouw Browser", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const t of ["Dashboard", "Kansen", "Import"]) {
    await page.getByRole("button", { name: t, exact: true }).click();
    expect(await overflow(), t).toBeLessThanOrEqual(0);
  }
  await openDossier(page, "Synthetisch kantoor Alfa");
  for (const v of ["Overzicht", "Bron & orders"]) {
    await tab(page, v);
    expect(await overflow(), v).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
