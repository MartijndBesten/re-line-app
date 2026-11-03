import { test } from "node:test";
import assert from "node:assert/strict";
import { using } from "./support/store";
import { asActor } from "../lib/db";
import {
  activate, clientAddress, createSession, createUser, hashPassword, login, rateLimit, resetActivation, roleFromClaims,
  revokeSession, sessionCookie, sessionCookieName, sessionUser, updateUser, verifyPassword,
} from "../lib/auth";
// Uitsluitend fictieve accounts (example.test).
const cookie = (token: string) => `${sessionCookieName()}=${token}`;

test("Wachtwoorden: scrypt-hash, juiste en onjuiste controle, geen hash = altijd onjuist", async () => {
  const h = await hashPassword("lang-genoeg-wachtwoord");
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("lang-genoeg-wachtwoord", h), true);
  assert.equal(await verifyPassword("ander-wachtwoord-123", h), false);
  assert.equal(await verifyPassword("lang-genoeg-wachtwoord", null), false);
  assert.notEqual(await hashPassword("lang-genoeg-wachtwoord"), h, "eigen salt per hash");
});

test("Sessiecookie: HttpOnly en SameSite; bij https Secure met __Host-voorvoegsel", () => {
  const prev = process.env.RELINE_PUBLIC_URL;
  try {
    process.env.RELINE_PUBLIC_URL = "https://re-line.voorbeeld.test";
    const c = sessionCookie("x".repeat(43));
    assert.match(c, /^__Host-reline-sessie=/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.match(c, /Path=\//);
    assert.doesNotMatch(c, /Domain=/);
    process.env.RELINE_PUBLIC_URL = "http://127.0.0.1:3109";
    assert.doesNotMatch(sessionCookie("x".repeat(43)), /Secure/, "lokale http-test zonder Secure");
  } finally {
    if (prev === undefined) delete process.env.RELINE_PUBLIC_URL;
    else process.env.RELINE_PUBLIC_URL = prev;
  }
});

test("Account: aanmaken, activeren met sterk wachtwoord, inloggen, sessie, uitloggen", async () => {
  await using(async (db) => {
    const { id, activationToken } = await createUser(db, { email: " Anna@Example.TEST ", name: "Anna Test", role: "gebruiker" }, "Beheerder");
    await assert.rejects(() => createUser(db, { email: "anna@example.test", name: "Dubbel", role: "gebruiker" }, "x"), /bestaat al/);
    await assert.rejects(() => createUser(db, { email: "geen-mail", name: "X", role: "gebruiker" }, "x"), /geldig e-mailadres/);
    await assert.rejects(() => createUser(db, { email: "x@example.test", name: "X", role: "god" }, "x"), /rol/);
    assert.equal(await login(db, "anna@example.test", "nog-geen-wachtwoord"), null, "niet geactiveerd = niet inloggen");
    await assert.rejects(() => activate(db, activationToken!, "kort"), /minimaal 12/);
    await assert.rejects(() => activate(db, "x".repeat(43), "voldoende-lang-123"), /ongeldig of verlopen/);
    assert.equal(await activate(db, activationToken!, "voldoende-lang-123"), id);
    await assert.rejects(() => activate(db, activationToken!, "voldoende-lang-123"), /ongeldig of verlopen/, "link is eenmalig");
    assert.equal(await login(db, "ANNA@example.test", "verkeerd-wachtwoord"), null);
    assert.equal(await login(db, "anna@example.test", "voldoende-lang-123"), id);
    const token = await createSession(db, id);
    const u = await sessionUser(db, cookie(token));
    assert.deepEqual([u?.name, u?.role, u?.email], ["Anna Test", "gebruiker", "anna@example.test"]);
    assert.equal(await sessionUser(db, cookie("onzin")), null);
    await revokeSession(db, cookie(token));
    assert.equal(await sessionUser(db, cookie(token)), null, "na uitloggen geen toegang");
  });
});

test("Sessie verloopt (absoluut en na inactiviteit); deactiveren en nieuwe link trekken sessies in", async () => {
  await using(async (db) => {
    const admin = await createUser(db, { email: "beheer@example.test", name: "Beheer", role: "beheerder" }, "x");
    const user = await createUser(db, { email: "bram@example.test", name: "Bram", role: "gebruiker" }, "x");
    const t1 = await createSession(db, user.id);
    await db.run("UPDATE sessions SET expires=? WHERE user_id=?", new Date(Date.now() - 1000).toISOString(), user.id);
    assert.equal(await sessionUser(db, cookie(t1)), null, "absoluut verlopen");
    const t2 = await createSession(db, user.id);
    await db.run("UPDATE sessions SET last_seen=? WHERE user_id=? AND revoked=0 AND expires>?", new Date(Date.now() - 5 * 3600_000).toISOString(), user.id, new Date().toISOString());
    assert.equal(await sessionUser(db, cookie(t2)), null, "te lang inactief");
    const t3 = await createSession(db, user.id);
    const actor = { id: admin.id, name: "Beheer", role: "beheerder" as const };
    await asActor(actor, () => updateUser(db, user.id, { active: false }, actor));
    assert.equal(await sessionUser(db, cookie(t3)), null, "gedeactiveerd account");
    await asActor(actor, () => updateUser(db, user.id, { active: true }, actor));
    const t4 = await createSession(db, user.id);
    await asActor(actor, () => resetActivation(db, user.id));
    assert.equal(await sessionUser(db, cookie(t4)), null, "nieuwe activatielink trekt sessies in");
    // Laatste beheerder en eigen rechten blijven beschermd.
    await assert.rejects(() => updateUser(db, admin.id, { role: "gebruiker" }, actor), /eigen beheerdersrechten/);
    await assert.rejects(() => updateUser(db, admin.id, { active: false }, { id: "ander", name: "X", role: "beheerder" }), /minstens één actieve beheerder/);
    const audit = await db.all("SELECT action,user_name FROM audit WHERE action LIKE 'Account%' OR action LIKE 'Activatielink%'");
    assert.ok(audit.some((a) => a.action === "Account gewijzigd" && a.user_name === "Beheer"), "wie het account wijzigde staat in het auditlog");
  });
});

test("Rate limiting is gedeeld via de database en reset na het venster", async () => {
  await using(async (db) => {
    for (let i = 0; i < 5; i++) assert.equal(await rateLimit(db, "login.email", "anna@example.test"), true);
    assert.equal(await rateLimit(db, "login.email", "anna@example.test"), false);
    assert.equal(await rateLimit(db, "login.email", "bram@example.test"), true, "andere sleutel telt apart");
    await db.run("UPDATE rate_limits SET reset_at=?", new Date(Date.now() - 1).toISOString());
    assert.equal(await rateLimit(db, "login.email", "anna@example.test"), true, "na het venster weer toegestaan");
    const rows = await db.all("SELECT bucket FROM rate_limits");
    assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(String(r.bucket))), "alleen hashes, geen e-mailadressen");
  });
});

