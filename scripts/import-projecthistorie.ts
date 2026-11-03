// Projecthistorie (SAP-rapport "E-Line Projects", blad Details) in de lokale Re-Line-database laden.
//
//   npm run import:projecthistorie -- --bestand "<pad naar .xlsx>" [--proef] [--db data/re-line.sqlite]
//                                      [--selecteer 100] [--herselecteer] [--bewaar-proef]
//
// --db            SQLite-bestand (standaard data/re-line.sqlite) of een postgres://-adres (centrale database).
// --proef         voert de import twee keer uit met alle controles binnen één transactie en draait die
//                 daarna terug: de database blijft ongewijzigd en er ontstaat geen kopie met klantgegevens.
// zonder --proef  SQLite: eerst een back-up (data/backups/…-voor-projecthistorie-….sqlite). PostgreSQL: de
//                 import is één transactie; herstel via de point-in-time back-ups van de database-omgeving.
// --selecteer n   bepaalt de werkvoorraad van n renovatiekandidaten als die er nog niet is (standaard 100;
//                 0 = niet). --herselecteer bepaalt hem opnieuw (status/eigenaar/notities blijven gelijk).
//
// Uitvoer bevat alleen tellingen en controles, geen klant-, project- of bedraggegevens per regel.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { asActor, Store } from "../lib/db";
import { excludedColumns, parseHistoryWorkbook, type HistoryRow } from "../lib/history";
import { fileHash } from "../lib/import";

