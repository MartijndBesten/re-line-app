import { test, expect, type Browser, type Page } from "@playwright/test";
import { activate, historyWorkbook, loginWithPassword, overflow, serverState } from "./helpers";
// Samenwerken met wachtwoordaccounts (RELINE_AUTH=lokaal): beheerder en twee collega's, uitsluitend fictief.
test.describe.configure({ mode: "serial" });
const base = "http://127.0.0.1:3109";
const pw = { beheerder: "Beheerder-wachtwoord-2026", anna: "Anna-wachtwoord-2026!", bram: "Bram-wachtwoord-2026!" };
const links: Record<string, string> = {};
async function asAdmin(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  await loginWithPassword(page, "beheerder@example.test", pw.beheerder);
  await expect(page.getByLabel("Ingelogd")).toContainText("Test Beheerder");
  return page;
}
async function asAnna(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  await loginWithPassword(page, "anna@example.test", pw.anna);
  await expect(page.getByLabel("Ingelogd")).toContainText("Anna Test");
  return page;
}
async function openDossier(page: Page, name: string) {
  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await page.getByLabel("Zoeken").fill(name);
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

test("Eerste gebruik: zonder aanmelding geen gegevens; beheerder activeert het account via de link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  expect((await page.request.get("/api/workbench")).status()).toBe(401);
  const link = serverState(3109).adminLink as string;
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Account activeren" })).toBeVisible();
  await page.getByLabel("Nieuw wachtwoord").fill(pw.beheerder);
  await page.getByLabel("Herhaal wachtwoord").fill(pw.beheerder + "x");
  await page.getByRole("button", { name: "Activeren en aanmelden" }).click();
  await expect(page.locator(".alert[role=alert]")).toContainText("niet gelijk");
  await page.getByLabel("Herhaal wachtwoord").fill(pw.beheerder);
  await page.getByRole("button", { name: "Activeren en aanmelden" }).click();
  await expect(page.getByLabel("Ingelogd")).toContainText("Test Beheerder");
  await expect(page.getByLabel("Ingelogd")).toContainText("Beheerder");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Aan de slag" })).toBeVisible();
  // De link is eenmalig (iemand anders opent hem later in een nieuwe browser).
  const other = await (await page.context().browser()!.newContext({ baseURL: base })).newPage();
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "Account activeren" })).toBeVisible();
  await other.getByLabel("Nieuw wachtwoord").fill(pw.beheerder);
  await other.getByLabel("Herhaal wachtwoord").fill(pw.beheerder);
  await other.getByRole("button", { name: "Activeren en aanmelden" }).click();
  await expect(other.locator(".alert[role=alert]")).toContainText("ongeldig of verlopen");
});