test("Inlogrem: client-adres van de vertrouwde proxy (rechts), niet het door de client meegestuurde adres", () => {
  assert.equal(clientAddress(null), "lokaal");
  assert.equal(clientAddress("203.0.113.7:51234"), "203.0.113.7", "poortnummer weg (anders telt iedere verbinding apart)");
  assert.equal(clientAddress("1.1.1.1, 203.0.113.7:443"), "203.0.113.7", "vervalst adres links wordt genegeerd");
  assert.equal(clientAddress("[2001:db8::1]:8080"), "2001:db8::1");
  assert.equal(clientAddress("198.51.100.1, 203.0.113.7, 10.0.0.4", 2), "203.0.113.7", "twee vertrouwde proxy's");
  assert.equal(clientAddress("203.0.113.7", 3), "203.0.113.7", "minder adressen dan hops: eerste");
});

test("Entra ID: rol uit app-rollen; zonder rol geen toegang", () => {
  const cfg = { adminRole: "Re-Line.Beheerder", userRole: "Re-Line.Gebruiker" };
  assert.equal(roleFromClaims({ roles: ["Re-Line.Beheerder", "Re-Line.Gebruiker"] }, cfg), "beheerder");
  assert.equal(roleFromClaims({ roles: ["Re-Line.Gebruiker"] }, cfg), "gebruiker");
  assert.equal(roleFromClaims({ roles: ["Iets.Anders"] }, cfg), null);
  assert.equal(roleFromClaims({}, cfg), null);
});

test("Gelijktijdig bewerken: verouderde versie geeft conflict met naam, niets overschreven", async () => {
  await using(async (db) => {
    await db.run("INSERT INTO projects(id,name,confidence,notes) VALUES('p1','Testhal','Hoog','')");
    const anna = { id: "a", name: "Anna Test", role: "gebruiker" as const };
    const bram = { id: "b", name: "Bram Test", role: "gebruiker" as const };
    const v0 = Number((await db.projectVersion("p1")).version);
    const r = await asActor(anna, () => db.updateProject("p1", { notes: "Anna belde", version: v0 }));
    assert.equal(r?.version, v0 + 1);
    await assert.rejects(
      () => asActor(bram, () => db.updateProject("p1", { notes: "Bram belde", version: v0 })),
      (e: Error & { current?: { updatedBy?: string } }) => /intussen gewijzigd door Anna Test/.test(e.message) && e.current?.updatedBy === "Anna Test",
    );
    const p = (await db.projects()).find((x) => x.id === "p1")!;
    assert.deepEqual([p.notes, p.updated_by, Number(p.version)], ["Anna belde", "Anna Test", v0 + 1]);
    await asActor(bram, () => db.updateProject("p1", { notes: "Anna belde; Bram belt terug", version: v0 + 1 }));
    const audit = await db.all("SELECT user_name FROM audit WHERE action='Project bijgewerkt' ORDER BY created");
    assert.deepEqual(audit.map((a) => a.user_name), ["Anna Test", "Bram Test"]);
    // Activiteit door een collega: wie, en geen onnodig conflict voor het dossierformulier.
    await asActor(anna, () => db.addActivity("p1", { kind: "Bellen", note: "Terugbellen", due: "2030-01-01" }));
    const d = await db.dossier("p1");
    assert.equal(d.activities[0].created_by, "Anna Test");
    assert.equal(Number(d.version), v0 + 2, "activiteit verhoogt de versie niet");
    assert.equal(d.updated_by, "Anna Test");
  });
});
