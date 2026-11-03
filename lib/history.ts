import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { canonical } from "./domain";
/**
 * Projecthistorie: geaggregeerde SAP-verkoopregels per SAP-projectnummer, boekjaar, klant,
 * materiaal en goederenontvanger (rapport "E-Line Projects", blad "Details").
 *
 * Dit is géén orderhistorie: er zijn geen ordernummers, geen leverstatus en geen leverdata.
 * Afzet is de SAP-hoeveelheid zonder eenheid in de export; omzet is historische verkoop en
 * zegt niets over de huidige installatie. Kostprijs-, korting- en margekolommen worden bewust
 * niet ingelezen of bewaard (allowlist hieronder).
 */
export const historyColumns = {
  orgUnit: "OrgStruktur St.2",
  projectNumber: "Projektnummer",
  largeProject: "Großprojekt E-Line",
  projectName: "Projektbezeichnung",
  fiscalYear: "Geschäftsjahr",
  customer: "Kd.stamm.Kunde+Name",
  material: "Material.Material",
  series: "Material.Baureihe Bez.",
  materialDesc: "Material.Material Bez.",
  recipientCity: "Ort des  Warenempfängers",
  projectCity: "Projekt Ort",
  projectStreet: "Projekt Straße",
  recipient: "Warenempfänger Bez.",
  quantity: "Absatz ",
  revenue: "Umsatz ",
  netRevenue: "Net-/Net-Umsatz",
} as const;
export type HistoryColumn = keyof typeof historyColumns;
/** Kolommen die nooit worden opgeslagen (kostprijs, korting, marge). Alleen ter documentatie/controle. */
export const excludedColumns = ["Bonus+Skonto", "KdUmsatzes", "SOF Leistung", "varHK DBW", "HK DBW", "DBW II", "DBW II %"];
const required: HistoryColumn[] = ["projectNumber", "fiscalYear", "material", "quantity", "revenue", "netRevenue"];
const amountColumns: HistoryColumn[] = ["quantity", "revenue", "netRevenue"];

export type HistoryRow = {
  key: string;
  sourceRow: number;
  projectNumber: string;
  projectName: string;
  fiscalYear: number;
  customerNumber: string;
  customerName: string;
  material: string;
  series: string;
  materialDesc: string;
  recipientNumber: string;
  recipientName: string;
  recipientCity: string;
  projectCity: string;
  projectStreet: string;
  orgUnit: string;
  quantity: number;
  revenue: number;
  netRevenue: number;
  /** Bronvelden uit de allowlist (zonder kostprijs/marge), zoals in de export. */
  raw: Record<string, string | number>;
};
export type HistoryParse = {
  sheet: string;
  rows: HistoryRow[];
  errors: string[];
  summaryRows: number;
  ignoredColumns: string[];
  totalDataRows: number;
};

/** "123456 Naam BV" → nummer + naam (SAP-stamnummer vooraan). */
export function splitNumberName(value: string) {
  const m = value.trim().match(/^(\d{3,})\s+(.+)$/);
  return m ? { number: m[1], name: m[2].trim() } : { number: "", name: value.trim() };
}
const placeholder = (s: string) => /^[-#?\s]*$/.test(s) || /^(not assigned|nicht zugeordnet|\(leer\))$/i.test(s.trim());
function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  // 1.234,56 of 1,234.56 of 1234.56
  const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function cellValue(c: ExcelJS.Cell): string | number {
  const v = c.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return typeof o.result === "number" ? o.result : String(o.result);
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text) return String(o.text);
  }
  return String(v);
}
/** Bron van de projecthistorie in bronrecords en importgeschiedenis. */
export const historySource = "sap-projecthistorie";
/**
 * Stabiele bronidentiteit van een historieregel: project, boekjaar, klantnummer, materiaal en
 * goederenontvanger (nummer, naam, plaats). Het rapport splitst per ontvangernaam/-plaats, dus die horen
 * erbij; projectnaam, straat, klantnaam, reeks en materiaalomschrijving niet, zodat een gewijzigde naam
 * in SAP geen dubbele regel oplevert. Bedragen horen er nooit bij (die mogen in een nieuwe export wijzigen).
 */
export function historyKey(r: {
  projectNumber: string; fiscalYear: number; customerNumber: string; material: string;
  recipientNumber: string; recipientName: string; recipientCity: string;
}) {
  const parts = [r.projectNumber, r.fiscalYear, r.customerNumber, r.material, r.recipientNumber, r.recipientName, r.recipientCity];
  return "hist2:" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}
