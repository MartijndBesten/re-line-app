import { test } from "node:test";
import assert from "node:assert/strict";
import { using } from "./support/store";
import { excludedColumns, parseHistoryWorkbook } from "../lib/history";
import { listUsers } from "../lib/auth";
import { pilotLineCount, pilotProjects, pilotUsers, pilotWorkbook, preparePilot } from "../pilot/pilot";
// Acceptatiepilot: uitsluitend fictieve accounts en synthetische projecten.

test("Pilotset: synthetische export wordt herkend als SAP-projectrapport, kost-/margekolommen genegeerd", async () => {
  const p = await parseHistoryWorkbook(await pilotWorkbook());
  assert.ok(p);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, pilotLineCount);
  assert.equal(new Set(p.rows.map((r) => r.projectNumber)).size, pilotProjects.length);
  assert.deepEqual(p.ignoredColumns, excludedColumns);
  for (const r of p.rows) {
    for (const c of excludedColumns) assert.equal(c in r.raw, false, c);
    assert.match(String(r.projectName), /^Fictie(f|ve) /, "projectnaam herkenbaar fictief");
  }
});

test("Pilot klaarzetten: drie fictieve accounts op een lege database; tweede keer en gevulde database geweigerd", async () => {
  await using(async (db) => {
    const { users } = await preparePilot(db, { accounts: true });
    assert.equal(users.length, 3);
    assert.ok(users.every((u) => u.activationToken && u.email.endsWith("@example.test")));
    const list = await listUsers(db);
    assert.deepEqual(list.map((u) => [u.email, u.role, Number(u.pending)]).sort(), pilotUsers.map((u) => [u.email, u.role, 1]).sort());
    await assert.rejects(preparePilot(db, { accounts: true }), /alleen op een lege database.*users \(3\)/);
    assert.equal((await listUsers(db)).length, 3, "niets gewijzigd");
  });
  await using(async (db) => {
    const p = await parseHistoryWorkbook(await pilotWorkbook());
    const r = await db.ingestHistory("bestaand.xlsx", p!.rows);
    assert.equal(r.newProjects, pilotProjects.length);
    await assert.rejects(preparePilot(db, { accounts: true }), /projects \(12\)/);
    assert.equal((await listUsers(db)).length, 0);
  });
  await using(async (db) => {
    const { users } = await preparePilot(db, { accounts: false });
    assert.ok(users.every((u) => u.activationToken === null), "Entra ID: geen eigen accounts");
    assert.equal((await listUsers(db)).length, 0);
  });
});
