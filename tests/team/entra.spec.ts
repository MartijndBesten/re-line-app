import { test, expect, type Browser } from "@playwright/test";
// "Aanmelden met Microsoft" (RELINE_AUTH=entra) tegen een gesimuleerde identity provider (scripts/mock-oidc.mjs):
// echte OpenID Connect-route met PKCE, state, nonce, ondertekend ID-token en app-rollen. Fictieve persona's.
test.describe.configure({ mode: "serial" });
const base = "http://127.0.0.1:3110";
async function signIn(browser: Browser, persona: string) {
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
  await expect(page.getByLabel("E-mailadres")).toHaveCount(0);
  await page.getByRole("link", { name: "Aanmelden met Microsoft" }).click();
  await expect(page.getByRole("heading", { name: "Gesimuleerde Microsoft-aanmelding (test)" })).toBeVisible();
  await page.getByRole("link", { name: `Aanmelden als ${persona}` }).click();
  return page;
}

test("Collega meldt zich aan met Microsoft en krijgt de rol gebruiker uit Entra ID", async ({ browser }) => {
  const page = await signIn(browser, "Daan Verkoop (fictief)");
  await expect(page.getByLabel("Ingelogd")).toContainText("Daan Verkoop (fictief)");
  await expect(page.getByLabel("Ingelogd")).toContainText("Gebruiker");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  await expect(page.getByText(/Aanmelden via Microsoft Entra ID/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Account aanmaken" })).toHaveCount(0);
});

test("Beheerder via app-rol Re-Line.Beheerder", async ({ browser }) => {
  const page = await signIn(browser, "Eva Beheer (fictief)");
  await expect(page.getByLabel("Ingelogd")).toContainText("Beheerder");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Instellingen", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gebruikers", exact: true })).toContainText("Daan Verkoop (fictief)");
});

test("Zonder toegewezen app-rol geen toegang", async ({ browser }) => {
  const page = await signIn(browser, "Zonder Rol (fictief)");
  await expect(page.locator(".alert[role=alert]")).toContainText("heeft nog geen toegang tot Re-Line");
  await expect(page.getByLabel("Ingelogd")).toHaveCount(0);
  expect((await page.request.get("/api/workbench")).status()).toBe(401);
});

test("Gedeactiveerde collega kan zich niet meer aanmelden, ook niet met een geldige Microsoft-aanmelding", async ({ browser }) => {
  const admin = await signIn(browser, "Eva Beheer (fictief)");
  await admin.getByRole("button", { name: "Instellingen", exact: true }).click();
  await admin.getByRole("row").filter({ hasText: "Daan Verkoop (fictief)" }).getByRole("button", { name: "Deactiveren" }).click();
  await expect(admin.getByRole("status")).toContainText("gedeactiveerd");
  const page = await signIn(browser, "Daan Verkoop (fictief)");
  await expect(page.locator(".alert[role=alert]")).toContainText("Je account is gedeactiveerd");
});
