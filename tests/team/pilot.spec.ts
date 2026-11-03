import { test, expect, type Browser, type Page } from "@playwright/test";
import { activate, loginWithPassword, overflow, serverState } from "./helpers";
// Generale repetitie van de acceptatiepilot (output/PILOT_ACCEPTATIE_EN_IMPLEMENTATIEPLAN.md, AT-01 t/m AT-09):
// drie fictieve collega's, synthetische SAP-export, productiebuild met inloggen. Klaargezet met
// `npm run pilot:voorbereiden` (via scripts/test-team-server.mjs --pilot), precies zoals in de centrale omgeving.
test.describe.configure({ mode: "serial" });
const base = "http://127.0.0.1:3112";
const pw = { beheerder: "Pilot-Beheer-2026!", verkoop: "Pilot-Verkoop-2026!", binnendienst: "Pilot-Binnen-2026!" };
const user = {
  beheerder: { name: "Petra Pilot (fictief)", email: "petra.pilot@example.test" },
  verkoop: { name: "Sanne Verkoop (fictief)", email: "sanne.verkoop@example.test" },
  binnendienst: { name: "Bas Binnendienst (fictief)", email: "bas.binnendienst@example.test" },
};
type Key = keyof typeof user;
const state = () => serverState(3112) as { links: Record<Key, string>; export: string };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function as(browser: Browser, key: Key, phone = false) {
  const ctx = await browser.newContext({ baseURL: base, ...(phone ? mobile : {}) });
  const page = await ctx.newPage();
  await loginWithPassword(page, user[key].email, pw[key]);
  await expect(page.getByLabel("Ingelogd")).toContainText(user[key].name);
  return page;
}
async function menu(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function openDossier(page: Page, name: string) {
  await menu(page, "Projecten");
  await page.getByLabel("Zoeken").fill(name);
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
const worklist = (page: Page) => page.getByRole("region", { name: "Werkvoorraad", exact: true });

test("AT-01 Aanmelden: zonder account geen toegang; drie collega's activeren hun account (binnendienst op de telefoon)", async ({ browser }) => {
  const anon = await (await browser.newContext({ baseURL: base })).newPage();
  await anon.goto("/");
  await expect(anon.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  expect((await anon.request.get("/api/workbench")).status()).toBe(401);
  for (const [key, phone] of [["beheerder", false], ["verkoop", false], ["binnendienst", true]] as [Key, boolean][]) {
    const page = await (await browser.newContext({ baseURL: base, ...(phone ? mobile : {}) })).newPage();
    await activate(page, state().links[key], pw[key]);
    await expect(page.getByLabel("Ingelogd")).toContainText(user[key].name);
    await expect(page.getByLabel("Ingelogd")).toContainText(key === "beheerder" ? "Beheerder" : "Gebruiker");
    if (phone) expect(await overflow(page), "geen horizontale overloop op 390 px").toBeLessThanOrEqual(0);
  }
  await loginWithPassword(anon, user.verkoop.email, "verkeerd-wachtwoord-1");
  await expect(anon.locator(".alert[role=alert]")).toContainText("E-mailadres of wachtwoord onjuist");
});

test("AT-02 Beheerder leest de synthetische SAP-export in: eerst voorbeeld, dan importeren; opnieuw inlezen geeft geen dubbelen", async ({ browser }) => {
  const page = await as(browser, "beheerder");
  await menu(page, "Import");
  await page.locator("input[type=file]").setInputFiles(state().export);
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await expect(page.getByRole("region", { name: "Voorbeeld projecthistorie" })).toContainText("Projecthistorie herkend");
  await page.getByRole("button", { name: "Projecthistorie importeren" }).click();
  await expect(page.getByRole("status").filter({ hasText: "historieregels opgeslagen" })).toContainText("16 historieregels opgeslagen; 0 bijgewerkt; 0 dubbelen overgeslagen; 12 nieuwe dossiers");
  await page.locator("input[type=file]").setInputFiles(state().export);
  await page.getByRole("button", { name: "Voorbeeld bekijken" }).click();
  await page.getByRole("button", { name: "Projecthistorie importeren" }).click();
  await expect(page.getByRole("status").filter({ hasText: "historieregels opgeslagen" })).toContainText("0 historieregels opgeslagen; 0 bijgewerkt; 16 dubbelen overgeslagen; 0 nieuwe dossiers");
  await menu(page, "Projecten");
  await expect(page.getByRole("button", { name: "Fictief kantoor Pilotplein", exact: true })).toBeVisible();
});

test("AT-03 Beheerder wijst dossiers toe aan twee collega's en plant belacties", async ({ browser }) => {
  const page = await as(browser, "beheerder");
  await menu(page, "Kansen");
  for (const n of ["Fictief kantoor Pilotplein", "Fictieve sporthal De Proef"]) await page.getByLabel(`Selecteer ${n}`, { exact: true }).check();
  await page.getByLabel("Toewijzen aan").fill(user.verkoop.name);
  await page.getByLabel("Belactie op").fill("2030-03-02");
  await page.getByLabel("Omschrijving belactie").fill("Eerste contact: installatie nog aanwezig? (pilot)");
  await page.getByRole("button", { name: "Selecteren voor contact + belactie plannen" }).click();
  await expect(page.getByRole("status")).toContainText("Belactie gepland voor 2 dossier(s)");
  for (const n of ["Fictief kantoor Pilotplein", "Fictieve sporthal De Proef"]) {
    const box = page.getByLabel(`Selecteer ${n}`, { exact: true });
    if (await box.isChecked()) await box.uncheck();
  }
  await page.getByLabel("Selecteer Fictief ziekenhuis Proefzorg", { exact: true }).check();
  await page.getByLabel("Toewijzen aan").fill(user.binnendienst.name);
  await page.getByRole("button", { name: "Toewijzen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`1 dossier(s) toegewezen aan ${user.binnendienst.name}`);
});

test("AT-04 Verkoper legt het gesprek vast, rondt de belactie af en plant de opvolging", async ({ browser }) => {
  const page = await as(browser, "verkoop");
  await menu(page, "Salesopvolging");
  await expect(page.getByLabel("Werkvoorraad van")).toHaveValue(user.verkoop.name);
  await expect(worklist(page).getByRole("row").filter({ hasText: "Eerste contact" })).toHaveCount(2);
  await worklist(page).getByRole("row").filter({ hasText: "Fictief kantoor Pilotplein" }).getByRole("button", { name: "Gesprek registreren" }).click();
  await expect(page.getByRole("heading", { name: "Fictief kantoor Pilotplein", level: 1 })).toBeVisible();
  await page.getByLabel("Gesproken met").fill("Fictieve facilitair manager");
  await page.getByLabel("Rol contactpersoon").selectOption("Gebouwbeheerder");
  await page.getByLabel("Uitkomst").selectOption("Afspraak gemaakt");
  await page.getByLabel("Antwoord vraag 1").selectOption("Ja");
  await page.getByLabel("Samenvatting gesprek").fill("Fictief: E-Line nog aanwezig in kantoorvleugel; opname gewenst.");
  await page.getByLabel("Geplande actie hiermee afronden").selectOption({ index: 1 });
  await page.getByLabel("Salesstatus bijwerken naar").selectOption("Afspraak gepland");
  await page.getByLabel("Vervolgactie plannen").check();
  await page.getByLabel("Soort vervolgactie").selectOption("Afspraak");
  await page.getByLabel("Datum vervolgactie").fill("2030-04-15");
  await page.getByLabel("Omschrijving vervolgactie").fill("Technische opname Pilotplein (fictief)");
  await page.getByRole("button", { name: "Gesprek opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Gesprek geregistreerd");
  await expect(page.getByText(`vastgelegd door ${user.verkoop.name}`).first()).toBeVisible();
  await menu(page, "Salesopvolging");
  const rows = worklist(page).getByRole("row");
  await expect(rows.filter({ hasText: "Technische opname Pilotplein (fictief)" })).toBeVisible();
  await expect(rows.filter({ hasText: "Eerste contact" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Eerste contact" })).toContainText("Fictieve sporthal De Proef");
  // Pipeline: het dossier is doorgeschoven naar Kwalificatie (afspraak gepland), het andere staat nog in Contact.
  await expect(page.getByRole("button", { name: /^Kwalificatie\s*1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Contact\s*1$/ })).toBeVisible();
});

test("AT-05 Binnendienst (telefoon) ziet de opvolging van de collega, plant een eigen actie en rondt die af", async ({ browser }) => {
  const page = await as(browser, "binnendienst", true);
  await menu(page, "Salesopvolging");
  await page.getByLabel("Werkvoorraad van").selectOption("");
  const rows = worklist(page).getByRole("row");
  await expect(rows.filter({ hasText: "Technische opname Pilotplein (fictief)" })).toContainText(user.verkoop.name);
  await openDossier(page, "Fictief ziekenhuis Proefzorg");
  await page.getByRole("tab", { name: "Gesprek", exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Activiteit bewaren" }) });
  await form.getByLabel("Activiteit", { exact: true }).selectOption("Bellen");
  await form.getByLabel("Actiedatum").fill("2030-03-10");
  await form.getByLabel("Verantwoordelijke medewerker").fill(user.binnendienst.name);
  await form.getByLabel("Notitie / afspraakinhoud").fill("Technische dienst terugbellen over aantallen (fictief)");
  await form.getByRole("button", { name: "Activiteit bewaren" }).click();
  await expect(page.getByRole("status")).toContainText("Activiteit toegevoegd");
  await menu(page, "Salesopvolging");
  await page.getByLabel("Werkvoorraad van").selectOption(user.binnendienst.name);
  const mine = worklist(page).getByRole("row").filter({ hasText: "Technische dienst terugbellen" });
  await expect(mine).toBeVisible();
  await mine.getByRole("button", { name: "Afronden" }).click();
  await expect(page.getByRole("status")).toContainText("Actie afgerond");
  await expect(mine).toHaveCount(0);
  expect(await overflow(page), "geen horizontale overloop op 390 px").toBeLessThanOrEqual(0);
});

test("AT-06 Twee collega's wijzigen tegelijk hetzelfde dossier: melding, conflict met naam, niets overschreven", async ({ browser }) => {
  const sanne = await as(browser, "verkoop");
  await sanne.clock.install();
  const bas = await as(browser, "binnendienst");
  await openDossier(sanne, "Fictief kantoor Pilotplein");
  await openDossier(bas, "Fictief kantoor Pilotplein");
  await bas.getByLabel("Commerciële notities").fill("Bas: plattegrond opgevraagd bij facilitair (fictief).");
  await bas.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(bas.getByRole("status")).toContainText("Opgeslagen");
  await sanne.clock.fastForward(31_000);
  await expect(sanne.getByText(`Dit dossier is intussen gewijzigd door ${user.binnendienst.name}`)).toBeVisible();
  await sanne.getByLabel("Commerciële notities").fill("Sanne: opname 15 april bevestigd (fictief).");
  await sanne.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(sanne.locator(".alert[role=alert]")).toContainText(`intussen gewijzigd door ${user.binnendienst.name}`);
  await sanne.getByRole("button", { name: "Actuele versie laden" }).click();
  await expect(sanne.getByLabel("Commerciële notities")).toHaveValue("Bas: plattegrond opgevraagd bij facilitair (fictief).");
  await sanne.getByLabel("Commerciële notities").fill("Bas: plattegrond opgevraagd bij facilitair (fictief). Sanne: opname 15 april bevestigd (fictief).");
  await sanne.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(sanne.getByRole("status")).toContainText("Opgeslagen");
  await expect(sanne.getByText(`Laatst gewijzigd door ${user.verkoop.name}`)).toBeVisible();
  await bas.reload();
  await openDossier(bas, "Fictief kantoor Pilotplein");
  await expect(bas.getByLabel("Commerciële notities")).toHaveValue(/Bas: .*Sanne: opname 15 april/);
});

test("AT-07 Collega's hebben geen beheerfuncties, ook niet buiten de interface om", async ({ browser }) => {
  const page = await as(browser, "binnendienst");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  for (const action of ["weights", "user.create", "candidates", "merge"]) {
    const r = await page.request.post("/api/workbench", { headers: { Origin: base }, data: { action, id: "", data: {} } });
    expect(r.status(), action).toBe(403);
  }
});

test("AT-08 Beheerder controleert wie wat deed: auditlog en dossier met namen", async ({ browser }) => {
  const page = await as(browser, "beheerder");
  await menu(page, "Instellingen");
  const log = page.getByRole("region", { name: "Auditlog" });
  await expect(log.getByRole("row").filter({ hasText: user.verkoop.name }).filter({ hasText: "Gesprek geregistreerd" })).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: user.binnendienst.name }).filter({ hasText: "Activiteit afgerond" })).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: user.beheerder.name }).filter({ hasText: "Import" }).first()).toBeVisible();
  await openDossier(page, "Fictief kantoor Pilotplein");
  await expect(page.getByText(`Laatst gewijzigd door ${user.verkoop.name}`)).toBeVisible();
});

test("AT-09 Afmelden: de sessie vervalt direct", async ({ browser }) => {
  const page = await as(browser, "verkoop");
  const cookie = (await page.context().cookies()).find((c) => c.name === "reline-sessie")!;
  await page.getByRole("button", { name: "Afmelden" }).click();
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  expect((await page.request.get("/api/workbench", { headers: { Cookie: `reline-sessie=${cookie.value}` } })).status()).toBe(401);
});
