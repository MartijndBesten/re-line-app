export const statuses = [
  "Nieuw gevonden",
  "Nader onderzoeken",
  "Geselecteerd voor contact",
  "Contactpoging gedaan",
  "Contact gelegd",
  "Installatie bevestigd",
  "Afspraak gepland",
  "Technische inventarisatie",
  "Voorstel in voorbereiding",
  "Offerte uitgebracht",
  "Gewonnen",
  "Verloren",
  "Geen actuele kans",
];
/** Fasen voor de pipelineweergave; iedere salesstatus hoort bij precies één fase. */
export const pipelinePhases: { name: string; statuses: string[] }[] = [
  { name: "Onderzoek", statuses: ["Nieuw gevonden", "Nader onderzoeken"] },
  { name: "Contact", statuses: ["Geselecteerd voor contact", "Contactpoging gedaan", "Contact gelegd"] },
  { name: "Kwalificatie", statuses: ["Installatie bevestigd", "Afspraak gepland", "Technische inventarisatie"] },
  { name: "Voorstel", statuses: ["Voorstel in voorbereiding", "Offerte uitgebracht"] },
  { name: "Afgesloten", statuses: ["Gewonnen", "Verloren", "Geen actuele kans"] },
];
export const activityKinds = ["Bellen", "Afspraak", "Notitie", "Vervolgactie", "Gespreksverslag"];
/** Activiteiten die een taak zijn en in de werkvoorraad horen. */
export const plannedKinds = ["Bellen", "Afspraak", "Vervolgactie"];
export const callOutcomes = [
  "Geen gehoor / voicemail",
  "Terugbelverzoek",
  "Contact gelegd – informatie verzameld",
  "Afspraak gemaakt",
  "Doorverwezen naar andere partij",
  "Geen interesse / niet relevant",
  "Installatie al vervangen",
];
export const contactRoles = ["Installateur", "Eindgebruiker", "Gebouwbeheerder", "Gebouweigenaar", "Groothandel", "Overig"];
export const channels = ["Telefoon", "E-mail", "Bezoek", "Online overleg"];
export const relationRoles = ["Installateur", "Groothandel", "Eindgebruiker", "Gebouweigenaar", "Overig", "Debiteur", "Goederenontvanger"];
export const answerValues = ["Onbekend", "Ja", "Nee", "n.v.t."];
export const fields = {
  order: "Ordernummer",
  position: "Positie",
  lineId: "Stabiele regel-ID",
  article: "Artikelcode",
  toc: "TOC",
  description: "Omschrijving",
  unit: "Eenheid",
  quantity: "Aantal",
  deliveredQuantity: "Geleverde hoeveelheid",
  date: "Orderdatum",
  deliveryDate: "Leverdatum",
  orderStatus: "Order-/leverstatus",
  documentType: "Documenttype",
  project: "Projectnaam",
  projectNumber: "SAP-projectnummer",
  city: "Plaats",
  postcode: "Postcode",
  country: "Land",
  region: "Regio / verkoopkantoor",
  address: "Afleveradres",
  debtor: "Debiteur",
  debtorNumber: "Debiteurnummer",
  recipient: "Goederenontvanger",
  recipientNumber: "Goederenontvangernummer",
  familySource: "Productfamilie volgens bron",
  price: "Historische prijs",
  currency: "Valuta",
  source: "Bronsysteem",
};
export type Field = keyof typeof fields;
export type SourceRow = Record<string, string>;
/** Regelstatus voor tellingen: geannuleerde regels en andere eenheden tellen niet als stuks. */
export type LineState = "Normaal" | "Retour/correctie" | "Geannuleerd";
export interface Normalized {
  order: string;
  position: string;
  lineId: string;
  article: string;
  toc: string;
  description: string;
  unit: string;
  quantity: number;
  deliveredQuantity: number | null;
  date: string | null;
  deliveryDate: string | null;
  orderStatus: string;
  documentType: string;
  project: string;
  projectNumber: string;
  city: string;
  postcode: string;
  country: string;
  region: string;
  address: string;
  debtor: string;
  debtorNumber: string;
  recipient: string;
  recipientNumber: string;
  familySource: string;
  price: number | null;
  currency: string;
  source: string;
  lineState: LineState;
  /** 1 = aantal telt mee als historische stuks (geen annulering, eenheid stuks of onbekend). */
  counted: number;
  raw: SourceRow;
  key: string;
  warnings: string[];
}
export interface Preview {
  headers: string[];
  mapping: Partial<Record<Field, string>>;
  rows: SourceRow[];
  normalized: Normalized[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}
export const defaultWeights = {
  age: 20,
  size: 20,
  orders: 10,
  location: 10,
  quality: 10,
  relationship: 10,
  need: 20,
};
export type Weights = typeof defaultWeights;
export function canonical(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
export function score(
  p: {
    firstYear: number | null;
    quantity: number;
    orderCount: number;
    locationConfirmed: number;
    quality: number;
    relationshipConfirmed: number;
    need: string;
  },
  weights: Weights,
  year = new Date().getFullYear(),
) {
  const factors = {
    age:
      p.firstYear === null
        ? 0
        : Math.min(Math.max((year - p.firstYear) / 20, 0), 1),
    size: Math.min(Math.max(p.quantity, 0) / 500, 1),
    orders: Math.min(p.orderCount / 5, 1),
    location: p.locationConfirmed ? 1 : 0,
    quality: p.quality / 100,
    relationship: p.relationshipConfirmed ? 1 : 0,
    need: p.need === "Ja" ? 1 : 0,
  };
  const parts = Object.entries(factors).map(([key, factor]) => ({
    key,
    points: Math.round(factor * weights[key as keyof Weights] * 10) / 10,
    weight: weights[key as keyof Weights],
  }));
  return { total: Math.round(parts.reduce((s, p) => s + p.points, 0)), parts };
}
