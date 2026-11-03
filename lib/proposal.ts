import { calculate, scenarioKinds, type Calculation } from "./calculator";

export type ScenarioRecord = { kind: string; data: string };
export type ScenarioSummary = {
  kind: string;
  saved: boolean;
  complete: boolean;
  total: number | null;
  perMeter: number | null;
  missing: string[];
  priceSource: string;
  priceDate: string;
  technicalBy: string;
  notes: string;
};
const empty = { total: null, perMeter: null, priceSource: "", priceDate: "", technicalBy: "", notes: "" };

export function evaluateScenarios(saved: ScenarioRecord[]): ScenarioSummary[] {
  return scenarioKinds.map((kind) => {
    const row = saved.find((s) => s.kind === kind);
    if (!row) return { kind, saved: false, complete: false, missing: ["nog niet uitgewerkt"], ...empty };
    try {
      const data = JSON.parse(row.data) as Calculation;
      if (!data || typeof data !== "object") throw Error("Leeg scenario");
      const c = calculate(data);
      return {
        kind,
        saved: true,
        ...c,
        priceSource: data.priceSource || "",
        priceDate: data.priceDate || "",
        technicalBy: data.technicalBy || "",
        notes: data.notes || "",
      };
    } catch {
      return { kind, saved: true, complete: false, missing: ["opgeslagen invoer controleren"], ...empty };
    }
  });
}
const euro = (n: number) =>
  "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function internalScenarioPack(projectName: string, scenarios: ScenarioSummary[]): string {
  const text = [
    "RE-LINE | UTILITEIT — INTERN RENOVATIE-OVERZICHT",
    "CONCEPT · niet aan klant versturen zonder technische en commerciële toets",
    "Project: " + projectName,
    "",
    ...scenarios.flatMap((x, i) => [
      `${i + 1}. ${x.kind}`,
      x.complete
        ? `Indicatieve totaalprijs (excl. btw): ${euro(Number(x.total))}` +
          (x.perMeter !== null ? ` · afgeleid ${euro(x.perMeter)} per ingevoerde meter` : "")
        : "Geen betrouwbare totaalprijs: " + x.missing.join(", "),
      "Prijsbron: " + (x.priceSource || "Ontbreekt") + (x.priceDate ? ` (peildatum ${x.priceDate})` : ""),
      "Technisch gecontroleerd door: " + (x.technicalBy || "Ontbreekt"),
      "Aannames: " + (x.notes || "Niet ingevuld"),
      "",
    ]),
    "Voor een voorstel zijn daarnaast actuele productspecificaties, lichtberekening, locatie-opname, montagecondities en gevalideerde tarieven nodig.",
    "Historische orderaantallen vormen niet automatisch een basis voor lijnmeters of actuele energie-/CO₂-besparing.",
  ];
  return text.join("\n");
}
