import ExcelJS from "exceljs";
import { createUser } from "../lib/auth";
import type { Store } from "../lib/db";
import { excludedColumns } from "../lib/history";
/**
 * Acceptatiepilot: drie fictieve gebruikers en een synthetische SAP-projectexport (zelfde kolommen als het
 * rapport "E-Line Projects", met verzonnen waarden). Bedoeld om de centrale omgeving te keuren zónder echte
 * klant- of SAP-gegevens. Alle namen, nummers, plaatsen en bedragen zijn verzonnen en gemarkeerd als fictief.
 */
export const pilotUsers = [
  { key: "beheerder", name: "Petra Pilot (fictief)", email: "petra.pilot@example.test", role: "beheerder" },
  { key: "verkoop", name: "Sanne Verkoop (fictief)", email: "sanne.verkoop@example.test", role: "gebruiker" },
  { key: "binnendienst", name: "Bas Binnendienst (fictief)", email: "bas.binnendienst@example.test", role: "gebruiker" },
] as const;
export type PilotKey = (typeof pilotUsers)[number]["key"];

type Line = { year: number; series: string; qty: number; net: number };
type Project = { nr: number; name: string; customer: string; city: string; street: string; recipient: string; lines: Line[] };
const old = "765... E-Line Old";
const now = "765... E-Line";
const c1 = "300001 Fictief Installatiebedrijf Noord BV";
const c2 = "300002 Fictieve Elektrotechniek Zuid BV";
const c3 = "300003 Voorbeeld Technisch Beheer BV";
const r1 = "400001 Fictieve Groothandel Oost";
const r2 = "400002 Fictieve Groothandel West";
/** Twaalf synthetische projecten met spreiding in ouderdom, reeks, omvang en klant. */
export const pilotProjects: Project[] = [
  { nr: 9900001, name: "Fictief kantoor Pilotplein", customer: c1, city: "Teststad", street: "Pilotplein 1", recipient: r1,
    lines: [{ year: 2010, series: old, qty: 420, net: 61000 }, { year: 2011, series: old, qty: 80, net: 9000 }] },
  { nr: 9900002, name: "Fictieve sporthal De Proef", customer: c1, city: "Proefdorp", street: "Sportlaan 2", recipient: r1,
    lines: [{ year: 2012, series: old, qty: 160, net: 21000 }] },
  { nr: 9900003, name: "Fictief distributiecentrum Voorbeeld", customer: c2, city: "Voorbeeldveen", street: "Logistiekweg 3", recipient: r2,
    lines: [{ year: 2009, series: old, qty: 900, net: 118000 }, { year: 2010, series: old, qty: 150, net: 17500 }, { year: 2015, series: now, qty: 40, net: 6000 }] },
  { nr: 9900004, name: "Fictieve school Oefenhof", customer: c3, city: "Teststad", street: "-", recipient: r1,
    lines: [{ year: 2014, series: now, qty: 120, net: 15000 }] },
  { nr: 9900005, name: "Fictief ziekenhuis Proefzorg", customer: c2, city: "Fictiefhaven", street: "Zorgpad 5", recipient: r2,
    lines: [{ year: 2011, series: old, qty: 640, net: 88000 }] },
  { nr: 9900006, name: "Fictieve werkplaats Testerij", customer: c1, city: "Proefdorp", street: "Ambachtstraat 6", recipient: r1,
    lines: [{ year: 2018, series: now, qty: 60, net: 7200 }] },
  { nr: 9900007, name: "Fictief gemeentehuis Oefenstad", customer: c3, city: "Oefenstad", street: "Raadhuisplein 7", recipient: r2,
    lines: [{ year: 2013, series: old, qty: 210, net: 26000 }, { year: 2013, series: now, qty: 30, net: 4100 }] },
  { nr: 9900008, name: "Fictieve parkeergarage Demo", customer: c2, city: "Voorbeeldveen", street: "-", recipient: r2,
    lines: [{ year: 2016, series: now, qty: 300, net: 33000 }] },
  { nr: 9900009, name: "Fictief laboratorium Proefbuis", customer: c3, city: "Fictiefhaven", street: "Labweg 9", recipient: r1,
    lines: [{ year: 2012, series: old, qty: 95, net: 12500 }] },
  { nr: 9900010, name: "Fictieve winkelpassage Testlaan", customer: c1, city: "Teststad", street: "Testlaan 10", recipient: r1,
    lines: [{ year: 2022, series: now, qty: 180, net: 24000 }] },
  { nr: 9900011, name: "Fictief zwembad Plons", customer: c2, city: "Oefenstad", street: "Badweg 11", recipient: r2,
    lines: [{ year: 2010, series: old, qty: 70, net: 8800 }] },
  { nr: 9900012, name: "Fictieve opslaghal Voorraad", customer: c3, city: "Proefdorp", street: "-", recipient: r2,
    lines: [{ year: 2024, series: now, qty: 50, net: 5200 }] },
];
export const pilotLineCount = pilotProjects.reduce((n, p) => n + p.lines.length, 0);
export const pilotFileName = "synthetische-sap-export-pilot.xlsx";

/** Synthetische export met dezelfde kolommen als het echte rapport, inclusief (verzonnen) kost-/margekolommen die Re-Line hoort te negeren. */
export async function pilotWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const d = book.addWorksheet("Details");
  d.addRow([
    "OrgStruktur St.2", "Projektnummer", "Großprojekt E-Line", "Projektbezeichnung", "Geschäftsjahr", "Kd.stamm.Kunde+Name",
    "Material.Material", "Material.Baureihe Bez.", "Material.Material Bez.", "Ort des  Warenempfängers", "Projekt Ort",
    "Projekt Straße", "Warenempfänger Bez.", "Absatz ", "Umsatz ", "Net-/Net-Umsatz", ...excludedColumns,
  ]);
  for (const p of pilotProjects)
    for (const l of p.lines)
      d.addRow([
        "TX NL", p.nr, "X", p.name, String(l.year), p.customer, `PILOT-${l.series.includes("Old") ? "OUD" : "NIEUW"}-${l.year}`,
        l.series, "Fictief draagprofiel (pilot)", "Fictiefplaats WE", p.city, p.street, p.recipient, l.qty, Math.round(l.net * 1.04), l.net,
        1, 2, 3, 4, 5, 6, 0.1,
      ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * Pilot klaarzetten: alleen op een lege database (geen dossiers, historie, orderregels of accounts), zodat
 * synthetische en echte gegevens nooit door elkaar lopen. Maakt bij wachtwoordaccounts de drie fictieve
 * accounts aan en geeft hun eenmalige activatiecodes terug. De synthetische export importeert de beheerder
 * daarna zelf via Import, net als straks een echte SAP-export.
 */
export async function preparePilot(store: Store, opts: { accounts: boolean }) {
  const filled: string[] = [];
  for (const t of ["projects", "history_lines", "order_lines", "users", "activities"]) {
    const n = Number((await store.one(`SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0);
    if (n) filled.push(`${t} (${n})`);
  }
  if (filled.length)
    throw Error(`De pilot wordt alleen op een lege database klaargezet; deze bevat al ${filled.join(", ")}. Er is niets gewijzigd.`);
  const users: { key: PilotKey; name: string; email: string; role: string; activationToken: string | null }[] = [];
  for (const u of pilotUsers) {
    const token = opts.accounts ? (await createUser(store, { email: u.email, name: u.name, role: u.role }, "Pilotvoorbereiding")).activationToken : null;
    users.push({ key: u.key, name: u.name, email: u.email, role: u.role, activationToken: token });
  }
  return { users };
}
