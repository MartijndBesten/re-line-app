// Geschoonde, code-only deploybron voor een externe host (bijv. Render): alleen de applicatiecode, géén bron-
// bestanden, databases, testgegevens met echte namen of Git-historie van de workbench-monorepo.
//
//   node scripts/schone-deploybron.mjs --uit <lege map> [--bron-xlsx "<pad naar echte SAP-export>"]
//
// 1. Neemt alleen bestanden uit deze appmap die Git kent (gevolgd of nieuw, niet genegeerd): geen data/, .env, builds.
// 2. Laat weg: de bronvalidatie op de echte Product Finder-CSV (tests/source/, playwright.source.config.ts).
// 3. Controleert ALLE meegenomen bestanden op project-/klantnamen, straten en nummers uit de echte bronnen
//    (Product Finder-CSV in ../../source/ en, indien opgegeven, de SAP-export). Eén treffer = stoppen.
//    Uitvoer noemt alleen bestandsnamen en aantallen, nooit de gevonden waarden.
// 4. Schrijft render.yaml (gratis demo, synthetische gegevens) en DEPLOY.md, en maakt een nieuwe Git-repository met
//    één commit zonder historie.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const fail = (m) => {
  console.error("FOUT: " + m);
  process.exit(1);
};
const app = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = arg("uit") ? path.resolve(arg("uit")) : fail("Geef --uit <lege map>");
if (existsSync(out) && readdirSync(out).length) fail(`${out} is niet leeg`);
const excluded = [/^tests\/source\//, /^playwright\.source\.config\.ts$/, /^data\//, /^test-results\//, /(^|\/)\.env/];

// 1–2. Bestandslijst
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: app, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => existsSync(path.join(app, f)) && !excluded.some((r) => r.test(f)));