/** Herkent het SAP-rapport aan de kolomkoppen (Duits, zoals geëxporteerd). */
export function historyMapping(headers: string[]): Partial<Record<HistoryColumn, number>> | null {
  const index: Partial<Record<HistoryColumn, number>> = {};
  for (const [k, label] of Object.entries(historyColumns) as [HistoryColumn, string][]) {
    const i = headers.findIndex((h) => canonical(h) === canonical(label));
    if (i >= 0) index[k] = i;
  }
  return required.every((k) => index[k] !== undefined) ? index : null;
}

/** Leest het blad met projecthistorie; null als het bestand dit formaat niet heeft. */
export async function parseHistoryWorkbook(buffer: Buffer): Promise<HistoryParse | null> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as never);
  for (const sheet of book.worksheets) {
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (c) => headers.push(String(cellValue(c))));
    const map = historyMapping(headers);
    if (!map) continue;
    const allowed = new Set(Object.values(map));
    const ignoredColumns = headers.filter((h, i) => h.trim() && !allowed.has(i));
    const rows: HistoryRow[] = [];
    const errors: string[] = [];
    let summaryRows = 0,
      totalDataRows = 0;
    const get = (vals: (string | number)[], k: HistoryColumn) => (map[k] === undefined ? "" : vals[map[k]!]);
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const vals = headers.map((_, i) => cellValue(row.getCell(i + 1)));
      const text = (k: HistoryColumn) => String(get(vals, k) ?? "").trim();
      const first = String(vals[0] ?? "").trim();
      if (!text("projectNumber") || /^(total|gesamtergebnis|totaal|summe)$/i.test(first)) {
        summaryRows++;
        return;
      }
      totalDataRows++;
      const year = text("fiscalYear");
      const amounts = Object.fromEntries(amountColumns.map((k) => [k, parseAmount(get(vals, k))])) as Record<string, number | null>;
      if (!/^\d{4}$/.test(year)) {
        errors.push(`Rij ${n}: boekjaar "${year}" is geen jaartal`);
        return;
      }
      if (!text("material")) {
        errors.push(`Rij ${n}: materiaal ontbreekt`);
        return;
      }
      if (amountColumns.some((k) => amounts[k] === null)) {
        errors.push(`Rij ${n}: afzet of omzet is geen getal`);
        return;
      }
      const customer = splitNumberName(text("customer"));
      const recipient = splitNumberName(text("recipient"));
      const clean = (k: HistoryColumn) => (placeholder(text(k)) ? "" : text(k));
      const base = {
        projectNumber: text("projectNumber"),
        projectName: clean("projectName"),
        fiscalYear: Number(year),
        customerNumber: customer.number,
        customerName: placeholder(customer.name) ? "" : customer.name,
        material: text("material"),
        series: clean("series"),
        materialDesc: clean("materialDesc"),
        recipientNumber: recipient.number,
        recipientName: placeholder(recipient.name) ? "" : recipient.name,
        recipientCity: clean("recipientCity"),
        projectCity: clean("projectCity"),
        projectStreet: clean("projectStreet"),
        orgUnit: clean("orgUnit"),
      };
      const raw: Record<string, string | number> = {};
      for (const [k, i] of Object.entries(map) as [HistoryColumn, number][]) raw[historyColumns[k].trim()] = vals[i];
      rows.push({
        ...base,
        key: historyKey(base),
        sourceRow: n,
        quantity: amounts.quantity!,
        revenue: amounts.revenue!,
        netRevenue: amounts.netRevenue!,
        raw,
      });
    });
    return { sheet: sheet.name, rows, errors, summaryRows, ignoredColumns, totalDataRows };
  }
  return null;
}

/** Reeksnaam volgens SAP-materiaalstam die op een oudere generatie wijst (bijv. "765... E-Line Old"). */
export const isOldSeries = (series: string) => /\bold\b/i.test(series);

export type RenovationInput = {
  firstYear: number | null;
  lastYear: number | null;
  netRevenue: number;
  lines: number;
  oldLines: number;
  oldNetRevenue: number;
  name: string;
  city: string;
  hasStreet: boolean;
  customers: number;
  recipients: number;
  maxCustomerProjects: number;
  need?: string;
  locationConfirmed?: number | boolean;
  relationshipConfirmed?: number | boolean;
};
export type ScorePart = { key: string; label: string; points: number; weight: number; detail: string };
const nl = (n: number) => Math.round(n).toLocaleString("nl-NL");

/**
 * Renovatiescore (0–100) voor dossiers met projecthistorie. Iedere component legt uit waarom er
 * wel of geen punten zijn. Omzet en afzet zijn historische verkoop, geen huidige installatieomvang.
 */
