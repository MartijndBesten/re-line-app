/**
 * Commercial worklist for historical data. Evidence-aware: ordered quantities are
 * not proven installations, and customer/debtor is not automatically end user.
 */
export type LeadStage =
  | "Afgesloten"
  | "Al in opvolging"
  | "Brononderzoek"
  | "Locatie controleren"
  | "Contact voorbereiden";

export type LeadInput = {
  id: string;
  name: string;
  city: string | null;
  firstYear: number | null;
  lastYear?: number | null;
  quantity: number;
  orderCount?: number;
  quality: number;
  priority: number;
  location_confirmed?: number | boolean;
  status: string;
  replaced?: string;
  debtors?: string | null;
  installerNames?: string | null;
  owner?: string | null;
  nextDue?: string | null;
  openActions?: number;
  // Projecthistorie (SAP-verkoop per boekjaar; geen orders of leveringen).
  lineCount?: number;
  project_number?: string | null;
  oldestYear?: number | null;
  historyLines?: number;
  historyFirstYear?: number | null;
  historyLastYear?: number | null;
  historyNetRevenue?: number;
  series?: string | null;
  candidate_rank?: number | null;
  oldSeriesLines?: number;
};

export function evaluateLead(p: LeadInput): { stage: LeadStage; next: string; reason: string } {
  if (p.replaced === "Ja" || ["Geen actuele kans", "Verloren", "Gewonnen"].includes(p.status))
    return { stage: "Afgesloten", next: "Geen koude acquisitie; controleer eventuele bestaande opdracht.", reason: "Vervangen of commercieel afgesloten" };

  if (!["Nieuw gevonden", "Nader onderzoeken", "Geselecteerd voor contact"].includes(p.status))
    return { stage: "Al in opvolging", next: "Bekijk openstaande activiteiten en vervolg de bestaande klantafspraak.", reason: "Commercieel traject is al gestart" };

  if (!p.name?.trim() || /^Onbekend project(?:\s|·|$)/i.test(p.name) || !p.city?.trim())
    return { stage: "Brononderzoek", next: Number(p.historyLines) ? "Zoek in SAP bij het projectnummer de echte projectnaam en installatielocatie." : "Bekijk SAP-order en zoek de echte projectnaam en installatielocatie.", reason: "Projectnaam of plaats ontbreekt" };

  if (!p.location_confirmed)
    return { stage: "Locatie controleren", next: Number(p.historyLines) && !Number(p.lineCount) ? "Controleer of de installatie op de projectlocatie uit SAP is geplaatst en nog aanwezig is." : "Controleer afleveradres en of de installatie op deze locatie is geplaatst.", reason: "Project herkenbaar, installatielocatie niet bevestigd" };

  return { stage: "Contact voorbereiden", next: "Controleer huidige gebruiker/installateur en bereid een verkennend gesprek voor.", reason: "Project en locatie bekend; aanwezigheid installatie niet bewezen" };
}

export function leadsForReview<T extends LeadInput>(
  projects: T[],
  options: { minQuantity: number; newestYear: number; mode?: string },
) {
  return projects
    .filter((p) =>
      p.firstYear !== null &&
      p.firstYear <= options.newestYear &&
      p.quantity >= options.minQuantity &&
      (options.mode === undefined || options.mode === "Alle" || evaluateLead(p).stage === options.mode),
    )
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "nl"));
}

export const worklistModes = ["Renovatiekandidaten", "Projecthistorie", "Orderregels"] as const;
export type WorklistMode = (typeof worklistModes)[number];
export type WorklistFilter = {
  mode: WorklistMode;
  minQuantity: number;
  newestYear: number | null;
  minRevenue?: number;
  series?: string;
  city?: string;
  minPriority?: number;
};
/**
 * Kansen-werkvoorraad per bron. "Renovatiekandidaten": de vaste top-n op rangnummer.
 * "Projecthistorie": alle dossiers met SAP-projecthistorie, op renovatiescore. "Orderregels":
 * het oorspronkelijke filter op historische stuks en oudste orderjaar.
 */
