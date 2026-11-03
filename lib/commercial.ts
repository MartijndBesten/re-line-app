/** Local, evidence-aware sales preparation. No external AI or price inference. */
export interface HistoricLine {
  document: string;
  position?: string | null;
  order_date?: string | null;
  article: string;
  description?: string | null;
  quantity: number;
  document_type?: string | null;
}
export interface BriefProject {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  firstYear?: number | null;
  lastYear?: number | null;
  meters?: number | null;
  quantity?: number;
  status?: string;
  present?: string;
  replaced?: string;
  need?: string;
  location_confirmed?: number | boolean;
  contact?: string | null;
  end_user?: string | null;
  debtors?: string | null;
  installerNames?: string | null;
  confidence?: string | null;
  owner?: string | null;
  next_action?: string | null;
  lines: HistoricLine[];
  activities?: { kind?: string; answers?: string | null; created?: string; contact?: string | null; due?: string | null; done?: number | boolean; note?: string }[];
}
/** Vaste vragen voor het eerste gesprek. De id blijft stabiel; antwoorden worden per id bewaard. */
export const questions = [
  { id: "aanwezig", text: "Is de oorspronkelijke verlichtingsinstallatie op deze locatie nog aanwezig?" },
  { id: "vervangen", text: "Zijn er sindsdien lichtlijnen of armaturen geheel of gedeeltelijk vervangen?" },
  { id: "beheer", text: "Wie beheert het gebouw en wie beslist over renovatie-investeringen?" },
  { id: "installateur", text: "Welke installateur onderhoudt momenteel de verlichting?" },
  { id: "branduren", text: "Hoeveel uur per jaar brandt de verlichting, en welke zones gebruiken daglicht?" },
  { id: "klachten", text: "Zijn er klachten over lichtniveau, uitval, verblinding of onderhoud?" },
  { id: "regeling", text: "Is er al aanwezigheid-/daglichtregeling, DALI of een GBS-koppeling?" },
  { id: "plannen", text: "Zijn er renovatieplannen, duurzaamheidsdoelen of een natuurlijk vervangingsmoment?" },
  { id: "opname", text: "Mogen wij samen met de huisinstallateur een technische opname doen?" },
] as const;
export type QuestionId = (typeof questions)[number]["id"];
export const discoveryQuestions = questions.map((q) => q.text);
export type Answer = { answer: string; note: string; date: string; contact: string };

/** Laatste inhoudelijke antwoord per vraag uit geregistreerde gesprekken (nieuwste eerst). */
export function latestAnswers(
  activities: { kind?: string; answers?: string | null; created?: string; contact?: string | null }[],
): Partial<Record<QuestionId, Answer>> {
  const out: Partial<Record<QuestionId, Answer>> = {};
  const sorted = [...activities]
    .filter((a) => a.kind === "Gespreksverslag" && a.answers)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  for (const a of sorted) {
    let parsed: Record<string, { answer?: string; note?: string }>;
    try {
      parsed = JSON.parse(String(a.answers));
    } catch {
      continue;
    }
    for (const q of questions) {
      const v = parsed[q.id];
      if (!v || out[q.id]) continue;
      const answer = String(v.answer ?? "Onbekend"),
        note = String(v.note ?? "").trim();
      if (answer === "Onbekend" && !note) continue;
      out[q.id] = { answer, note, date: String(a.created ?? "").slice(0, 10), contact: String(a.contact ?? "") };
    }
  }
  return out;
}

export const scenarioDirections = [
  {
    name: "A · Retrofit",
    value: "Bestaande draagprofielen mogelijk behouden, lichttechniek passend vervangen",
    gate: "Pas na inspectie van toestand, maatvoering, draagstructuur en compatibiliteit",
  },
  {
    name: "B · Nieuwe lichtlijn",
    value: "Bestaande lijnen volledig vervangen door een actuele lichtlijnoplossing",
    gate: "Nieuwe lichtberekening, montagesysteem, voeding en werkelijke lijnlengten",
  },
  {
    name: "C · Smart",
    value: "Passende retrofit/vervanging aanvullen met aanwezigheid-, daglichtregeling en eventueel GBS",
    gate: "Gebruikstijden, zones, sensordekking, netwerk en technische systeemkeuze controleren",
  },
] as const;

