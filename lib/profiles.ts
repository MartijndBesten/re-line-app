import { canonical, fields, type Field } from "./domain";
/**
 * Importprofielen. Een profiel is een opgeslagen kolomkoppeling (bronkolom → Re-Line-veld).
 * Het ingebouwde Duitse SAP/Qlik-profiel is een VERWACHTING op basis van gangbare SAP-veldnamen,
 * geen bevestigde exportspecificatie (zie source/SAP_DATA_CONTRACT.md en VRAGEN V-003).
 * Velden die in een bestand ontbreken blijven "Niet beschikbaar"; er wordt niets aangevuld.
 */
export type Mapping = Partial<Record<Field, string>>;
export interface SavedProfile {
  id: string;
  name: string;
  mapping: Mapping;
  notes?: string;
}

export const sapGermanExpected: {
  field: Field;
  columns: string[];
  need: "vereist" | "sterk gewenst" | "indien aanwezig";
}[] = [
  { field: "order", columns: ["Verkaufsbeleg", "Auftrag", "Kundenauftrag"], need: "vereist" },
  { field: "position", columns: ["Position", "Pos.", "Auftragsposition"], need: "vereist" },
  { field: "lineId", columns: ["Zeilen-ID", "Datensatz-ID"], need: "sterk gewenst" },
  { field: "article", columns: ["Material", "Materialnummer"], need: "vereist" },
  { field: "toc", columns: ["TOC"], need: "sterk gewenst" },
  { field: "description", columns: ["Materialkurztext", "Materialbezeichnung"], need: "vereist" },
  { field: "unit", columns: ["Mengeneinheit", "ME"], need: "vereist" },
  { field: "quantity", columns: ["Auftragsmenge", "Menge"], need: "vereist" },
  { field: "deliveredQuantity", columns: ["Liefermenge", "Gelieferte Menge"], need: "sterk gewenst" },
  { field: "date", columns: ["Erstelldatum", "Belegdatum", "Auftragsdatum"], need: "vereist" },
  { field: "deliveryDate", columns: ["Lieferdatum", "WA-Datum", "Warenausgangsdatum"], need: "sterk gewenst" },
  { field: "orderStatus", columns: ["Gesamtstatus", "Lieferstatus", "Absagegrund"], need: "vereist" },
  { field: "documentType", columns: ["Verkaufsbelegart", "Auftragsart"], need: "vereist" },
  { field: "project", columns: ["Projekt", "Projektbezeichnung", "Bauvorhaben"], need: "indien aanwezig" },
  { field: "projectNumber", columns: ["Projektnummer", "PSP-Element"], need: "indien aanwezig" },
  { field: "recipient", columns: ["Warenempfänger"], need: "sterk gewenst" },
  { field: "recipientNumber", columns: ["Warenempfängernummer"], need: "sterk gewenst" },
  { field: "address", columns: ["Straße", "Lieferadresse"], need: "sterk gewenst" },
  { field: "postcode", columns: ["PLZ", "Postleitzahl"], need: "sterk gewenst" },
  { field: "city", columns: ["Ort"], need: "sterk gewenst" },
  { field: "country", columns: ["Land"], need: "sterk gewenst" },
  { field: "region", columns: ["Verkaufsbüro"], need: "indien aanwezig" },
  { field: "debtor", columns: ["Auftraggeber", "Kunde"], need: "indien aanwezig" },
  { field: "debtorNumber", columns: ["Kundennummer", "Auftraggebernummer"], need: "indien aanwezig" },
  { field: "price", columns: ["Nettowert"], need: "indien aanwezig" },
  { field: "currency", columns: ["Währung"], need: "indien aanwezig" },
];

/** Velden die een import (of een Duitse export) minimaal nodig heeft om dubbelen veilig te herkennen. */
export const identityFields: Field[] = ["order", "position", "article", "quantity"];

/** Kies het opgeslagen profiel waarvan alle gekoppelde kolommen in dit bestand voorkomen (meeste velden wint). */
export function matchProfile(headers: string[], profiles: SavedProfile[]) {
  const set = new Set(headers);
  return (
    profiles
      .filter((p) => {
        const cols = Object.values(p.mapping).filter(Boolean) as string[];
        return cols.length > 0 && cols.every((c) => set.has(c));
      })
      .sort(
        (a, b) =>
          Object.values(b.mapping).filter(Boolean).length -
          Object.values(a.mapping).filter(Boolean).length,
      )[0] ?? null
  );
}

/** Alleen geldige velden en niet-lege kolomnamen; een kolom maximaal één keer. */
export function cleanMapping(input: unknown): Mapping {
  if (!input || typeof input !== "object") throw Error("Ongeldige veldkoppeling");
  const out: Mapping = {};
  const used = new Set<string>();
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in fields)) throw Error("Onbekend veld in profiel: " + k);
    const col = String(v ?? "").trim();
    if (!col) continue;
    if (used.has(col)) throw Error(`Kolom "${col}" is aan meer dan één veld gekoppeld`);
    used.add(col);
    out[k as Field] = col;
  }
  if (!out.order || !out.article || !out.quantity)
    throw Error("Een profiel moet ordernummer, artikelcode en aantal koppelen");
  return out;
}

/** Welke gewenste velden ontbreken in de koppeling (ter informatie bij de preview). */
export function missingExpected(mapping: Mapping) {
  return sapGermanExpected
    .filter((e) => e.need !== "indien aanwezig" && !mapping[e.field])
    .map((e) => ({ field: e.field, label: fields[e.field], need: e.need }));
}

export const canonicalColumn = canonical;