export function worklist<T extends LeadInput>(projects: T[], f: WorklistFilter) {
  const common = (p: T) =>
    (!f.minRevenue || Number(p.historyNetRevenue ?? 0) >= f.minRevenue) &&
    (!f.series || String(p.series ?? "").split(",").includes(f.series)) &&
    (!f.city || (p.city ?? "").toLowerCase() === f.city.toLowerCase()) &&
    (!f.minPriority || p.priority >= f.minPriority);
  if (f.mode === "Orderregels")
    return leadsForReview(projects, { minQuantity: f.minQuantity, newestYear: f.newestYear ?? 9999 }).filter(common);
  if (f.mode === "Renovatiekandidaten")
    return projects
      .filter((p) => p.candidate_rank !== null && p.candidate_rank !== undefined && common(p))
      .sort((a, b) => Number(a.candidate_rank) - Number(b.candidate_rank));
  return projects
    .filter(
      (p) =>
        Number(p.historyLines) > 0 &&
        (f.newestYear === null || (p.oldestYear ?? p.historyFirstYear ?? 9999) <= f.newestYear) &&
        common(p),
    )
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, "nl"));
}

/** Prevent Excel/LibreOffice formula injection, including leading whitespace bypasses. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function exportLeadCsv(projects: LeadInput[]): string {
  const headers = [
    "Project", "Plaats", "Oudste orderjaar", "Laatste orderjaar",
    "Aantal historische stuks", "Aantal orders", "Debiteur (niet per se eindgebruiker)",
    "Bevestigde installateur", "Werkstap", "Volgende handeling",
    "Datakwaliteit (%)", "Salesstatus", "Dossier-ID",
    "Verantwoordelijke", "Eerstvolgende geplande actie", "Prioriteit (punten)",
    "SAP-projectnummer", "Eerste boekjaar (projecthistorie)", "Laatste boekjaar (projecthistorie)",
    "Net-net-omzet volgens export (historische verkoop)", "Productreeksen volgens SAP", "Rang renovatiekandidaat"
  ];
  const rows = projects.map((p) => {
    const lead = evaluateLead(p);
    return [
      p.name, p.city, p.firstYear, p.lastYear, p.quantity, p.orderCount,
      p.debtors, p.installerNames, lead.stage, lead.next, p.quality, p.status, p.id,
      p.owner, p.nextDue, p.priority,
      p.project_number, p.historyFirstYear, p.historyLastYear,
      Number(p.historyLines) ? Math.round(Number(p.historyNetRevenue ?? 0)) : null, p.series, p.candidate_rank
    ];
  });
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}


/**
 * Kansklasse per dossier met projecthistorie, afgeleid uit bestaande gegevens (geen extra veld). Los van de rang in
 * de vaste werkvoorraad (#1–100): die rang volgt de score, de klasse zegt of er een inhoudelijke aanleiding is.
 * - "Kansrijk": eerste boekjaar ≥ 10 jaar geleden en/of reeks "E-Line Old" volgens SAP;
 * - "Later bekijken": recente verkoop zonder oudere reeks — nu waarschijnlijk te vroeg, nadrukkelijk niet afgeschreven;
 * - "Afgesloten": gewonnen, verloren, geen actuele kans of installatie vervangen.
 * Zegt niets over de actuele installatie of retrofitgeschiktheid: die zijn niet bevestigd.
 */
export type RenovationClass = "Kansrijk" | "Later bekijken" | "Afgesloten";
export function renovationClass(
  p: { candidate_rank?: number | null; historyFirstYear?: number | null; oldSeriesLines?: number; status?: string; replaced?: string; historyLines?: number },
  year = new Date().getFullYear(),
): { klasse: RenovationClass; reden: string } | null {
  if (!Number(p.historyLines)) return null;
  if (["Gewonnen", "Verloren", "Geen actuele kans"].includes(String(p.status)) || p.replaced === "Ja")
    return { klasse: "Afgesloten", reden: p.replaced === "Ja" ? "installatie vervangen (bevestigd)" : `salesstatus ${p.status}` };
  const age = p.historyFirstYear ? year - Number(p.historyFirstYear) : null;
  const old = Number(p.oldSeriesLines ?? 0) > 0;
  const rank = p.candidate_rank ? `; rang ${p.candidate_rank} in de werkvoorraad` : "";
  if ((age !== null && age >= 10) || old)
    return {
      klasse: "Kansrijk",
      reden: [age !== null && age >= 10 ? `eerste boekjaar ${p.historyFirstYear} (${age} jaar)` : "", old ? 'reeks "E-Line Old" volgens SAP' : ""].filter(Boolean).join("; ") + rank,
    };
  return {
    klasse: "Later bekijken",
    reden: (age === null ? "boekjaar onbekend" : `eerste boekjaar ${p.historyFirstYear} (${age} jaar), geen oudere reeks: nu waarschijnlijk te recent`) + rank,
  };
}
