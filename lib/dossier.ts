import { canonical } from "./domain";
/**
 * Pure dossierlogica: wat ontbreekt, welke dossiers mogelijk bij elkaar horen en waarom een
 * dossier een bepaalde prioriteit heeft. Niets wordt automatisch gewijzigd of samengevoegd.
 */
export type DossierLike = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  project_number?: string | null;
  location_confirmed?: number | boolean;
  present?: string;
  replaced?: string;
  need?: string;
  end_user?: string | null;
  contact?: string | null;
  owner?: string | null;
  status?: string;
  families?: string | null;
  meters?: number | null;
  deliveredQuantity?: number | null;
  openActions?: number;
  debtors?: string | null;
  relations?: { role: string }[];
  lines?: { document: string }[];
  historyLines?: number;
  series?: string | null;
};
export type MissingItem = { group: string; label: string; action: string };
const closed = ["Gewonnen", "Verloren", "Geen actuele kans"];

export function missingData(p: DossierLike): MissingItem[] {
  const out: MissingItem[] = [];
  const firstOrder = p.lines?.[0]?.document;
  const historyOnly = Number(p.historyLines) > 0 && !p.lines?.length;
  if (/^Onbekend project/.test(p.name))
    out.push({
      group: "Bron",
      label: "Projectnaam onbekend",
      action: historyOnly
        ? `Zoek in SAP bij projectnummer ${p.project_number || "?"} de projectnaam.`
        : `Zoek in SAP bij order ${firstOrder ?? "?"} de projectnaam en goederenontvanger.`,
    });
  if (p.deliveredQuantity === null || p.deliveredQuantity === undefined)
    out.push({
      group: "Bron",
      label: "Levering niet bevestigd",
      action: historyOnly
        ? "Projecthistorie bevat verkoopboekingen per boekjaar, geen ordernummers, leverstatus of leverdata; controleer leveringen in SAP."
        : "Bron bevat alleen orderregels; controleer leverdocument en geleverde hoeveelheid in SAP.",
    });
  if (!p.city?.trim())
    out.push({ group: "Locatie", label: "Plaats onbekend", action: "Leid de plaats niet af uit de debiteur; zoek de goederenontvanger of vraag het na." });
  if (!p.location_confirmed)
    out.push({
      group: "Locatie",
      label: "Installatielocatie niet bevestigd",
      action: p.address?.trim()
        ? "Historisch adres aanwezig; bevestig telefonisch dat de installatie daar is geplaatst."
        : historyOnly
          ? "Geen straat in de SAP-projectgegevens (alleen plaats); vraag het adres na bij installateur of gebruiker."
          : "Geen afleveradres in de bron; vraag het adres na bij installateur of gebruiker.",
    });
  if (!p.relations?.some((r) => r.role === "Installateur"))
    out.push({
      group: "Relaties",
      label: "Huidige installateur onbekend",
      action: "Vraag wie de verlichting onderhoudt; een historische debiteur is niet automatisch de installateur.",
    });
  if (!p.end_user?.trim())
    out.push({ group: "Relaties", label: "Eindgebruiker/gebouwbeheerder onbekend", action: "Vraag wie het gebouw gebruikt en beheert." });
  if (!p.contact?.trim())
    out.push({ group: "Relaties", label: "Geen contactpersoon", action: "Leg vast met wie je contact hebt of zoekt." });
  if ((p.present ?? "Onbekend") === "Onbekend")
    out.push({ group: "Huidige situatie", label: "Aanwezigheid oude installatie onbekend", action: "Gespreksvraag 1." });
  if ((p.replaced ?? "Onbekend") === "Onbekend")
    out.push({ group: "Huidige situatie", label: "Vervanging niet uitgesloten", action: "Gespreksvraag 2." });
  if ((p.need ?? "Onbekend") === "Onbekend")
    out.push({ group: "Huidige situatie", label: "Renovatiebehoefte onbekend", action: "Gespreksvraag 6 en 8." });
  if (historyOnly)
    out.push({
      group: "Techniek",
      label: "Generatie en uitvoering niet bevestigd",
      action: `Productreeks alleen volgens SAP-materiaalstam (${p.series || "onbekend"}); bevestig generatie, lengtes en huidige toestand bij de opname.`,
    });
  else if (!p.families)
    out.push({
      group: "Techniek",
      label: "Artikel niet bevestigd geclassificeerd",
      action: "Instellingen → artikelcatalogus: familie alleen bevestigen met controleerbare bron.",
    });
  if (p.meters === null || p.meters === undefined)
    out.push({ group: "Techniek", label: "Profielmeters onbekend", action: "Alleen na bevestigde profiellengte of technische opname." });
  if (!p.owner?.trim())
    out.push({ group: "Opvolging", label: "Geen verantwoordelijke", action: "Wijs het dossier toe (Kansen of Overzicht)." });
  if (!closed.includes(String(p.status)) && !Number(p.openActions))
    out.push({ group: "Opvolging", label: "Geen geplande vervolgactie", action: "Plan een belactie of afspraak." });
  return out;
}

