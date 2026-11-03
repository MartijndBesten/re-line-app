import { test, expect, type Browser, type Page } from "@playwright/test";
import { overflow } from "./helpers";
// Inloglink per e-mail (RELINE_AUTH=email) in de afgeschermde demo (RELINE_DEMO=1, synthetische pilotset).
// Echte SMTP-aflevering naar een lokale test-mailserver; alleen fictieve adressen (example.test).
test.describe.configure({ mode: "serial" });
const base = "http://127.0.0.1:3113";
const inbox = "http://127.0.0.1:3114/berichten";
const petra = { name: "Petra Pilot (fictief)", email: "petra.pilot@example.test" };
const sanne = { name: "Sanne Verkoop (fictief)", email: "sanne.verkoop@example.test" };
const bas = { name: "Bas Binnendienst (fictief)", email: "bas.binnendienst@example.test" };
type Mail = { to: string[]; subject: string; text: string };
async function mails(to: string): Promise<Mail[]> {
  return ((await (await fetch(inbox)).json()) as Mail[]).filter((m) => m.to.includes(to));
}
async function latestLink(to: string, count: number) {
  await expect.poll(async () => (await mails(to)).length, { timeout: 15_000 }).toBe(count);
  const m = (await mails(to)).at(-1)!;
  expect(m.subject).toBe("Je inloglink voor Re-Line");
  const link = m.text.match(/https?:\/\/\S+#inloggen=[A-Za-z0-9_-]{43}/)?.[0];
  expect(link, "inloglink in de mail").toBeTruthy();
  return link!;
}
async function requestLink(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Stuur inloglink" }).click();
}
async function signIn(browser: Browser, who: { email: string; name: string }, count: number, phone = false) {
  const ctx = await browser.newContext({ baseURL: base, ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true } : {}) });
  const page = await ctx.newPage();
  await requestLink(page, who.email);
  await expect(page.getByRole("status")).toContainText("Als dit adres toegang heeft tot Re-Line");
  const link = await latestLink(who.email, count);
  await page.goto(link);
  await page.getByRole("button", { name: "Nu aanmelden" }).click();
  await expect(page.getByLabel("Ingelogd")).toContainText(who.name);
  expect(page.url(), "token niet in de adresbalk achtergelaten").not.toContain("inloggen=");
  return { page, link };
}

test("Zonder uitnodiging geen toegang, ook niet met een geldig domein; hetzelfde antwoord (geen accountenumeratie)", async ({ page }) => {
  await fetch(inbox, { method: "DELETE" });
  await page.goto("/");
  await expect(page.getByText("Demo met uitsluitend fictieve gegevens")).toBeVisible();
  expect((await page.request.get("/api/workbench")).status()).toBe(401);
  await requestLink(page, "onbekend@example.test");
  const unknown = await page.getByRole("status").textContent();
  await requestLink(page, petra.email);
  await expect(page.getByRole("status")).toHaveText(unknown!);
  await expect.poll(async () => (await mails(petra.email)).length, { timeout: 15_000 }).toBe(1);
  expect((await mails("onbekend@example.test")).length, "geen mail naar een niet-uitgenodigd adres").toBe(0);
  expect((await page.request.get("/api/workbench")).status()).toBe(401);
});