type Check = { name: string; ok: boolean; detail: string };
function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}
const fail = (msg: string): never => {
  console.error("FOUT: " + msg);
  process.exit(1);
};
const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
const commercialFields = [
  "status", "present", "replaced", "need", "contact", "owner", "notes", "next_action", "due", "route",
  "location_confirmed", "relationship_confirmed", "end_user", "present_evidence", "replaced_evidence",
  "need_evidence", "location_evidence",
];
async function state(store: Store) {
  const count = async (sql: string) => Number((await store.one(sql))?.n ?? 0);
  const projects = new Map<string, Record<string, unknown>>();
  for (const p of await store.all("SELECT * FROM projects")) projects.set(String(p.id), p);
  return {
    projects,
    orderLines: await count("SELECT COUNT(*) n FROM order_lines"),
    activities: await count("SELECT COUNT(*) n FROM activities"),
    notes: await count("SELECT COUNT(*) n FROM projects WHERE notes<>''"),
    scenarios: await count("SELECT COUNT(*) n FROM scenarios"),
    relations: await count("SELECT COUNT(*) n FROM relations"),
    links: await count("SELECT COUNT(*) n FROM project_relations"),
    history: await count("SELECT COUNT(*) n FROM history_lines"),
    selections: (await store.all("SELECT name FROM selections")).map((s) => String(s.name)),
  };
}
async function verify(store: Store, before: Awaited<ReturnType<typeof state>>, rows: HistoryRow[], added: number, duplicates: number, updated = 0): Promise<Check[]> {
  const after = await state(store);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  add("Alle dataregels verwerkt", added + duplicates + updated === rows.length, `${nl(added)} nieuw + ${nl(updated)} bijgewerkt + ${nl(duplicates)} ongewijzigd = ${nl(rows.length)} regels in bestand`);
  add("Historie gegroeid met precies de nieuwe regels", after.history === before.history + added, `${nl(before.history)} → ${nl(after.history)}`);
  const dup = Number((await store.one("SELECT COUNT(*)-COUNT(DISTINCT source_key) n FROM history_lines"))?.n ?? 0);
  add("Geen dubbele bronregels in de database", dup === 0, `${dup} dubbele bronsleutels`);
  const db = new Map<string, { q: number; r: number; nr: number; project: string; nummer: string }>();
  for (const h of await store.all("SELECT source_key,quantity,revenue,net_revenue,project_id,project_number FROM history_lines"))
    db.set(String(h.source_key), { q: Number(h.quantity), r: Number(h.revenue), nr: Number(h.net_revenue), project: String(h.project_id), nummer: String(h.project_number) });
  let missing = 0;
  const sums = { file: [0, 0, 0], db: [0, 0, 0] };
  const projectsPerNumber = new Map<string, Set<string>>();
  for (const r of rows) {
    sums.file[0] += r.quantity; sums.file[1] += r.revenue; sums.file[2] += r.netRevenue;
    const d = db.get(r.key);
    if (!d) { missing++; continue; }
    sums.db[0] += d.q; sums.db[1] += d.r; sums.db[2] += d.nr;
    const set = projectsPerNumber.get(r.projectNumber) ?? new Set<string>();
    set.add(d.project);
    projectsPerNumber.set(r.projectNumber, set);
  }
  add("Iedere bronregel staat in de database", missing === 0, `${missing} ontbrekend`);
  add("Afzet en omzet zonder verlies", sums.file.every((v, i) => close(v, sums.db[i])), "afzet, omzet en net-net-omzet van bestand en database gelijk");
  const numbers = new Set(rows.map((r) => r.projectNumber));
  const split = [...projectsPerNumber.values()].filter((s) => s.size !== 1).length;
  add("Eén dossier per SAP-projectnummer", projectsPerNumber.size === numbers.size && split === 0, `${nl(numbers.size)} projectnummers, ${split} verdeeld over meerdere dossiers`);
  // SAP-waarden per project (meest recente boekjaar): naam/plaats/straat mogen alleen naar deze waarde wijzigen.
  const sap = new Map<string, Record<string, string>>();
  const latestYear = new Map<string, number>();
  for (const r of rows)
    if (r.fiscalYear >= (latestYear.get(r.projectNumber) ?? -1)) {
      latestYear.set(r.projectNumber, r.fiscalYear);
      sap.set(r.projectNumber, { name: r.projectName, city: r.projectCity, address: r.projectStreet });
    }
  let changed = 0, filled = 0, fromSap = 0;
  for (const [id, p] of before.projects) {
    const q = after.projects.get(id);
    if (!q) { changed++; continue; }
    if (commercialFields.some((f) => String(p[f] ?? "") !== String(q[f] ?? ""))) changed++;
    for (const f of ["name", "city", "address", "project_number"])
      if (String(p[f] ?? "") !== String(q[f] ?? "")) {
        if (String(p[f] ?? "") === "") filled++;
        else if (sap.get(String(q.project_number))?.[f] === String(q[f])) fromSap++;
        else changed++;
      }
  }
  add("Bestaande dossiers, statussen en notities ongewijzigd", changed === 0, `${nl(before.projects.size)} bestaande dossiers gecontroleerd; ${changed} onverwacht gewijzigd, ${filled} lege velden aangevuld, ${fromSap} projectgegevens bijgewerkt uit SAP`);
  add("Orderregels, activiteiten en scenario's behouden", after.orderLines === before.orderLines && after.activities === before.activities && after.scenarios === before.scenarios && after.notes === before.notes,
    `orderregels ${before.orderLines}→${after.orderLines}, activiteiten ${before.activities}→${after.activities}, scenario's ${before.scenarios}→${after.scenarios}, notities ${before.notes}→${after.notes}`);
  add("Relaties alleen toegevoegd", after.relations >= before.relations && after.links >= before.links, `relaties ${before.relations}→${after.relations}, koppelingen ${before.links}→${after.links}`);
  add("Eerdere selecties behouden", before.selections.filter((s) => !/^Renovatiekandidaten top/.test(s)).every((s) => after.selections.includes(s)), `${before.selections.length} selecties vooraf`);
  add("Projecthistorie gescheiden van orderregels", after.orderLines === before.orderLines, "historie staat in een eigen tabel, zonder ordernummers of leverstatus");
  return checks;
}
function print(title: string, checks: Check[]) {
  console.log(`\n${title}`);
  for (const c of checks) console.log(`  ${c.ok ? "OK  " : "FOUT"}  ${c.name}: ${c.detail}`);
  return checks.every((c) => c.ok);
}