const stop = new Set([
  "nieuwbouw", "renovatie", "uitbreiding", "verbouwing", "project", "kantoor", "kantoren", "gebouw",
  "fase", "hal", "voor", "van", "het", "den", "der", "te", "de", "en", "distributiecentrum", "bedrijfspand",
  "onbekend",
]);
function tokens(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !stop.has(t) && !/^\d+$/.test(t));
}
/** Mogelijk hetzelfde gebouw of een andere fase. Alleen een voorstel om handmatig te controleren. */
export function relatedProjects<T extends DossierLike>(p: DossierLike, all: T[]) {
  const city = canonical(p.city ?? ""),
    name = canonical(p.name),
    own = new Set(tokens(p.name));
  const out: { project: T; reason: string }[] = [];
  for (const q of all) {
    if (q.id === p.id) continue;
    if (p.project_number && q.project_number === p.project_number) {
      out.push({ project: q, reason: "Zelfde SAP-projectnummer" });
      continue;
    }
    if (!city || canonical(q.city ?? "") !== city || /^Onbekend project/.test(q.name) || /^Onbekend project/.test(p.name))
      continue;
    const other = canonical(q.name);
    const prefix =
      Math.min(name.length, other.length) >= 4 && (name.startsWith(other) || other.startsWith(name));
    const shared = tokens(q.name).filter((t) => own.has(t));
    if (prefix) out.push({ project: q, reason: "Zelfde plaats, naam bijna gelijk (mogelijk andere fase)" });
    else if (shared.length) out.push({ project: q, reason: `Zelfde plaats, gedeeld naamdeel "${shared[0]}"` });
  }
  return out;
}

const factorText: Record<string, string> = {
  age: "Leeftijd oudste order",
  size: "Geclassificeerde E-/C-Line-aantallen",
  orders: "Aantal orders",
  location: "Bevestigde locatie",
  quality: "Bronvolledigheid",
  relationship: "Bevestigde commerciële relatie",
  need: "Bevestigde renovatiebehoefte",
};
/** Leesbare uitleg per scorecomponent, inclusief wat er ontbreekt om punten te krijgen. */
export function priorityReasons(
  p: {
    firstYear?: number | null;
    quantity?: number;
    relevantQuantity?: number;
    orderCount?: number;
    quality?: number;
    scoreParts?: { key: string; points: number; weight: number; label?: string; detail?: string }[];
  },
  year = new Date().getFullYear(),
) {
  return (p.scoreParts ?? []).map((s) => {
    // Renovatiescore (projecthistorie) levert label en toelichting zelf mee.
    if (s.label && s.detail !== undefined)
      return { key: s.key, label: s.label, points: s.points, max: s.weight, detail: s.detail };
    let detail = "";
    switch (s.key) {
      case "age":
        detail = p.firstYear ? `oudste order ${p.firstYear} (${year - p.firstYear} jaar geleden)` : "orderjaar onbekend";
        break;
      case "size":
        detail = Number(p.relevantQuantity)
          ? `${p.relevantQuantity} stuks van bevestigd geclassificeerde artikelen`
          : Number(p.quantity)
            ? `${p.quantity} historische stuks, maar artikel nog niet bevestigd als E-/C-Line: telt niet mee`
            : "geen aantallen";
        break;
      case "orders":
        detail = `${p.orderCount ?? 0} order(s)`;
        break;
      case "quality":
        detail = `${p.quality ?? 0}% van de bronvelden aanwezig`;
        break;
      default:
        detail = s.points ? "bevestigd" : "nog niet bevestigd";
    }
    return { key: s.key, label: factorText[s.key] ?? s.key, points: s.points, max: s.weight, detail };
  });
}