test("Beheerder meldt zich aan met de inloglink uit de mail; de link werkt één keer en ziet de synthetische dossiers", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  const link = await latestLink(petra.email, 1);
  await page.goto(link);
  await expect(page.getByRole("button", { name: "Nu aanmelden" })).toBeVisible();
  await page.getByRole("button", { name: "Nu aanmelden" }).click();
  await expect(page.getByLabel("Ingelogd")).toContainText("Beheerder");
  await expect(page.getByRole("note")).toContainText("Demo met uitsluitend fictieve gegevens");
  await page.getByRole("button", { name: "Projecten", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fictief kantoor Pilotplein", exact: true })).toBeVisible();
  const again = await (await browser.newContext({ baseURL: base })).newPage();
  await again.goto(link);
  await again.getByRole("button", { name: "Nu aanmelden" }).click();
  await expect(again.locator(".alert[role=alert]")).toContainText("ongeldig, al gebruikt of verlopen");
  await expect(again.getByLabel("Ingelogd")).toHaveCount(0);
});

test("Beheerder nodigt twee collega's uit; zij melden zich aan via hun eigen mailbox en werken samen in dezelfde dossiers", async ({ browser }) => {
  const admin = await signIn(browser, petra, 2);
  await admin.page.getByRole("button", { name: "Instellingen", exact: true }).click();
  for (const u of [sanne, bas]) {
    await admin.page.getByLabel("Naam collega").fill(u.name);
    await admin.page.getByLabel("E-mailadres collega").fill(u.email);
    await admin.page.getByRole("button", { name: "Collega uitnodigen" }).click();
    await expect(admin.page.getByRole("status")).toContainText(`${u.name} uitgenodigd`);
  }
  await expect(admin.page.getByRole("region", { name: "Gebruikers", exact: true })).toContainText("Uitgenodigd");
  const s = (await signIn(browser, sanne, 1)).page;
  const b = (await signIn(browser, bas, 1, true)).page;
  expect(await overflow(b), "telefoon zonder horizontale overloop").toBeLessThanOrEqual(0);
  // Eigenaar instellen + gesprek met opvolging (Sanne).
  await s.getByRole("button", { name: "Kansen", exact: true }).click();
  await s.getByLabel("Selecteer Fictief kantoor Pilotplein", { exact: true }).check();
  await s.getByLabel("Toewijzen aan").fill(sanne.name);
  await s.getByRole("button", { name: "Toewijzen", exact: true }).click();
  await expect(s.getByRole("status")).toContainText(`1 dossier(s) toegewezen aan ${sanne.name}`);
  await s.getByRole("button", { name: "Projecten", exact: true }).click();
  await s.getByLabel("Zoeken").fill("Fictief kantoor Pilotplein");
  await s.getByRole("button", { name: "Fictief kantoor Pilotplein", exact: true }).first().click();
  await s.getByRole("tab", { name: "Gesprek", exact: true }).click();
  await s.getByLabel("Gesproken met").fill("Fictieve facilitair manager");
  await s.getByLabel("Uitkomst").selectOption("Afspraak gemaakt");
  await s.getByLabel("Samenvatting gesprek").fill("Fictief: opname gewenst.");
  await s.getByLabel("Vervolgactie plannen").check();
  await s.getByLabel("Soort vervolgactie").selectOption("Afspraak");
  await s.getByLabel("Datum vervolgactie").fill("2030-04-15");
  await s.getByLabel("Omschrijving vervolgactie").fill("Opname Pilotplein (fictief)");
  await s.getByRole("button", { name: "Gesprek opslaan" }).click();
  await expect(s.getByRole("status")).toContainText("Gesprek geregistreerd");
  // Bas ziet dezelfde dossiers en de actie van Sanne.
  await b.getByRole("button", { name: "Salesopvolging", exact: true }).click();
  await b.getByLabel("Werkvoorraad van").selectOption("");
  await expect(b.getByRole("region", { name: "Werkvoorraad", exact: true }).getByRole("row").filter({ hasText: "Opname Pilotplein (fictief)" })).toContainText(sanne.name);
  // Conflict veilig afgehandeld.
  const b2 = (await signIn(browser, bas, 2)).page;
  await s.getByRole("tab", { name: "Overzicht", exact: true }).click();
  await b2.getByRole("button", { name: "Projecten", exact: true }).click();
  await b2.getByLabel("Zoeken").fill("Fictief kantoor Pilotplein");
  await b2.getByRole("button", { name: "Fictief kantoor Pilotplein", exact: true }).first().click();
  await b2.getByLabel("Commerciële notities").fill("Bas: plattegrond opgevraagd (fictief).");
  await b2.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(b2.getByRole("status")).toContainText("Opgeslagen");
  await s.getByLabel("Commerciële notities").fill("Sanne: opname bevestigd (fictief).");
  await s.getByRole("button", { name: "Dossier opslaan" }).click();
  await expect(s.locator(".alert[role=alert]")).toContainText(`intussen gewijzigd door ${bas.name}`);
  await s.getByRole("button", { name: "Actuele versie laden" }).click();
  await expect(s.getByLabel("Commerciële notities")).toHaveValue("Bas: plattegrond opgevraagd (fictief).");
});

test("Verzoeklimiet: na drie aanvragen voor hetzelfde adres een nette melding, geen extra mail", async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await requestLink(page, "limiet@example.test");
    await expect(page.getByRole("status")).toContainText("Als dit adres toegang heeft");
  }
  await requestLink(page, "limiet@example.test");
  await expect(page.locator(".alert[role=alert]")).toContainText("Te veel aanvragen");
});