class Rollback extends Error {}
async function main() {
  const a = args(process.argv.slice(2));
  if (!a.bestand || a.bestand === true) fail('Geef het bronbestand op: --bestand "<pad naar .xlsx>"');
  const file = path.resolve(String(a.bestand));
  if (!existsSync(file)) fail("Bestand niet gevonden: " + file);
  const dbArg = typeof a.db === "string" ? a.db : path.join("data", "re-line.sqlite");
  const target = /^postgres(ql)?:\/\//i.test(dbArg) ? dbArg : path.resolve(dbArg);
  const proef = !!a.proef;
  const n = a.selecteer === undefined ? 100 : Number(a.selecteer);
  if (!Number.isInteger(n) || n < 0) fail("--selecteer moet een geheel getal ≥ 0 zijn");

  const buffer = readFileSync(file);
  const parsed = await parseHistoryWorkbook(buffer);
  if (!parsed) fail("Geen projecthistorie herkend (verwacht blad met Projektnummer, Geschäftsjahr, Material, Absatz, Umsatz, Net-/Net-Umsatz)");
  const rows = parsed!.rows;
  const years = rows.map((r) => r.fiscalYear);
  const series: Record<string, number> = {};
  for (const r of rows) series[r.series || "Onbekend"] = (series[r.series || "Onbekend"] ?? 0) + 1;
  console.log(`Bronbestand: ${path.basename(file)} (sha256 ${fileHash(buffer).slice(0, 16)}…)`);
  console.log(`  Blad "${parsed!.sheet}": ${nl(parsed!.totalDataRows)} dataregels, ${parsed!.summaryRows} totaalregel(s) overgeslagen, ${parsed!.errors.length} fouten`);
  console.log(`  ${nl(new Set(rows.map((r) => r.projectNumber)).size)} SAP-projectnummers, boekjaren ${Math.min(...years)}–${Math.max(...years)}`);
  console.log(`  Reeksen: ${Object.entries(series).map(([k, v]) => `${k} ${nl(v)}`).join(" · ")}`);
  console.log(`  Niet ingelezen (kostprijs/korting/marge): ${parsed!.ignoredColumns.join(", ") || "geen"}`);
  if (parsed!.ignoredColumns.some((c) => !excludedColumns.includes(c))) console.log("  Let op: onbekende extra kolommen worden genegeerd.");
  if (parsed!.errors.length) {
    for (const e of parsed!.errors.slice(0, 10)) console.log("  " + e);
    fail("Bronbestand bevat fouten; niets geïmporteerd");
  }

  const store = await Store.open(target);
  console.log(`\n${proef ? "PROEF (wordt teruggedraaid)" : "Import"} in ${store.dialect === "postgres" ? "PostgreSQL" : "SQLite"}: ${store.driver.location}`);
  let ok = true;
  const run = async () => {
    const before = await state(store);
    console.log(`  Vooraf: ${nl(before.projects.size)} dossiers, ${nl(before.orderLines)} orderregels, ${nl(before.history)} historieregels, ${nl(before.activities)} activiteiten, ${nl(before.notes)} dossiers met notitie`);
    const result = await store.ingestHistory(path.basename(file), rows, { sha256: fileHash(buffer), totalRows: parsed!.totalDataRows });
    const updated = Number((result as { updated?: number }).updated ?? 0);
    console.log(`  Import: ${nl(result.added)} nieuwe regels, ${nl(updated)} bijgewerkt, ${nl(result.duplicates)} ongewijzigd, ${nl(result.newProjects)} nieuwe dossiers, ${result.conflicts.length} meldingen`);
    for (const c of result.conflicts.slice(0, 5)) console.log("    " + c.replace(/project \d+/, "project …").replace(/projectnummer \d+/, "projectnummer …"));
    ok = print("Controles na import", await verify(store, before, rows, result.added, result.duplicates, updated)) && ok;

    const hasSelection = !!(await store.one("SELECT value FROM settings WHERE key='candidates'"));
    if (n > 0 && (!hasSelection || a.herselecteer)) {
      const sel = await store.selectCandidates(n);
      console.log(`\nWerkvoorraad: ${sel.selected} renovatiekandidaten gekozen uit ${sel.considered} dossiers met projecthistorie ("${sel.selection}")`);
    } else if (hasSelection) console.log("\nWerkvoorraad renovatiekandidaten bestond al en is ongewijzigd (gebruik --herselecteer om opnieuw te bepalen)");
    const projects = await store.projects();
    const withHistory = projects.filter((p) => Number(p.historyLines) > 0);
    const cands = projects.filter((p) => p.candidate_rank !== null && p.candidate_rank !== undefined);
    const firstYears: Record<string, number> = {};
    for (const p of cands) {
      const k = String(p.historyFirstYear ?? "?");
      firstYears[k] = (firstYears[k] ?? 0) + 1;
    }
    const scores = cands.map((p) => p.priority);
    console.log(`  Dossiers totaal ${nl(projects.length)}, met projecthistorie ${nl(withHistory.length)}, kandidaten ${nl(cands.length)}`);
    if (cands.length)
      console.log(`  Kandidaten: score ${Math.min(...scores)}–${Math.max(...scores)}; eerste boekjaar: ${Object.entries(firstYears).sort().map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    const candChecks: Check[] = [];
    if (n > 0) {
      const expected = Math.min(n, withHistory.filter((p) => !["Gewonnen", "Verloren", "Geen actuele kans"].includes(String(p.status)) && p.replaced !== "Ja").length);
      candChecks.push({ name: "Werkvoorraad renovatiekandidaten", ok: cands.length === expected || (hasSelection && !a.herselecteer), detail: `${cands.length} met rangnummer (verwacht ${expected})` });
      candChecks.push({ name: "Iedere kandidaat heeft uitleg per criterium", ok: cands.every((p) => p.scoreParts.length >= 6 && p.scoreParts.every((s) => "detail" in s)), detail: "7 criteria met punten en toelichting" });
    }
    const distinct = new Set(rows.map((r) => r.projectNumber)).size;
    candChecks.push({ name: "Alle projecten blijven vindbaar", ok: withHistory.length >= distinct, detail: `${nl(withHistory.length)} dossiers met projecthistorie in de lijst (${nl(distinct)} projectnummers in bestand)` });
    ok = print("Controles werkvoorraad", candChecks) && ok;

    if (proef) {
      const before2 = await state(store);
      const second = await store.ingestHistory(path.basename(file), rows, { sha256: fileHash(buffer), totalRows: parsed!.totalDataRows });
      const updated2 = Number((second as { updated?: number }).updated ?? 0);
      ok = print("Tweede, identieke import (proef)", [
        { name: "Geen nieuwe of gewijzigde regels", ok: second.added === 0 && updated2 === 0, detail: `${second.added} nieuw, ${updated2} bijgewerkt, ${nl(second.duplicates)} ongewijzigd` },
        { name: "Geen nieuwe dossiers", ok: second.newProjects === 0, detail: `${second.newProjects} nieuw` },
        ...(await verify(store, before2, rows, second.added, second.duplicates, updated2)),
      ]) && ok;
    }
  };
  try {
    await asActor({ id: null, name: "Beheerder (opdrachtregel)", role: "beheerder" }, async () => {
      if (proef) {
        await store
          .transaction(async () => {
            await run();
            throw new Rollback();
          })
          .catch((e) => {
            if (!(e instanceof Rollback)) throw e;
          });
        console.log("\nProef teruggedraaid: de database is ongewijzigd.");
      } else {
        if (store.dialect === "sqlite" && existsSync(target)) console.log(`  Back-up vooraf: ${(await store.backup("voor-projecthistorie")).name}`);
        else if (store.dialect === "postgres") console.log("  Back-up: point-in-time back-ups van de PostgreSQL-omgeving; de import is één transactie.");
        await store.transaction(async () => {
          await run();
          // Mislukte controle = niets doorvoeren.
          if (!ok) throw Error("Controles mislukt; de import is teruggedraaid en de database is ongewijzigd");
        });
      }
    });
  } finally {
    await store.close();
  }
  console.log(ok ? "\nResultaat: alle controles geslaagd." : "\nResultaat: NIET alle controles geslaagd; zie FOUT hierboven.");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => fail((e as Error).message));