test("Beheerder maakt collega's aan, importeert een SAP-bestand en wijst een dossier toe", async ({ browser }) => {
  const page = await asAdmin(browser);
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  for (const [key, name, email] of [["anna", "Anna Test", "anna@example.test"], ["bram", "Bram Test", "bram@example.test"]]) {
    await page.getByLabel("Naam collega").fill(name);
    await page.getByLabel("E-mailadres collega").fill(email);
    await page.getByRole("button", { name: "Account aanmaken" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Activatielink voor " + name })).toBeVisible();
    links[key] = await page.getByLabel("Activatielink").inputValue();
    expect(links[key]).toMatch(/#activeren=/);
  }
  await expect(page.getByRole("region", { name: "Gebruikers", exact: true })).toContainText("Uitgenodigd");
  // Eigen account: geen activatielink of deactiveren (zou jezelf uitloggen of buitensluiten).
  const own = page.getByRole("row").filter({ hasText: "Test Beheerder (jij)" });
  await expect(own.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(await historyWorkbook());
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(page.getByRole("region", { name: "Voorbeeld projecthistorie" })).toContainText("Projecthistorie herkend");
  await page.getByRole("button", { name: "Projecthistorie importeren" }).click();
  await expect(page.getByRole("status").filter({ hasText: "historieregels opgeslagen" })).toContainText("2 nieuwe dossiers");
  await page.getByRole("button", { name: "Kansen", exact: true }).click();
  await page.getByLabel("Selecteer Synthetisch kantoor Alfa", { exact: true }).check();
  await page.getByLabel("Toewijzen aan").fill("Anna Test");
  await page.getByRole("button", { name: "Toewijzen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 dossier(s) toegewezen aan Anna Test");
});

test("Collega (gebruiker): activeren, geen beheerfuncties, gesprek vastleggen in eigen werkvoorraad", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  await activate(page, links.anna, pw.anna);
  await expect(page.getByLabel("Ingelogd")).toContainText("Anna Test");
  await expect(page.getByLabel("Ingelogd")).toContainText("Gebruiker");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  // Startscherm verwijst een collega niet naar beheerderstaken.
  await expect(page.getByRole("region", { name: "Aan de slag" }).getByRole("button", { name: "Naar Import" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Aan de slag" }).getByRole("button", { name: "Naar Kansen" })).toBeVisible();
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  await expect(page.getByText("Classificatie, prioritering en back-ups kan alleen een beheerder wijzigen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account aanmaken" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gewichten opslaan" })).toBeDisabled();
  // De server weigert beheeracties, ook buiten de interface om.
  for (const action of ["weights", "backup", "candidates", "user.create", "merge"]) {
    const r = await page.request.post("/api/workbench", { headers: { Origin: base }, data: { action, id: "", data: {} } });
    expect(r.status(), action).toBe(403);
  }
  const imp = await page.request.post("/api/workbench", { headers: { Origin: base }, multipart: { file: await historyWorkbook() } });
  expect(imp.status()).toBe(403);
  // Eigen werk: gesprek vastleggen op het toegewezen dossier.
  await openDossier(page, "Synthetisch kantoor Alfa");
  await page.getByRole("tab", { name: "Gesprek", exact: true }).click();
  await page.getByLabel("Gesproken met").fill("Fictieve beheerder");
  await page.getByLabel("Rol contactpersoon").selectOption("Gebouwbeheerder");
  await page.getByLabel("Uitkomst").selectOption("Afspraak gemaakt");
  await page.getByLabel("Antwoord vraag 1").selectOption("Ja");
  await page.getByLabel("Samenvatting gesprek").fill("Installatie nog aanwezig; opname gewenst.");
  await page.getByLabel("Vervolgactie plannen").check();
  await page.getByLabel("Soort vervolgactie").selectOption("Afspraak");
  await page.getByLabel("Datum vervolgactie").fill("2030-02-01");
  await page.getByLabel("Omschrijving vervolgactie").fill("Technische opname Alfa");
  await page.getByRole("button", { name: "Gesprek opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Gesprek geregistreerd");
  await expect(page.getByText("vastgelegd door Anna Test").first()).toBeVisible();
  await page.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await expect(page.getByLabel("Werkvoorraad van")).toHaveValue("Anna Test");
  await expect(page.getByRole("row").filter({ hasText: "Technische opname Alfa" })).toBeVisible();
});

test("Twee collega's tegelijk in hetzelfde dossier: melding, conflict zonder overschrijven, actuele versie", async ({ browser }) => {
  const admin = await asAdmin(browser);
  await admin.clock.install();
  const anna = await asAnna(browser);
  await openDossier(admin, "Synthetisch kantoor Alfa");
  await openDossier(anna, "Synthetisch kantoor Alfa");
  await anna.getByLabel("Commerciële notities").fill("Anna: klant belt terug na de opname.");
  await anna.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(anna.getByRole("status")).toContainText("Opgeslagen");
  // Beheerder heeft nog de oude versie open: na de periodieke controle verschijnt een melding.
  await admin.clock.fastForward(31_000);
  await expect(admin.getByText("Dit dossier is intussen gewijzigd door Anna Test")).toBeVisible();
  await admin.getByLabel("Commerciële notities").fill("Beheerder: offerte volgt.");
  await admin.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(admin.locator(".alert[role=alert]")).toContainText("intussen gewijzigd door Anna Test");
  await admin.getByRole("button", { name: "Actuele versie laden" }).click();
  await expect(admin.getByLabel("Commerciële notities")).toHaveValue("Anna: klant belt terug na de opname.");
  await expect(admin.getByText("Laatst gewijzigd door Anna Test")).toBeVisible();
  await admin.getByLabel("Commerciële notities").fill("Anna: klant belt terug na de opname. Beheerder: offerte volgt.");
  await admin.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(admin.getByRole("status")).toContainText("Opgeslagen");
  await expect(admin.getByText("Laatst gewijzigd door Test Beheerder")).toBeVisible();
  // Na verversen bij de collega: beide aanvullingen staan er.
  await anna.reload();
  await openDossier(anna, "Synthetisch kantoor Alfa");
  await expect(anna.getByLabel("Commerciële notities")).toHaveValue(/Beheerder: offerte volgt\./);
});

test("Wie heeft wat gewijzigd: auditlog met namen (alleen beheerder)", async ({ browser }) => {
  const admin = await asAdmin(browser);
  await admin.getByRole("button", { name: "Instellingen", exact: true }).click();
  const log = admin.getByRole("region", { name: "Auditlog" });
  await expect(log.getByRole("row").filter({ hasText: "Anna Test" }).filter({ hasText: "Gesprek geregistreerd" })).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "Test Beheerder" }).filter({ hasText: "Account aangemaakt" }).first()).toBeVisible();
  const anna = await asAnna(browser);
  await anna.getByRole("button", { name: "Instellingen", exact: true }).click();
  await expect(anna.getByText("Het auditlog is alleen zichtbaar voor beheerders.")).toBeVisible();
  await expect(anna.getByRole("region", { name: "Auditlog" }).getByRole("row")).toHaveCount(1);
});

test("Foutpaden: verkeerd wachtwoord, blokkade na pogingen, afmelden, gedeactiveerd account", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  await loginWithPassword(page, "bram@example.test", "nog-niet-geactiveerd-123");
  await expect(page.locator(".alert[role=alert]")).toContainText("E-mailadres of wachtwoord onjuist");
  for (let i = 0; i < 5; i++) await loginWithPassword(page, "onbekend@example.test", "verkeerd-" + i);
  await loginWithPassword(page, "onbekend@example.test", "verkeerd-x");
  await expect(page.locator(".alert[role=alert]")).toContainText("Te veel inlogpogingen");
  await activate(page, links.bram, pw.bram);
  await expect(page.getByLabel("Ingelogd")).toContainText("Bram Test");
  const before = (await ctx.cookies()).find((c) => c.name === "reline-sessie")!;
  await page.getByRole("button", { name: "Afmelden" }).click();
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  const reuse = await page.request.get("/api/workbench", { headers: { Cookie: `reline-sessie=${before.value}` } });
  expect(reuse.status(), "ingetrokken sessie").toBe(401);
  // Beheerder deactiveert Bram; aanmelden lukt daarna niet meer.
  const admin = await asAdmin(browser);
  await admin.getByRole("button", { name: "Instellingen", exact: true }).click();
  await admin.getByRole("row").filter({ hasText: "Bram Test" }).getByRole("button", { name: "Deactiveren" }).click();
  await expect(admin.getByRole("status")).toContainText("Bram Test gedeactiveerd");
  await loginWithPassword(page, "bram@example.test", pw.bram);
  await expect(page.locator(".alert[role=alert]")).toContainText("E-mailadres of wachtwoord onjuist");
});

test("Mobiel 390 px: aanmelden en werken als collega zonder horizontale overloop", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  expect(await overflow(page), "inlogscherm").toBeLessThanOrEqual(0);
  await loginWithPassword(page, "anna@example.test", pw.anna);
  await expect(page.getByLabel("Ingelogd")).toBeVisible();
  for (const t of ["Dashboard", "Kansen", "Salesopvolging", "Projecten", "Instellingen"]) {
    await page.getByRole("button", { name: t, exact: true }).click();
    await expect(page.getByRole("heading", { name: t, level: 1 })).toBeVisible();
    expect(await overflow(page), t).toBeLessThanOrEqual(0);
  }
  await openDossier(page, "Synthetisch kantoor Alfa");
  for (const v of ["Overzicht", "Gesprek", "Bron & orders"]) {
    await page.getByRole("tab", { name: v, exact: true }).click();
    expect(await overflow(page), v).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
