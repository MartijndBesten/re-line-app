import Papa from "papaparse";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import {
  canonical,
  fields,
  type Field,
  type SourceRow,
  type Preview,
  type Normalized,
} from "./domain";
// Kolomnamen worden vergeleken na canonical(): kleine letters, zonder accenten, spaties en leestekens.
// Nederlandse Product Finder-namen plus verwachte Duitse SAP/Qlik-namen (niet bevestigd: zie
// lib/profiles.ts en source/SAP_DATA_CONTRACT.md). Een kolom wordt nooit aan twee velden gekoppeld.
export const aliases: Record<Field, string[]> = {
  order: ["order", "ordernummer", "verkoopdocument", "document", "salesdocument", "orderpositie", "orderregel",
    "verkaufsbeleg", "auftrag", "auftragsnummer", "kundenauftrag", "vertriebsbeleg", "belegnummer", "salesorder"],
  position: ["positie", "positieregel", "item", "position", "pos", "posnr", "positionsnummer", "auftragsposition"],
  lineId: ["regelid", "bronregelid", "lineid", "sourcelineid", "zeilenid", "datensatzid", "uniqueid"],
  article: ["artikel", "artikelcode", "artikelnummer", "materiaal", "material", "sapartikel", "materialnummer", "materialnr"],
  toc: ["toc", "toccode"],
  description: ["omschrijving", "productomschrijving", "description", "materiaalomschrijving",
    "materialkurztext", "materialbezeichnung", "kurztext", "bezeichnung", "produktbezeichnung"],
  unit: ["eenheid", "unit", "uom", "mengeneinheit", "verkaufsmengeneinheit", "basismengeneinheit", "me"],
  quantity: ["aantal", "quantity", "hoeveelheid", "orderhoeveelheid", "auftragsmenge", "menge", "bestellmenge", "orderquantity"],
  deliveredQuantity: ["geleverd", "geleverdaantal", "geleverdeaantal", "geleverdehoeveelheid", "liefermenge",
    "geliefertemenge", "deliveredquantity"],
  date: ["datum", "orderdatum", "documentdatum", "date", "erstelldatum", "belegdatum", "auftragsdatum", "angelegtam", "orderdate"],
  deliveryDate: ["leverdatum", "lieferdatum", "warenausgangsdatum", "wadatum", "istwarenausgangsdatum", "deliverydate"],
  orderStatus: ["status", "orderstatus", "leverstatus", "lieferstatus", "gesamtstatus", "belegstatus", "absagegrund"],
  documentType: ["documenttype", "ordertype", "type", "verkaufsbelegart", "belegart", "auftragsart"],
  project: ["project", "projectnaam", "projectplaats", "projectomschrijving", "projekt", "projektname",
    "projektbezeichnung", "bauvorhaben", "objekt"],
  projectNumber: ["projectnummer", "sapprojectnummer", "projectreferentie", "projektnummer", "projektnr",
    "pspelement", "projektdefinition"],
  city: ["plaats", "stad", "city", "ort", "stadt"],
  postcode: ["postcode", "postleitzahl", "plz", "zip", "zipcode"],
  country: ["land", "country", "landschluessel"],
  region: ["regio", "region", "verkoopkantoor", "verkaufsburo", "verkaufsbuero", "salesoffice"],
  address: ["adres", "afleveradres", "leveradres", "strasse", "strae", "lieferadresse", "anschrift"],
  debtor: ["debiteur", "debiteurnaam", "klant", "soldtoparty", "installateur", "auftraggeber", "kunde", "kundenname", "debitor"],
  debtorNumber: ["debiteurnummer", "klantnummer", "kundennummer", "debitorennummer", "auftraggebernummer"],
  recipient: ["goederenontvanger", "shiptoparty", "warenempfanger", "warenempfaenger", "goederenontvangernaam"],
  recipientNumber: ["goederenontvangernummer", "warenempfangernummer", "warenempfaengernummer", "shiptonumber"],
  familySource: ["productfamilie", "produktfamilie", "productfamily", "familie"],
  price: ["prijs", "nettoprijs", "nettoprijsbron", "price", "nettowert", "nettopreis"],
  currency: ["valuta", "currency", "wahrung", "waehrung"],
  source: ["bronsysteem", "source", "quellsystem"],
};
export function numberNL(s: string): number | null {
  if (!s.trim()) return null;
  let t = s.replace(/[€\s\u00a0]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export function dateNL(s: string): string | null {
  if (!s.trim()) return null;
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else {
    match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!match) throw Error("Onherkenbare datum: " + s);
    [, d, m, y] = match.map(Number);
  }
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    dt.getUTCFullYear() !== y! ||
    dt.getUTCMonth() !== m! - 1 ||
    dt.getUTCDate() !== d!
  )
    throw Error("Ongeldige datum: " + s);
  return dt.toISOString().slice(0, 10);
}
export function detect(headers: string[]) {
  const result: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  for (const key of Object.keys(fields) as Field[]) {
    const h = headers.find(
      (h) => !used.has(h) && aliases[key].includes(canonical(h)),
    );
    if (h) {
      result[key] = h;
      used.add(h);
    }
  }
  return result;
}
/** SHA-256 van het volledige bronbestand, om een eerder geïmporteerd bestand te herkennen. */
export function fileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
const pieceUnits = ["", "st", "stk", "stuk", "stuks", "stuck", "pc", "pcs", "ea", "piece", "pieces"];
/** Alleen expliciete trefwoorden; een onbekende status blijft "Normaal" en zichtbaar in de bron. */
export function lineState(status: string, documentType: string, quantity: number): Normalized["lineState"] {
  const text = (status + " " + documentType).toLowerCase();
  if (/(storn|annul|cancel|geannuleerd|afgewezen|abgelehnt|reject)/.test(text)) return "Geannuleerd";
  if (quantity < 0 || /(retour|retoure|return|gutschrift|creditnota|credit)/.test(text)) return "Retour/correctie";
  return "Normaal";
}
function markdown(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) throw Error("Geen Markdown-tabel gevonden");
  const cells = (s: string) =>
    s
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) =>
        c
          .trim()
          .replace(/\\\|/g, "|")
          .replace(/<br\s*\/?\s*>/gi, "\n"),
      );
  const headers = cells(lines[0]);
  if (new Set(headers).size !== headers.length)
    throw Error("Dubbele kolomnamen");
  return lines
    .slice(1)
    .filter((l) => !cells(l).every((c) => /^:?-+:?$/.test(c)))
    .map((l) =>
      Object.fromEntries(headers.map((h, i) => [h, cells(l)[i] ?? ""])),
    );
}
export async function readFile(
  name: string,
  buffer: Buffer,
): Promise<SourceRow[]> {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as never);
    const sheet = book.worksheets[0];
    if (!sheet) throw Error("Excel bevat geen werkblad");
    const cell = (c: ExcelJS.Cell) =>
      c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.text;
    const headers: string[] = [];
    sheet
      .getRow(1)
      .eachCell({ includeEmpty: true }, (c) => headers.push(cell(c).trim()));
    if (new Set(headers).size !== headers.length || headers.some((h) => !h))
      throw Error("Excel heeft lege of dubbele kolomnamen");
    const rows: SourceRow[] = [];
    sheet.eachRow((r, n) => {
      if (n > 1)
        rows.push(
          Object.fromEntries(
            headers.map((h, i) => [h, cell(r.getCell(i + 1))]),
          ),
        );
    });
    return rows;
  }
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (ext === "md" || ext === "markdown") return markdown(text);
  if (ext !== "csv") throw Error("Gebruik CSV, XLSX of Markdown");
  const parsed = Papa.parse<SourceRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length) throw Error("CSV: " + parsed.errors[0].message);
  return parsed.data;
}
export function normalize(
  raw: SourceRow,
  mapping: Partial<Record<Field, string>>,
): Normalized {
  const get = (k: Field) => (raw[mapping[k] ?? ""] ?? "").trim();
  let order = get("order"),
    position = get("position");
  const combined = order.match(/^(\d+)\s*(?:[/;:-]|\s+)\s*(\d+)$/);
  if (combined) {
    order = combined[1];
    if (!position) position = combined[2];
  }
  if (/^\d+$/.test(position)) position = position.replace(/^0+(?=\d)/, "");
  const article = get("article");
  const quantity = numberNL(get("quantity"));
  if (!order || !article || quantity === null)
    throw Error("Ordernummer, artikelcode en een geldig aantal zijn verplicht");
  const projectLines = get("project")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const debtorLines = get("debtor")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const source = get("source") || "SAP";
  const date = dateNL(get("date"));
  const deliveryDate = dateNL(get("deliveryDate"));
  const lineId = get("lineId");
  const warnings: string[] = [];
  if (!position && !lineId)
    warnings.push(
      "Positie ontbreekt: bronidentiteit gebruikt aanvullende velden; controleer mogelijke dubbelen",
    );
  if (!date) warnings.push("Orderdatum ontbreekt");
  const address = get("address");
  if (!address) warnings.push("Afleveradres ontbreekt; locatie onvolledig");
  const project = projectLines[0] ?? "",
    city =
      get("city") ||
      (projectLines.length > 1 ? projectLines.slice(1).join(" ") : "");
  if (!project)
    warnings.push("Projectnaam ontbreekt: niet met andere orders samengevoegd");
  if (quantity < 0)
    warnings.push(
      "Negatief aantal: retour/correctie, geen bewezen installatieomvang",
    );
  const deliveredText = get("deliveredQuantity");
  const deliveredQuantity = numberNL(deliveredText);
  if (deliveredText && deliveredQuantity === null)
    throw Error("Ongeldige geleverde hoeveelheid");
  // Historische EUR-bedragen blijven bronprijzen, nooit renovatietarieven.
  const price = numberNL(get("price").replace(/\s*EUR$/i, ""));
  if (get("price") && price === null)
    throw Error("Ongeldige historische prijs");
  const currency = get("currency").toUpperCase();
  if (currency && currency !== "EUR")
    warnings.push(
      `Valuta ${currency}: historische prijs niet vergelijkbaar met EUR-regels`,
    );
  const orderStatus = get("orderStatus"),
    documentType = get("documentType") || "Onbekend",
    state = lineState(orderStatus, documentType, quantity);
  if (state === "Geannuleerd")
    warnings.push(
      "Geannuleerde/afgewezen regel volgens bronstatus: telt niet mee in historische stuks",
    );
  const unit = get("unit");
  const pieces = pieceUnits.includes(canonical(unit));
  if (!pieces)
    warnings.push(
      `Eenheid ${unit}: aantal is geen stuks en telt niet mee in historische stuks`,
    );
  const identity = lineId
    ? [source, "regel-id", lineId]
    : position
      ? [source, order, position, article]
      : [
          source,
          order,
          article,
          date,
          quantity,
          project,
          city,
          get("description"),
        ];
  const key = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  return {
    order,
    position,
    lineId,
    article,
    toc: get("toc"),
    description: get("description"),
    unit,
    quantity,
    deliveredQuantity,
    date,
    deliveryDate,
    orderStatus,
    documentType,
    project,
    projectNumber: get("projectNumber"),
    city,
    postcode: get("postcode"),
    country: get("country"),
    region: get("region"),
    address,
    debtor: debtorLines[0] ?? "",
    debtorNumber:
      get("debtorNumber") || (debtorLines[1]?.match(/^\d+$/)?.[0] ?? ""),
    recipient: get("recipient"),
    recipientNumber: get("recipientNumber"),
    familySource: get("familySource"),
    price,
    currency,
    source,
    lineState: state,
    counted: state !== "Geannuleerd" && pieces ? 1 : 0,
    raw,
    key,
    warnings,
  };
}
export function preview(
  rows: SourceRow[],
  override?: Partial<Record<Field, string>>,
): Preview {
  const headers = Object.keys(rows[0] ?? {});
  if (!rows.length) throw Error("Bestand bevat geen gegevens");
  if (rows.length > 20000) throw Error("Maximaal 20.000 regels per import");
  const mapping = override ?? detect(headers);
  for (const col of Object.values(mapping)) {
    if (col && !headers.includes(col))
      throw Error("Veldkoppeling verwijst naar onbekende kolom");
  }
  const normalized: Normalized[] = [],
    errors: Preview["errors"] = [],
    warnings: Preview["warnings"] = [];
  rows.forEach((raw, i) => {
    try {
      const r = normalize(raw, mapping);
      normalized.push(r);
      r.warnings.forEach((message) => warnings.push({ row: i + 2, message }));
    } catch (e) {
      errors.push({ row: i + 2, message: (e as Error).message });
    }
  });
  return { headers, mapping, rows, normalized, errors, warnings };
}