export function verifiedFacts(p: BriefProject): { label: string; value: string }[] {
  const facts = [
    { label: "Bronproject", value: p.name },
    { label: "Plaats (historische referentie)", value: p.city || "Onbekend" },
    { label: "Historisch orderjaar", value: p.firstYear === null || p.firstYear === undefined
      ? "Onbekend" : p.lastYear && p.lastYear !== p.firstYear
        ? `${p.firstYear}–${p.lastYear}` : String(p.firstYear) },
    { label: "Historische orderregels", value: String(p.lines.length) },
    { label: "Historische stuks in dataset", value: p.lines.reduce((sum, x) => sum + Number(x.quantity || 0), 0).toLocaleString("nl-NL") },
    { label: "Bevestigde profielmeters", value: p.meters === null || p.meters === undefined ? "Onbekend" : String(p.meters) + " m" },
    { label: "Bekende debiteur(en)", value: p.debtors || "Onbekend (niet automatisch eindgebruiker)" },
    { label: "Bevestigde eindgebruiker", value: p.end_user || "Onbekend" },
    { label: "Gecontroleerde installatielocatie", value: p.location_confirmed ? (p.address || p.city || "Locatie gemarkeerd als bevestigd; adres ontbreekt") : "Nog niet bevestigd" },
    { label: "Installatie nog aanwezig?", value: p.present || "Onbekend" },
    { label: "Reeds vervangen?", value: p.replaced || "Onbekend" },
    { label: "Renovatiebehoefte?", value: p.need || "Onbekend" },
  ];
  return facts;
}

/** Explicitly internal briefing. Never represent as a ready-to-send customer offer. */
export function makeInternalBrief(p: BriefProject): string {
  const answers = latestAnswers(p.activities ?? []);
  const open = (p.activities ?? []).filter(
    (a) => !a.done && ["Bellen", "Afspraak", "Vervolgactie"].includes(String(a.kind)),
  );
  const lines = [
    "RE-LINE | UTILITEIT — INTERN GESPREKSDOSSIER",
    "Voorbereiding, geen bevestigde installatie, technische oplossing of offerte.",
    "",
    "1. BEKENDE BRONGEGEVENS",
    ...verifiedFacts(p).map(x => `${x.label}: ${x.value}`),
    "",
    "2. ORDERREFERENTIES (niet bewezen geleverd)",
    ...p.lines.slice(0, 30).map(x =>
      `Order ${x.document}/${x.position || "?"} · ${x.article} · ${Number(x.quantity).toLocaleString("nl-NL")} st · ${x.order_date || "datum onbekend"} · ${x.description || ""}`),
    ...(p.lines.length > 30 ? [`... ${p.lines.length - 30} overige bronregels in dossier`] : []),
    "",
    "3. VERIFICATIEVRAGEN (met laatst geregistreerd antwoord)",
    ...questions.map((q, i) => {
      const a = answers[q.id];
      return `${i + 1}. ${q.text}` + (a ? `\n   → ${a.answer}${a.note ? ": " + a.note : ""} (${a.date}${a.contact ? ", " + a.contact : ""})` : "\n   → nog niet gevraagd/onbekend");
    }),
    "",
    "4. MOGELIJKE RICHTINGEN — NIET GECALCULEERD",
    ...scenarioDirections.map(s => `${s.name}: ${s.value}. Voorwaarde: ${s.gate}.`),
    "",
    "5. VOLGENDE STAP",
    `Verantwoordelijke: ${p.owner || "niet toegewezen"}`,
    ...(p.next_action ? [`Volgende actie (dossier): ${p.next_action}`] : []),
    ...open.map((a) => `Open actie: ${a.kind} · ${a.due || "zonder datum"} · ${a.note ?? ""}`),
    "Bevestig installatie en onderhoudspartner. Leg contactpersoon, datum en gespreksresultaat vast in de salespipeline.",
    "Maak pas na technische inventarisatie een prijsindicatie met gevalideerde tarieven en aannames.",
  ];
  return lines.join("\n");
}

export type PortfolioRelation = {
  id: string;
  name: string;
  role: string;
  projectCount?: number;
  number?: string;
  contact?: string;
};
export type PortfolioLink = { relationId: string; projectId: string };
export type PortfolioProject = {
  id: string;
  name: string;
  city?: string;
  quantity: number;
  firstYear?: number | null;
  status?: string;
};

export function portfolioProjects(
  relationId: string,
  links: PortfolioLink[],
  projects: PortfolioProject[],
): PortfolioProject[] {
  const ids = new Set(links.filter(x => x.relationId === relationId).map(x => x.projectId));
  return projects.filter(x => ids.has(x.id)).sort((a, b) =>
    b.quantity - a.quantity || a.name.localeCompare(b.name, "nl"));
}

export function rankedRelations<T extends PortfolioRelation>(relations: T[], role = "Alle"): T[] {
  return relations.filter(r => role === "Alle" || r.role === role)
    .sort((a, b) => Number(b.projectCount || 0) - Number(a.projectCount || 0) ||
      a.name.localeCompare(b.name, "nl"));
}