// 3. Zoektermen uit de echte bronnen
const terms = new Set();
const numbers = new Set();
// Algemene woorden die in de bron als plaatshouder staan (geen naam), en dus ook gewoon in de code voorkomen.
const generic = new Set(["onbekend", "unbekannt", "diverse", "diversen"]);
const addName = (v) => {
  const s = String(v ?? "").trim().replace(/^\d+\s+/, "").toLowerCase();
  if (s.length >= 6 && s !== "-" && /[a-z]/.test(s) && !generic.has(s)) terms.add(s);
};
const addNumber = (v) => {
  const s = String(v ?? "").trim();
  if (/^\d{6,}$/.test(s)) numbers.add(s);
};
const sourceDir = path.resolve(app, "../../source");
const csv = path.join(sourceDir, "Product-Finder-10067901-import.csv");
if (existsSync(csv)) {
  const [head, ...rows] = readFileSync(csv, "utf8").split(/\r?\n/).filter(Boolean);
  const sep = head.includes(";") ? ";" : ",";
  const cols = head.split(sep).map((c) => c.replace(/"/g, ""));
  const split = (l) => l.match(new RegExp(`("([^"]|"")*"|[^${sep}]*)(${sep}|$)`, "g")).map((c) => c.replace(new RegExp(`${sep}$`), "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  for (const r of rows) {
    const cells = split(r);
    for (const c of ["projectnaam", "debiteur"]) addName(cells[cols.indexOf(c)]);
    for (const c of ["ordernummer", "debiteurnummer"]) addNumber(cells[cols.indexOf(c)]);
  }
}
const xlsx = arg("bron-xlsx");
if (xlsx) {
  if (!existsSync(xlsx)) fail("SAP-export niet gevonden");
  const ExcelJS = createRequire(path.join(app, "package.json"))("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(xlsx);
  const sheet = book.getWorksheet("Details");
  const header = sheet.getRow(1).values.map((v) => String(v ?? "").trim());
  const idx = (h) => header.indexOf(h);
  sheet.eachRow((row, n) => {
    if (n < 2) return;
    for (const h of ["Projektbezeichnung", "Kd.stamm.Kunde+Name", "Projekt Straße", "Warenempfänger Bez."]) addName(row.getCell(idx(h)).value);
    addNumber(row.getCell(idx("Projektnummer")).value);
    for (const h of ["Kd.stamm.Kunde+Name", "Warenempfänger Bez."]) addNumber(String(row.getCell(idx(h)).value ?? "").split(" ")[0]);
  });
}
const numberRe = numbers.size ? new RegExp(`\\b(${[...numbers].join("|")})\\b`, "g") : null;
const hits = [];
for (const f of files) {
  const buf = readFileSync(path.join(app, f));
  if (buf.includes(0)) continue; // binair (geen tekst)
  const text = buf.toString("utf8").toLowerCase();
  let n = 0;
  for (const t of terms) if (text.includes(t)) n++;
  if (numberRe && f !== "package-lock.json") n += (text.match(numberRe) ?? []).length;
  if (n) hits.push(`${f} (${n})`);
}
console.log(`Bestanden: ${files.length} · zoektermen uit echte bronnen: ${terms.size} namen, ${numbers.size} nummers${xlsx ? "" : " (SAP-export niet opgegeven)"}`);
if (hits.length) fail(`mogelijke echte gegevens in: ${hits.join(", ")}. Niets gemaakt.`);

// 4. Kopiëren, render.yaml, DEPLOY.md, nieuwe repository
for (const f of files) {
  mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  copyFileSync(path.join(app, f), path.join(out, f));
}
const pkg = JSON.parse(readFileSync(path.join(out, "package.json"), "utf8"));
delete pkg.scripts["validate:source"];
writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(
  path.join(out, "render.yaml"),
  `# Render Blueprint — afgeschermde DEMO met uitsluitend synthetische gegevens (gratis instanties, Frankfurt).
# Gratis PostgreSQL verloopt na 30 dagen en heeft geen back-ups: NOOIT voor echte TRILUX-gegevens gebruiken.
services:
  - type: web
    name: re-line-demo
    runtime: node
    plan: free
    region: frankfurt
    buildCommand: npm ci && npm run build
    startCommand: npm run demo:vullen && npx next start --hostname 0.0.0.0 --port $PORT
    envVars:
      - key: RELINE_AUTH
        value: email
      - key: RELINE_DEMO
        value: "1"
      - key: NEXT_TELEMETRY_DISABLED
        value: "1"
      - key: RELINE_DATABASE_URL
        fromDatabase:
          name: re-line-demo-db
          property: connectionString
      - key: RELINE_PUBLIC_URL      # eerst https://re-line-demo.onrender.com, na DNS https://reline.denckh.nl
        sync: false
      - key: RELINE_MAIL_SMTP_URL   # smtp://gebruiker:wachtwoord@host:2525 (465/587 zijn op gratis Render geblokkeerd)
        sync: false
      - key: RELINE_MAIL_FROM       # bijv. Re-Line <noreply@denckh.nl>
        sync: false
      - key: RELINE_BOOTSTRAP_ADMIN_EMAIL
        sync: false
      - key: RELINE_BOOTSTRAP_ADMIN_NAME
        sync: false
      - key: RELINE_EMAIL_DOMAINS   # optioneel, bijv. trilux.com (domein geeft nooit zelf toegang)
        sync: false
databases:
  - name: re-line-demo-db
    plan: free
    region: frankfurt
    postgresMajorVersion: "16"
`,
);
const source = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: app, encoding: "utf8" }).trim();
writeFileSync(
  path.join(out, "DEPLOY.md"),
  `# Re-Line — geschoonde deploybron

Gegenereerd met \`scripts/schone-deploybron.mjs\` uit \`martijn-ai-workbench\`, projectbranch \`project/re-line-utiliteit\`
(commit ${source}${files.some((f) => !execFileSync("git", ["ls-files", f], { cwd: app, encoding: "utf8" }).trim()) ? " + nog niet gecommitte wijzigingen" : ""}).
Bevat alleen applicatiecode: geen bronbestanden, databases, SAP-exports, klantgegevens of historie.

- Demo (synthetisch): \`render.yaml\` — gratis webdienst + gratis PostgreSQL (30 dagen, geen back-ups).
- Aanmelden: \`RELINE_AUTH=email\` — alleen uitgenodigde adressen, inloglink per e-mail (15 minuten, eenmalig).
- Echte TRILUX-gegevens alleen in een goedgekeurde omgeving met back-ups; niet in deze demo.
`,
);
const git = (...a) => execFileSync("git", a, { cwd: out, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Re-Line deploybron", GIT_AUTHOR_EMAIL: "deploybron@users.noreply.github.com", GIT_COMMITTER_NAME: "Re-Line deploybron", GIT_COMMITTER_EMAIL: "deploybron@users.noreply.github.com" } });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", `Re-Line code-only deploybron (uit project/re-line-utiliteit ${source})`);
const size = files.reduce((n, f) => n + statSync(path.join(out, f)).size, 0);
console.log(`Geschoonde deploybron: ${out} · ${files.length} bestanden · ${(size / 1024).toFixed(0)} KB · 1 commit, geen historie`);
