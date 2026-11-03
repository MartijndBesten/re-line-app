import { test } from "node:test";
import assert from "node:assert/strict";
import { using } from "./support/store";
import {
  createSession, createUser, ensureBootstrapAdmin, hashToken, listUsers, login, rateLimit, requestEmailLink, sessionCookieName,
  sessionUser, updateUser, verifyEmailLink,
} from "../lib/auth";
import { loginMailText, mailConfigured } from "../lib/mail";
// Inloglink per e-mail (RELINE_AUTH=email), uitsluitend fictieve adressen (example.test).
process.env.RELINE_AUTH = "email";
process.env.RELINE_PUBLIC_URL = "https://re-line.example";
type Sent = { to: string; name: string; link: string; minutes: number };
const outbox = () => {
  const sent: Sent[] = [];
  return { sent, send: async (m: Sent) => void sent.push(m) };
};
const tokenOf = (link: string) => link.split("#inloggen=")[1];

test("Uitnodigen: alleen toegangslijst, geen wachtwoord of activatietoken; domeinbeperking optioneel", async () => {
  await using(async (db) => {
    const r = await createUser(db, { email: "Sanne@Example.TEST", name: "Sanne (fictief)", role: "gebruiker" }, "Beheerder");
    assert.equal(r.activationToken, null);
    const u = await db.one("SELECT * FROM users WHERE id=?", r.id);
    assert.equal(u?.auth_provider, "email");
    assert.equal(u?.password_hash, null);
    assert.equal(u?.activation_hash, null);
    assert.equal(Number((await listUsers(db))[0].pending), 1, "uitgenodigd tot eerste aanmelding");
    process.env.RELINE_EMAIL_DOMAINS = "example.test";
    try {
      await assert.rejects(createUser(db, { email: "iemand@ander.test", name: "X", role: "gebruiker" }, "B"), /Alleen adressen op @example\.test/);
      await createUser(db, { email: "bas@example.test", name: "Bas (fictief)", role: "gebruiker" }, "B");
    } finally {
      delete process.env.RELINE_EMAIL_DOMAINS;
    }
  });
});

