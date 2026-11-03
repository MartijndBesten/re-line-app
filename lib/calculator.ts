export const scenarioKinds = [
  "Retrofit",
  "Complete vervanging",
  "Slimme verlichting",
];
export interface Calculation {
  meters: number | null;
  modules: number | null;
  material: number | null;
  installation: number | null;
  commissioning: number | null;
  other: number | null;
  technicalConfirmed: boolean;
  /** Wie de technische invoer/compatibiliteit heeft gecontroleerd (naam/functie). */
  technicalBy?: string;
  priceSource: string;
  /** Peildatum van de gebruikte prijzen (JJJJ-MM-DD). */
  priceDate?: string;
  notes: string;
}
const labels = {
  meters: "meters",
  modules: "lichtmodules",
  material: "materiaalkosten",
  installation: "montagekosten",
  commissioning: "inbedrijfstelling",
  other: "overige kosten",
} as const;
/**
 * Conceptcalculatie zonder standaardprijzen: een totaal verschijnt alleen als iedere post,
 * de prijsbron met peildatum en de technische controle (met naam) expliciet zijn ingevuld.
 */
export function calculate(data: Calculation) {
  const missing: string[] = [];
  for (const k of Object.keys(labels) as (keyof typeof labels)[]) {
    if (data[k] === null || data[k] === undefined) missing.push(labels[k]);
    else if (!Number.isFinite(data[k]) || data[k]! < 0)
      throw Error("Ongeldige calculatiewaarde");
  }
  if (!data.technicalConfirmed || !data.technicalBy?.trim())
    missing.push("technische inventarisatie/compatibiliteit (met naam controleur)");
  if (!data.priceSource?.trim()) missing.push("prijsbron");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.priceDate ?? ""))
    missing.push("peildatum prijzen");
  const total = missing.length
    ? null
    : data.material! + data.installation! + data.commissioning! + data.other!;
  return {
    complete: missing.length === 0,
    missing,
    total,
    /** AFGELEID uit de ingevoerde waarden; geen tarief. */
    perMeter: total !== null && data.meters! > 0 ? total / data.meters! : null,
  };
}