export function renovationScore(p: RenovationInput, year = new Date().getFullYear()) {
  const parts: ScorePart[] = [];
  const age = p.firstYear === null ? null : year - p.firstYear;
  const agePoints = age === null ? 0 : age >= 15 ? 30 : age >= 12 ? 26 : age >= 10 ? 22 : age >= 8 ? 16 : age >= 6 ? 10 : age >= 4 ? 4 : 0;
  parts.push({
    key: "historyAge",
    label: "Ouderdom (eerste boekjaar)",
    points: agePoints,
    weight: 30,
    detail:
      age === null
        ? "boekjaar onbekend"
        : `eerste boekjaar ${p.firstYear} (${age} jaar geleden)${p.lastYear && p.lastYear !== p.firstYear ? `, laatste ${p.lastYear}` : ""}` +
          (age < 6 ? "; installatie waarschijnlijk te recent voor renovatie" : ""),
  });
  const share = p.netRevenue > 0 ? Math.max(0, Math.min(1, p.oldNetRevenue / p.netRevenue)) : p.lines ? p.oldLines / p.lines : 0;
  const seriesPoints = p.oldLines > 0 ? Math.round(8 + 12 * share) : 0;
  parts.push({
    key: "historySeries",
    label: "Oudere E-Line-reeks",
    points: seriesPoints,
    weight: 20,
    detail: p.oldLines
      ? `reeks "E-Line Old" (volgens SAP-materiaalstam) in ${p.oldLines} van ${p.lines} regels, ${Math.round(share * 100)}% van de net-net-omzet`
      : "geen oudere reeks in de export",
  });
  const r = p.netRevenue;
  const sizePoints = r >= 1_000_000 ? 20 : r >= 500_000 ? 17 : r >= 250_000 ? 14 : r >= 100_000 ? 10 : r >= 50_000 ? 6 : r > 0 ? 3 : 0;
  parts.push({
    key: "historySize",
    label: "Omvang historische verkoop",
    points: sizePoints,
    weight: 20,
    detail: `net-net-omzet ${nl(r)} volgens export (historische verkoop, geen installatieomvang)`,
  });
  const nameOk = p.name.trim().length >= 4 && !/^Onbekend project/i.test(p.name);
  const recog = (nameOk ? 4 : 0) + (p.city.trim() ? 3 : 0) + (p.hasStreet ? 3 : 0);
  parts.push({
    key: "historyRecognizable",
    label: "Herkenbaarheid project en locatie",
    points: recog,
    weight: 10,
    detail: [nameOk ? "projectnaam" : "geen bruikbare projectnaam", p.city.trim() ? "projectplaats" : "plaats ontbreekt", p.hasStreet ? "straat" : "straat ontbreekt"].join(", "),
  });
  const rel = (p.customers ? 3 : 0) + (p.recipients ? 2 : 0);
  parts.push({
    key: "historyRelations",
    label: "Klant- en relatiegegevens",
    points: rel,
    weight: 5,
    detail: `${p.customers} klant(en), ${p.recipients} goederenontvanger(s) in de export`,
  });
  const m = p.maxCustomerProjects;
  const net = m >= 5 ? 5 : m >= 3 ? 4 : m >= 2 ? 2 : 0;
  parts.push({
    key: "historyNetwork",
    label: "Meerdere projecten via dezelfde klant",
    points: net,
    weight: 5,
    detail: m >= 2 ? `klant met ${m} projecten in de export: één relatie voor meerdere locaties` : "klant heeft alleen dit project in de export",
  });
  const conf = (p.need === "Ja" ? 5 : 0) + (p.locationConfirmed ? 3 : 0) + (p.relationshipConfirmed ? 2 : 0);
  parts.push({
    key: "historyConfirmed",
    label: "Bevestigd in gesprekken",
    points: conf,
    weight: 10,
    detail: conf ? [p.need === "Ja" && "renovatiebehoefte", p.locationConfirmed && "locatie", p.relationshipConfirmed && "relatie"].filter(Boolean).join(", ") + " bevestigd" : "nog niets bevestigd",
  });
  return { total: parts.reduce((s, x) => s + x.points, 0), parts };
}

type Rankable = {
  id: string;
  name: string;
  priority: number;
  historyLines?: number;
  historyFirstYear?: number | null;
  historyNetRevenue?: number;
  status?: string;
  replaced?: string;
};
const closedStatus = ["Gewonnen", "Verloren", "Geen actuele kans"];
/** Top-n renovatiekandidaten uit dossiers met projecthistorie; afgesloten/vervangen dossiers tellen niet mee. */
export function rankCandidates<T extends Rankable>(projects: T[], n = 100) {
  const pool = projects.filter(
    (p) => Number(p.historyLines) > 0 && !closedStatus.includes(String(p.status)) && p.replaced !== "Ja",
  );
  const ranked = [...pool].sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.historyFirstYear ?? 9999) - (b.historyFirstYear ?? 9999) ||
      Number(b.historyNetRevenue ?? 0) - Number(a.historyNetRevenue ?? 0) ||
      a.name.localeCompare(b.name, "nl"),
  );
  return { considered: pool.length, selected: ranked.slice(0, n) };
}