test("Inloglink: zelfde uitkomst voor onbekend adres, token alleen als hash, eenmalig, nieuwe aanvraag vervangt de oude", async () => {
  await using(async (db) => {
    const { id } = await createUser(db, { email: "sanne@example.test", name: "Sanne (fictief)", role: "gebruiker" }, "B");
    const box = outbox();
    assert.deepEqual(await requestEmailLink(db, "onbekend@example.test", box.send), { sent: false });
    assert.deepEqual(await requestEmailLink(db, "geen-adres", box.send), { sent: false });
    assert.equal(box.sent.length, 0, "geen mail naar onbekende adressen");
    await requestEmailLink(db, " SANNE@example.test ", box.send);
    assert.equal(box.sent.length, 1);
    const m = box.sent[0];
    assert.equal(m.to, "sanne@example.test");
    assert.match(m.link, /^https:\/\/re-line\.example\/#inloggen=[A-Za-z0-9_-]{43}$/, "token in #-fragment, niet in pad of query");
    const stored = await db.one("SELECT activation_hash,activation_expires FROM users WHERE id=?", id);
    assert.equal(stored?.activation_hash, hashToken(tokenOf(m.link)), "alleen de hash staat in de database");
    const minutes = (Date.parse(String(stored?.activation_expires)) - Date.now()) / 60_000;
    assert.ok(minutes > 14 && minutes <= 15, "15 minuten geldig");
    // Nieuwe aanvraag maakt de vorige link ongeldig.
    await requestEmailLink(db, "sanne@example.test", box.send);
    await assert.rejects(verifyEmailLink(db, tokenOf(m.link)), /ongeldig, al gebruikt of verlopen/);
    const fresh = tokenOf(box.sent[1].link);
    assert.equal(await verifyEmailLink(db, fresh), id);
    await assert.rejects(verifyEmailLink(db, fresh), /ongeldig, al gebruikt of verlopen/, "eenmalig");
    await assert.rejects(verifyEmailLink(db, "x".repeat(43)), /ongeldig/);
    await assert.rejects(verifyEmailLink(db, "kort"), /ongeldig/);
    const token = await createSession(db, id);
    assert.equal((await sessionUser(db, `${sessionCookieName()}=${token}`))?.email, "sanne@example.test");
    assert.equal(Number((await listUsers(db))[0].pending), 0, "na eerste aanmelding actief");
    assert.equal(await login(db, "sanne@example.test", ""), null, "geen wachtwoordroute voor inloglinkaccounts");
  });
});

test("Inloglink: verlopen of gedeactiveerd account geeft geen toegang; twee gelijktijdige klikken = één sessie", async () => {
  await using(async (db) => {
    const admin = await createUser(db, { email: "petra@example.test", name: "Petra (fictief)", role: "beheerder" }, "B");
    const { id } = await createUser(db, { email: "bas@example.test", name: "Bas (fictief)", role: "gebruiker" }, "B");
    const box = outbox();
    await requestEmailLink(db, "bas@example.test", box.send);
    await db.run("UPDATE users SET activation_expires=? WHERE id=?", new Date(Date.now() - 1000).toISOString(), id);
    await assert.rejects(verifyEmailLink(db, tokenOf(box.sent[0].link)), /verlopen/);
    await requestEmailLink(db, "bas@example.test", box.send);
    const results = await Promise.allSettled([verifyEmailLink(db, tokenOf(box.sent[1].link)), verifyEmailLink(db, tokenOf(box.sent[1].link))]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "precies één klik slaagt");
    await updateUser(db, id, { active: false }, { id: admin.id, name: "Petra", role: "beheerder" });
    assert.deepEqual(await requestEmailLink(db, "bas@example.test", box.send), { sent: false }, "gedeactiveerd: geen nieuwe link");
    assert.equal(box.sent.length, 2);
  });
});

test("Eerste beheerder via opstartinstelling: alleen als er nog geen account is", async () => {
  await using(async (db) => {
    process.env.RELINE_BOOTSTRAP_ADMIN_EMAIL = "Petra@Example.test";
    process.env.RELINE_BOOTSTRAP_ADMIN_NAME = "Petra Pilot (fictief)";
    try {
      await ensureBootstrapAdmin(db);
      await ensureBootstrapAdmin(db);
      const users = await listUsers(db);
      assert.equal(users.length, 1);
      assert.deepEqual([users[0].email, users[0].role, users[0].auth_provider], ["petra@example.test", "beheerder", "email"]);
      process.env.RELINE_BOOTSTRAP_ADMIN_EMAIL = "ander@example.test";
      await ensureBootstrapAdmin(db);
      assert.equal((await listUsers(db)).length, 1, "bestaat er al een account, dan niets");
    } finally {
      delete process.env.RELINE_BOOTSTRAP_ADMIN_EMAIL;
      delete process.env.RELINE_BOOTSTRAP_ADMIN_NAME;
    }
  });
});

test("Verzoeklimiet inloglink en inhoud van de mail", async () => {
  await using(async (db) => {
    for (let i = 0; i < 3; i++) assert.equal(await rateLimit(db, "emaillink.email", "sanne@example.test"), true);
    assert.equal(await rateLimit(db, "emaillink.email", "sanne@example.test"), false, "4e aanvraag binnen 15 min geweigerd");
  });
  const text = loginMailText({ to: "x@example.test", name: "Sanne", link: "https://re-line.example/#inloggen=abc", minutes: 15 });
  assert.match(text, /15 minuten geldig en werkt één keer/);
  assert.match(text, /https:\/\/re-line\.example\/#inloggen=abc/);
  assert.match(text, /negeren/);
  delete process.env.RELINE_MAIL_SMTP_URL;
  assert.equal(mailConfigured(), false);
});
